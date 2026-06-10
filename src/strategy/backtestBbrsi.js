/**
 * Backtest BBRSI using live API candles (get90DayCandles).
 *
 * This harness replays historical candles through evaluatePosition,
 * simulates fills, calls notifyExit, and reports metrics.
 *
 * Uses CONFIRMED WayfinderAgent shapes (get90DayCandles, getLatestPrice)
 * and CONFIRMED BBRSIStrategy API (evaluatePosition, notifyExit).
 */
const { BBRSIStrategy } = require("./BBRSIStrategy");

async function backtestBbrsi(wayfinder, opts = {}) {
    const logger = opts.logger || console;
    const coin = opts.coin || "BTC";
    const interval = opts.interval || "15m";
    const startEquity = opts.equity || 10000; // Starting equity in USD
    const regimeDetector = opts.regimeDetector || null; // Optional: for by-regime breakdown

    // 1) Fetch 90 days of candles via the agent.
    const candles = await wayfinder.get90DayCandles(coin, interval);
    if (!candles || candles.length < 100) {
        return {
            ok: false,
            reason: "insufficient candles for " + coin + "/" + interval,
            candlesReceived: candles?.length || 0,
        };
    }

    // 2) Setup.
    const strategy = new BBRSIStrategy(logger, /* stateStore */ null);
    const feePct = strategy.roundTripFeePercent
        ? strategy.roundTripFeePercent()
        : (strategy.takerFeeRate || 0.00045) * 2 * 100; // default ~0.09%

    let equity = startEquity;
    let peakEquity = equity;
    let maxDrawdownPct = 0;
    const equityCurve = [];
    const trades = [];

    // Warm-up: skip first N bars so indicators (BB 20, RSI 14, ADX 14) are valid.
    // Max(20,14,14) + small buffer = ~50 bars.
    const warmup = 50;

    // Helper to get regime at a specific bar index (async, cached per bar).
    const regimeCache = {};
    async function regimeAt(i) {
        if (!regimeDetector) return "n/a";
        if (regimeCache[i] !== undefined) return regimeCache[i];
        // Use a slice up to i as the "recent candles" for regime detection.
        const recent = candles.slice(Math.max(0, i - 100), i + 1);
        const r = await regimeDetector.detect(recent); // assumes detect exists
        regimeCache[i] = r;
        return r;
    }

    let position = null; // { side, entryPrice, entryTs, sizeUnits, stopLoss, takeProfit, regimeAtEntry }

    for (let i = warmup; i < candles.length; i++) {
        const bar = candles[i];
        const price = Number(bar.c);

        // Prepare evaluatePosition inputs.
        const lookback = candles.slice(0, i + 1); // All bars up to current
        const side = position ? position.side : null;
        const entryPrice = position ? position.entryPrice : null;

        // Compute current PnL as %-of-equity if in position.
        let currentPnl = 0;
        if (position && entryPrice) {
            const direction = position.side === "LONG" ? 1 : -1;
            const priceChange = (price - entryPrice) / entryPrice;
            // Approximate leverage: notional / equity. We track sizeUnits as fraction of equity.
            const notional = position.sizeUnits * equity * (position.leverage || 1);
            const lev = notional / equity;
            const pnlFrac = priceChange * direction * lev;
            currentPnl = pnlFrac * 100; // Percent of equity
        }

        // Evaluate strategy.
        let result;
        try {
            result = await strategy.evaluatePosition(
                lookback,
                side,
                equity,
                entryPrice,
                currentPnl
            );
        } catch (e) {
            logger.error("[BACKTEST] evaluatePosition threw at bar " + i + ": " + e.message);
            continue;
        }

        const sig = (result && result.signal) || "NONE";

        // ── Handle EXITS (when in position) ──
        if (position) {
            // Check for stop loss, take profit, or signal exit.
            const stopHit =
                position.stopLoss &&
                ((position.side === "LONG" && price <= position.stopLoss) ||
                    (position.side === "SHORT" && price >= position.stopLoss));
            const tpHit =
                position.takeProfit &&
                ((position.side === "LONG" && price >= position.takeProfit) ||
                    (position.side === "SHORT" && price <= position.takeProfit));
            const signalExit =
                sig === "CLOSE_LONG" ||
                sig === "CLOSE_SHORT" ||
                sig === "FORCE_CLOSE";

            if (stopHit || tpHit || signalExit) {
                // Determine exit price.
                let exitPrice;
                if (stopHit) exitPrice = position.stopLoss;
                else if (tpHit) exitPrice = position.takeProfit;
                else exitPrice = price; // Signal exit at close.

                // Realized PnL calc.
                const direction = position.side === "LONG" ? 1 : -1;
                const grossReturn =
                    ((exitPrice - position.entryPrice) / position.entryPrice) *
                    direction;
                const leverage = position.leverage || 1;
                const grossPct = grossReturn * leverage * 100; // % of equity
                const fee = feePct; // round-trip fee %
                const netPct = grossPct - fee;
                const realizedUsd = (netPct / 100) * equity;

                equity += realizedUsd;

                trades.push({
                    side: position.side,
                    entryPrice: position.entryPrice,
                    exitPrice,
                    entryTs: position.entryTs,
                    exitTs: bar.t,
                    realizedUsd,
                    grossReturnPct: +grossPct.toFixed(4),
                    netReturnPct: +netPct.toFixed(4),
                    exitReason: stopHit
                        ? "stop-loss"
                        : tpHit
                        ? "take-profit"
                        : result.reason || "signal",
                    regimeAtEntry: position.regimeAtEntry,
                });

                // IMPORTANT: notifyExit updates strategy state (dailyRealizedPnl, etc).
                try {
                    await strategy.notifyExit(bar.t, /* realizedPnl */ undefined, {
                        side: position.side,
                        entryPrice: position.entryPrice,
                        exitPrice,
                    });
                } catch (e) {
                    logger.warn("[BACKTEST] notifyExit threw: " + e.message);
                }

                position = null;
            }
        }

        // ── Handle ENTRIES (when flat) ──
        else if (!position && (sig === "LONG" || sig === "SHORT")) {
            const entryPrice = bar.c;
            const sizeUnits = Number(result.positionSize) || 0;
            if (sizeUnits > 0 && Number.isFinite(entryPrice)) {
                position = {
                    side: sig,
                    entryPrice,
                    entryTs: bar.t,
                    sizeUnits,
                    stopLoss: Number(result.stopLoss),
                    takeProfit: Number(result.takeProfit),
                    regimeAtEntry: await regimeAt(i),
                };
            }
        }

        // ── Equity curve + drawdown ──
        // Mark-to-market: realized only (closed trades). Unrealized excluded for a
        // conservative, less-noisy curve. Switch to include uPnL if you prefer.
        equityCurve.push({ t: bar.t, equity: +equity.toFixed(2) });
        if (equity > peakEquity) peakEquity = equity;
        const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    }

    // 3) Metrics.
    const wins = trades.filter((t) => t.realizedUsd > 0);
    const losses = trades.filter((t) => t.realizedUsd <= 0);
    const grossWin = wins.reduce((s, t) => s + t.realizedUsd, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedUsd, 0));
    const netPnlUsd = equity - startEquity;

    // Per-bar returns for Sharpe (use equity curve deltas).
    const rets = [];
    for (let i = 1; i < equityCurve.length; i++) {
        const prev = equityCurve[i - 1].equity;
        if (prev > 0) rets.push((equityCurve[i].equity - prev) / prev);
    }
    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const variance = rets.length
        ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length
        : 0;
    const stdev = Math.sqrt(variance);

    // Annualization factor for the bar interval.
    // 15m bars => 96/day; ~252 trading days is for equities, crypto trades 365.
    const barsPerYear = (() => {
        const m = { "1m": 525600, "5m": 105120, "15m": 35040, "1h": 8760, "4h": 2190, "1d": 365 };
        return m[interval] || 35040; // default 15m
    })();
    // Sharpe (rf=0). stdev is per-bar; annualize by sqrt(barsPerYear).
    const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(barsPerYear) : 0;

    // Per-regime breakdown (only meaningful if regimeDetector was provided).
    const byRegime = {};
    for (const t of trades) {
        const r = t.regimeAtEntry || "n/a";
        const b = (byRegime[r] ??= { trades: 0, wins: 0, netUsd: 0 });
        b.trades++;
        if (t.realizedUsd > 0) b.wins++;
        b.netUsd += t.realizedUsd;
    }
    for (const r of Object.keys(byRegime)) {
        const b = byRegime[r];
        b.winRate = b.trades ? +(b.wins / b.trades).toFixed(3) : 0;
        b.netUsd = +b.netUsd.toFixed(2);
    }

    return {
        ok: true,
        coin,
        interval,
        startEquity,
        endEquity: +equity.toFixed(2),
        netPnlUsd: +netPnlUsd.toFixed(2),
        netPnlPct: +((netPnlUsd / startEquity) * 100).toFixed(2),
        candlesUsed: candles.length,
        barsEvaluated: candles.length - warmup,
        totalTrades: trades.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate: trades.length ? +(wins.length / trades.length).toFixed(3) : 0,
        avgWinUsd: wins.length ? +(grossWin / wins.length).toFixed(2) : 0,
        avgLossUsd: losses.length ? +(grossLoss / losses.length).toFixed(2) : 0,
        profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? Infinity : 0),
        maxDrawdownPct: +maxDrawdownPct.toFixed(2),
        sharpe: +sharpe.toFixed(2),
        byRegime,
        // Keep raw arrays available but compact; comment out if logs get huge.
        trades,
        equityCurve,
    };
}

module.exports = { backtestBbrsi };
