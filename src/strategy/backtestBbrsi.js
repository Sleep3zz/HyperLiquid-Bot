/**
 * BBRSI Backtest Harness (API-based, 90-day).
 *
 * Drives the REAL BBRSIStrategy.evaluatePosition the same way runBbrsi does,
 * so backtest logic cannot diverge from live logic.
 *
 * Anti-look-ahead: at bar i the strategy sees candles[0..i] only. A signal at
 * bar i fills at bar i's CLOSE. Exits are checked against bar i's high/low,
 * matching the strategy's own evaluateExit. Same-bar SL+TP ambiguity resolves
 * PESSIMISTICALLY (assume stop first) so results are biased worse than reality.
 *
 * Usage:
 * const { backtestBbrsi } = require("./backtestBbrsi");
 * const report = await backtestBbrsi(wayfinder, {
 *   coin: "BTC", interval: "15m", equity: 10000, regimeDetector
 * });
 * console.log(JSON.stringify(report, null, 2));
 */
const { BBRSIStrategy } = require("./BBRSIStrategy");

// A no-op state store so the strategy never touches disk during backtest.
const memoryStore = { load: () => ({}), save: () => {} };

function pctMove(side, entry, exit) {
  const m = ((exit - entry) / entry) * 100;
  return side === "LONG" ? m : -m;
}

async function backtestBbrsi(wayfinder, opts = {}) {
  const coin = opts.coin || "BTC";
  const interval = opts.interval || "15m";
  const startEquity = Number(opts.equity) || 10000;
  const warmup = Number(opts.warmup) || 60; // bars before first eval (indicators need history)
  const regimeDetector = opts.regimeDetector || null; // optional, for per-regime breakdown
  const logger = opts.logger || { info() {}, warn() {}, error() {} };

  // 1) Pull 90 days of candles.
  const raw = await wayfinder.get90DayCandles(coin, interval);
  if (!Array.isArray(raw) || raw.length < warmup + 10) {
    return { ok: false, reason: `insufficient candles (${raw && raw.length})` };
  }
  // Normalize + sort ascending by time (defensive).
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

  // Fresh strategy instance, memory-only state, no real logger noise.
  const strat = new BBRSIStrategy(logger, memoryStore);
  strat.stateStore = memoryStore;

  // Backtest equity model: realized PnL compounds on startEquity.
  let equity = startEquity;
  let position = null; // { side, entryPrice, entryTs, sizeUnits, regimeAtEntry }
  const trades = [];
  const equityCurve = [];
  let peakEquity = startEquity;
  let maxDrawdownPct = 0;

  // Helper: regime label at a given bar index (optional).
  const regimeCache = {};
  async function regimeAt(idx) {
    if (!regimeDetector) return "n/a";
    if (regimeCache[idx] !== undefined) return regimeCache[idx];
    // Feed the detector the slice it would have seen live.
    const slice = candles.slice(Math.max(0, idx - 99), idx + 1);
    // RegimeDetector reads via wayfinder.getHistoricalCandles; for backtest we
    // bypass and classify the slice directly if the detector exposes it.
    if (typeof regimeDetector.classifySlice === "function") {
      return regimeDetector.classifySlice(slice);
    }
    return "n/a";
  }

  // 2) Replay.
  for (let i = warmup; i < candles.length; i++) {
    const bar = candles[i];
    const history = candles.slice(0, i + 1); // strategy sees [0..i]

    // currentPnl for an open position = unrealized %-of-equity at this bar's close.
    let currentPnl = 0;
    if (position) {
      const grossPct = pctMove(position.side, position.entryPrice, bar.c);
      // Convert position %-move into %-of-equity using notional/equity at entry.
      const notional = position.sizeUnits * position.entryPrice;
      const leverage = notional / startEquity; // approximate; backtest uses startEquity base
      currentPnl = grossPct * leverage;
    }

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
      logger.error(`eval threw @${i}: ${e.message}`);
      continue;
    }

    const sig = (result && result.signal) || "NONE";

    // -- Handle EXITS (when in a position) --
    if (position && (sig === "CLOSE_LONG" || sig === "CLOSE_SHORT")) {
      // Determine fill price by exit reason, pessimistically.
      let exitPrice = bar.c; // default: close
      const reason = result.reason || "signal";
      if (reason === "stop-loss") {
        // assume filled at the stop level (or worse = bar low/high)
        exitPrice =
          position.side === "LONG"
            ? Math.min(position.stopLoss ?? bar.l, bar.l <= (position.stopLoss ?? -Infinity) ? bar.l : (position.stopLoss ?? bar.c))
            : Math.max(position.stopLoss ?? bar.h, bar.h >= (position.stopLoss ?? Infinity) ? bar.h : (position.stopLoss ?? bar.c));
        // simpler & safe: use the strategy's stop level if present
        if (Number.isFinite(position.stopLoss)) exitPrice = position.stopLoss;
      } else if (reason === "take-profit" && Number.isFinite(position.takeProfit)) {
        exitPrice = position.takeProfit;
      } else if (reason === "trailing-stop") {
        exitPrice = bar.c; // trail exits resolve at close in this model
      }

      const grossPct = pctMove(position.side, position.entryPrice, exitPrice);
      const feePct = strat.roundTripFeePercent();
      const netPct = grossPct - feePct;

      // %-of-equity realized: scale by leverage used.
      const notional = position.sizeUnits * position.entryPrice;
      const leverage = notional / startEquity;
      const realizedPctOfEquity = netPct * leverage;
      const realizedUsd = (realizedPctOfEquity / 100) * startEquity;

      equity += realizedUsd;

      // Drive the REAL accounting path -- this exercises notifyExit offline.
      strat.notifyExit(bar.t, undefined, {
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice,
      });

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
        netPctOfNotional: +netPct.toFixed(4),
        netPctOfEquity: +realizedPctOfEquity.toFixed(4),
        realizedUsd: +realizedUsd.toFixed(2),
        leverage: +leverage.toFixed(2),
        regimeAtEntry: position.regimeAtEntry,
        barsHeld: trades.length ? undefined : undefined,
      });

      position = null;
    }

    // -- Handle ENTRIES (when flat) --
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

    // -- Equity curve + drawdown --
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
  const variance =
    rets.length
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
