/**
 * BBRSI Backtest (O(n), CORRECT indicators - uses PRE-COMPUTED values).
 *
 * Uses trading-signals pre-computed indicator values from
 * data/indicators/<coin>/<interval>-indicators.json
 *
 * The pre-computation is done by scripts/precompute-indicators.js which
 * uses the SAME trading-signals library as the live strategy.
 *
 * INVARIANT: indicator values here are IDENTICAL to what indicators/index.js
 * computes because they come from the same source.
 *
 * Anti-look-ahead: at bar i, indicators reflect candles[0..i]; a signal at
 * bar i fills at bar i close; exits checked vs bar i high/low; same-bar
 * SL+TP resolves to STOP first (pessimistic).
 */
const fs = require('fs');
const path = require('path');

function loadPrecomputedIndicators(coin, interval) {
    const filePath = path.join(__dirname, '..', '..', 'data', 'indicators', coin, `${interval}-indicators.json`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Pre-computed indicators not found: ${filePath}\nRun: node scripts/precompute-indicators.js --coin ${coin}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fastBacktestBbrsi(candlesRaw, params = {}) {
    const p = {
        coin: 'ETH',
        interval: '15m',
        rsiOversold: 25,
        rsiOverbought: 75,
        adxThreshold: 25,
        stopLossPercent: 1.5,
        profitTarget: 2.0,
        takerFeeRate: 0.00045,
        ...params,
    };

    // Normalize candles
    const candles = candlesRaw
        .map((c) => ({
            t: Number(c.t ?? c.openTime),
            o: Number(c.o ?? c.open),
            h: Number(c.h ?? c.high),
            l: Number(c.l ?? c.low),
            c: Number(c.c ?? c.close),
        }))
        .filter((c) => [c.h, c.l, c.c].every(Number.isFinite))
        .sort((a, b) => a.t - b.t);

    // Load pre-computed indicators
    const indicators = loadPrecomputedIndicators(p.coin, p.interval);
    
    // Build timestamp -> indicator map for O(1) lookup
    const indicatorMap = new Map();
    for (const v of indicators.values) {
        indicatorMap.set(v.t, v);
    }

    const roundTripFee = p.takerFeeRate * 2 * 100;
    let position = null;
    let prevClose = null;
    const trades = [];
    const cnt = { bars: 0, bounceUp: 0, bounceDown: 0, rsiLow: 0, rsiHigh: 0, adxLow: 0, fullLong: 0, fullShort: 0 };

    for (let i = 0; i < candles.length; i++) {
        const bar = candles[i];
        
        // Look up pre-computed indicators (O(1))
        const ind = indicatorMap.get(bar.t);
        if (!ind || ind.rsi === null || ind.adx === null || ind.bbLower === null) {
            prevClose = bar.c;
            continue; // warmup period
        }
        
        const rsiVal = ind.rsi;
        const adxVal = ind.adx;
        const bbUpper = ind.bbUpper;
        const bbLower = ind.bbLower;
        
        cnt.bars++;

        // ---- exits first (bar high/low) ----
        if (position) {
            let exit = null, reason = null;
            if (position.side === "LONG") {
                if (bar.l <= position.stop) { exit = position.stop; reason = "stop-loss"; }
                else if (bar.h >= position.tp) { exit = position.tp; reason = "take-profit"; }
            } else {
                if (bar.h >= position.stop) { exit = position.stop; reason = "stop-loss"; }
                else if (bar.l <= position.tp) { exit = position.tp; reason = "take-profit"; }
            }
            if (exit != null) {
                const gross = position.side === "LONG"
                    ? ((exit - position.entry) / position.entry) * 100
                    : ((position.entry - exit) / position.entry) * 100;
                trades.push({
                    side: position.side,
                    entry: position.entry,
                    exit,
                    reason,
                    netPct: +(gross - roundTripFee).toFixed(4),
                    entryTs: position.entryTs,
                    exitTs: bar.t,
                    rsiAtEntry: position.rsiAtEntry,
                    adxAtEntry: position.adxAtEntry,
                });
                position = null;
            }
        }

        // ---- entries when flat ----
        if (!position && prevClose != null) {
            const bounceUp = prevClose <= bbLower && bar.c > bbLower;
            const bounceDown = prevClose >= bbUpper && bar.c < bbUpper;
            const rsiLow = rsiVal < p.rsiOversold;
            const rsiHigh = rsiVal > p.rsiOverbought;
            const adxLow = adxVal < p.adxThreshold;

            if (bounceUp) cnt.bounceUp++;
            if (bounceDown) cnt.bounceDown++;
            if (rsiLow) cnt.rsiLow++;
            if (rsiHigh) cnt.rsiHigh++;
            if (adxLow) cnt.adxLow++;

            const longSig = bounceUp && rsiLow && adxLow;
            const shortSig = bounceDown && rsiHigh && adxLow;

            if (longSig) {
                cnt.fullLong++;
                position = {
                    side: "LONG",
                    entry: bar.c,
                    entryTs: bar.t,
                    stop: bar.c * (1 - p.stopLossPercent / 100),
                    tp: bar.c * (1 + p.profitTarget / 100),
                    rsiAtEntry: +rsiVal.toFixed(2),
                    adxAtEntry: +adxVal.toFixed(2),
                };
            } else if (shortSig) {
                cnt.fullShort++;
                position = {
                    side: "SHORT",
                    entry: bar.c,
                    entryTs: bar.t,
                    stop: bar.c * (1 + p.stopLossPercent / 100),
                    tp: bar.c * (1 - p.profitTarget / 100),
                    rsiAtEntry: +rsiVal.toFixed(2),
                    adxAtEntry: +adxVal.toFixed(2),
                };
            }
        }

        prevClose = bar.c;
    }

    // ---- metrics ----
    const wins = trades.filter((t) => t.netPct > 0);
    const losses = trades.filter((t) => t.netPct <= 0);
    const sumWin = wins.reduce((s, t) => s + t.netPct, 0);
    const sumLoss = Math.abs(losses.reduce((s, t) => s + t.netPct, 0));
    const netPct = trades.reduce((s, t) => s + t.netPct, 0);

    let eq = 1, peak = 1, maxDD = 0;
    for (const t of trades) {
        eq *= 1 + t.netPct / 100;
        if (eq > peak) peak = eq;
        const dd = (peak - eq) / peak;
        if (dd > maxDD) maxDD = dd;
    }

    return {
        params: {
            coin: p.coin,
            rsiOversold: p.rsiOversold,
            rsiOverbought: p.rsiOverbought,
            adxThreshold: p.adxThreshold,
            stopLossPercent: p.stopLossPercent,
            profitTarget: p.profitTarget,
        },
        barsEvaluated: cnt.bars,
        totalTrades: trades.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate: trades.length ? +(wins.length / trades.length).toFixed(3) : 0,
        avgWinPct: wins.length ? +(sumWin / wins.length).toFixed(3) : 0,
        avgLossPct: losses.length ? +(sumLoss / losses.length).toFixed(3) : 0,
        profitFactor: sumLoss > 0 ? +(sumWin / sumLoss).toFixed(2) : (sumWin > 0 ? null : 0),
        netReturnPct: +netPct.toFixed(2),
        compoundedReturnPct: +((eq - 1) * 100).toFixed(2),
        maxDrawdownPct: +(maxDD * 100).toFixed(2),
        conditionHits: {
            bounceUp: cnt.bounceUp,
            bounceDown: cnt.bounceDown,
            rsiLow: cnt.rsiLow,
            rsiHigh: cnt.rsiHigh,
            adxLow: cnt.adxLow,
            fullLong: cnt.fullLong,
            fullShort: cnt.fullShort,
        },
        trades,
    };
}

module.exports = { fastBacktestBbrsi };
