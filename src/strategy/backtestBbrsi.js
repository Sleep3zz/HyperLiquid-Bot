/**
 * BBRSI Backtest Harness - Unified Version
 *
 * Drives the REAL BBRSIStrategy.evaluatePosition with anti-look-ahead:
 * - At bar i, strategy sees candles[0..i] only
 * - Signals fill at bar i's CLOSE
 * - Exits checked against bar i's high/low (matching strategy's evaluateExit)
 * - Same-bar SL+TP ambiguity resolves PESSIMISTICALLY (stop first)
 *
 * Features from both versions:
 * - Full metrics (Sharpe, win rate, profit factor, max drawdown)
 * - Per-regime breakdown
 * - Proper fee accounting via roundTripFeePercent()
 * - notifyExit calls (tests accounting loop)
 * - Conservative equity curve (realized PnL only)
 */
const { BBRSIStrategy } = require("./BBRSIStrategy");

// No-op state store so strategy never touches disk during backtest
const memoryStore = {
    load: () => ({}),
    save: () => {},
};

// Helper: percentage move for a trade
function pctMove(side, entry, exit) {
    const m = ((exit - entry) / entry) * 100;
    return side === "LONG" ? m : -m;
}

async function backtestBbrsi(wayfinder, opts = {}) {
    const logger = opts.logger || { info() {}, warn() {}, error() {} };
    const coin = opts.coin || "BTC";
    const interval = opts.interval || "15m";
    const startEquity = Number(opts.equity) || 10000;
    const warmup = Number(opts.warmup) || 60; // Bars before first eval
    const regimeDetector = opts.regimeDetector || null;

    // 1) Pull 90 days of candles
    const raw = await wayfinder.get90DayCandles(coin, interval);
    if (!Array.isArray(raw) || raw.length < warmup + 10) {
        return {
            ok: false,
            reason: `insufficient candles (${raw && raw.length})`,
            candlesReceived: raw?.length || 0,
        };
    }

    // Normalize + sort ascending by time (defensive)
    const candles = raw
        .map((c) => ({
            t: Number(c.t ?? c.openTime),
            o: Number(c.o ?? c.open),
            h: Number(c.h ?? c.high),
            l: Number(c.l ?? c.low),
            c: Number(c.c ?? c.close),
            v: Number(c.v ?? c.volume ?? 0),
        }))
        .filter((c) => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
        .sort((a, b) => a.t - b.t);

    // 2) Setup strategy with memory-only state
    const strat = new BBRSIStrategy(logger, memoryStore);
    strat.stateStore = memoryStore;
    const feePct = strat.roundTripFeePercent
        ? strat.roundTripFeePercent()
        : (strat.takerFeeRate || 0.00045) * 2 * 100;

    // Backtest state
    let equity = startEquity;
    let peakEquity = startEquity;
    let maxDrawdownPct = 0;
    const equityCurve = [];
    const trades = [];
    let position = null; // { side, entryPrice, entryTs, sizeUnits, stopLoss, takeProfit, regimeAtEntry }

    // Helper: regime at bar index (optional)
    const regimeCache = {};
    async function regimeAt(idx) {
        if (!regimeDetector) return "n/a";
        if (regimeCache[idx] !== undefined) return regimeCache[idx];
        try {
            const slice = candles.slice(Math.max(0, idx - 99), idx + 1);
            if (typeof regimeDetector.classifySlice === "function") {
                return regimeDetector.classifySlice(slice);
            }
            return "n/a";
        } catch {
            return "n/a";
        }
    }

    // 3) Replay
    for (let i = warmup; i < candles.length; i++) {
        const bar = candles[i];
        const history = candles.slice(0, i + 1);

        // Current PnL as %-of-equity if in position
        let currentPnl = 0;
        if (position) {
            const grossPct = pctMove(position.side, position.entryPrice, bar.c);
            const notional = position.sizeUnits * position.entryPrice;
            const leverage = notional / startEquity;
            currentPnl = grossPct * leverage;
        }

        // Evaluate strategy
        let result;
        try {
            result = await strat.evaluatePosition(
                history,
                position ? position.side : null,
                equity,
                position ? position.entryPrice : null,
                currentPnl
            );
        } catch (e) {
            logger.error(`[BACKTEST] eval threw @${i}: ${e.message}`);
            continue;
        }

        const sig = (result && result.signal) || "NONE";

        // ── Handle EXITS ──
        if (position && (sig === "CLOSE_LONG" || sig === "CLOSE_SHORT" || sig === "FORCE_CLOSE")) {
            // Determine exit price pessimistically
            let exitPrice = bar.c;
            const reason = result.reason || "signal";

            if (reason === "stop-loss" && Number.isFinite(position.stopLoss)) {
                // Assume filled at stop level
                exitPrice = position.stopLoss;
            } else if (reason === "take-profit" && Number.isFinite(position.takeProfit)) {
                exitPrice = position.takeProfit;
            }
            // trailing-stop exits at close in this model

            // Realized PnL calc
            const grossPct = pctMove(position.side, position.entryPrice, exitPrice);
            const notional = position.sizeUnits * position.entryPrice;
            const leverage = notional / startEquity;
            const netPct = grossPct - feePct;
            const realizedPctOfEquity = netPct * leverage;
            const realizedUsd = (realizedPctOfEquity / 100) * startEquity;

            equity += realizedUsd;

            // Drive real accounting path
            try {
                strat.notifyExit(bar.t, undefined, {
                    side: position.side,
                    entryPrice: position.entryPrice,
                    exitPrice,
                });
            } catch (e) {
                logger.warn(`[BACKTEST] notifyExit threw: ${e.message}`);
            }

            trades.push({
                coin,
                side: position.side,
                entryTs: position.entryTs,
                exitTs: bar.t,
                entryPrice: position.entryPrice,
                exitPrice,
                reason,
                grossPct: +grossPct.toFixed(4),
                feePct: +feePct.toFixed(4),
                netPctOfEquity: +realizedPctOfEquity.toFixed(4),
                realizedUsd: +realizedUsd.toFixed(2),
                leverage: +leverage.toFixed(2),
                regimeAtEntry: position.regimeAtEntry,
            });

            position = null;
        }

        // ── Handle ENTRIES ──
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
        equityCurve.push({ t: bar.t, equity: +equity.toFixed(2) });
        if (equity > peakEquity) peakEquity = equity;
        const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    }

    // 4) Metrics
    const wins = trades.filter((t) => t.realizedUsd > 0);
    const losses = trades.filter((t) => t.realizedUsd <= 0);
    const grossWin = wins.reduce((s, t) => s + t.realizedUsd, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedUsd, 0));
    const netPnlUsd = equity - startEquity;

    // Sharpe ratio calculation
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
    const barsPerYear = { "1m": 525600, "5m": 105120, "15m": 35040, "1h": 8760, "4h": 2190, "1d": 365 }[interval] || 35040;
    const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(barsPerYear) : 0;

    // Per-regime breakdown
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
        trades,
        equityCurve,
    };
}

module.exports = { backtestBbrsi };
