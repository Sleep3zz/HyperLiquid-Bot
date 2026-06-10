// Fast O(n) backtest — native JS, no Big.js, no trading-signals
// Calculates indicators incrementally (rolling windows) for speed.

function rollingBollinger(closes, period = 20, stdDev = 2) {
    const results = [];
    let sum = 0, sumSq = 0;
    const arr = [];

    for (let i = 0; i < closes.length; i++) {
        const c = closes[i];
        arr.push(c);
        sum += c;
        sumSq += c * c;

        if (arr.length > period) {
            const old = arr.shift();
            sum -= old;
            sumSq -= old * old;
        }

        if (arr.length === period) {
            const mean = sum / period;
            const variance = sumSq / period - mean * mean;
            const sd = Math.sqrt(variance);
            results.push({
                middle: mean,
                upper: mean + stdDev * sd,
                lower: mean - stdDev * sd,
            });
        } else {
            results.push({ middle: null, upper: null, lower: null });
        }
    }
    return results;
}

function rollingRSI(closes, period = 14) {
    const results = [];
    let gains = 0, losses = 0;
    const gainArr = [], lossArr = [];

    for (let i = 0; i < closes.length; i++) {
        if (i === 0) {
            results.push(null);
            continue;
        }
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;

        gainArr.push(gain);
        lossArr.push(loss);
        gains += gain;
        losses += loss;

        if (gainArr.length > period) {
            gains -= gainArr.shift();
            losses -= lossArr.shift();
        }

        if (gainArr.length === period) {
            const avgGain = gains / period;
            const avgLoss = losses / period;
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            const rsi = 100 - 100 / (1 + rs);
            results.push(rsi);
        } else {
            results.push(null);
        }
    }
    return results;
}

function rollingADX(candles, period = 14) {
    const results = [];
    let plusDM = 0, minusDM = 0, trSum = 0;
    const plusDMArr = [], minusDMArr = [], trArr = [];
    let prevHigh = null, prevLow = null, prevClose = null;

    for (let i = 0; i < candles.length; i++) {
        const { h, l, c } = candles[i];

        if (prevHigh === null) {
            results.push(null);
            prevHigh = h; prevLow = l; prevClose = c;
            continue;
        }

        const upMove = h - prevHigh;
        const downMove = prevLow - l;
        const plus = upMove > downMove && upMove > 0 ? upMove : 0;
        const minus = downMove > upMove && downMove > 0 ? downMove : 0;
        const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));

        plusDMArr.push(plus);
        minusDMArr.push(minus);
        trArr.push(tr);
        plusDM += plus;
        minusDM += minus;
        trSum += tr;

        if (plusDMArr.length > period) {
            plusDM -= plusDMArr.shift();
            minusDM -= minusDMArr.shift();
            trSum -= trArr.shift();
        }

        if (plusDMArr.length === period) {
            const plusDI = 100 * plusDM / trSum;
            const minusDI = 100 * minusDM / trSum;
            const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
            results.push(dx); // raw DX, smoothed ADX would need second pass
        } else {
            results.push(null);
        }

        prevHigh = h; prevLow = l; prevClose = c;
    }
    return results;
}

function fastBacktestBbrsi(candles, opts = {}) {
    const p = {
        rsiOversold: opts.rsiOversold ?? 25,
        rsiOverbought: opts.rsiOverbought ?? 75,
        bbStdDev: opts.bbStdDev ?? 2,
        adxThreshold: opts.adxThreshold ?? 25,
        stopLossPercent: opts.stopLossPercent ?? 2,
        profitTarget: opts.profitTarget ?? 3,
        roundTripFee: opts.roundTripFee ?? 0.09,
    };

    const closes = candles.map(c => c.c);
    const bb = rollingBollinger(closes, 20, p.bbStdDev);
    const rsi = rollingRSI(closes, 14);
    const adx = rollingADX(candles, 14);

    const warmup = 50;
    let position = null;
    const trades = [];

    // diagnostic counters
    const cnt = { bars: 0, bounceUp: 0, bounceDown: 0, rsiLow: 0, rsiHigh: 0, adxLow: 0, longAll: 0, shortAll: 0 };

    for (let i = warmup; i < candles.length; i++) {
        cnt.bars++;
        const bar = candles[i];

        // ---- exits first ----
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
                trades.push({ side: position.side, entry: position.entry, exit, reason,
                    netPct: +(gross - p.roundTripFee).toFixed(4), entryTs: position.entryTs, exitTs: bar.t });
                position = null;
            }
        }

        // ---- entries when flat ----
        if (!position) {
            const prevC = closes[i - 1];
            const bounceUp = prevC <= bb[i].lower && bar.c > bb[i].lower;
            const bounceDown = prevC >= bb[i].upper && bar.c < bb[i].upper;
            const rsiLow = rsi[i] < p.rsiOversold;
            const rsiHigh = rsi[i] > p.rsiOverbought;
            const adxLow = adx[i] < p.adxThreshold;

            if (bounceUp) cnt.bounceUp++; if (bounceDown) cnt.bounceDown++;
            if (rsiLow) cnt.rsiLow++; if (rsiHigh) cnt.rsiHigh++;
            if (adxLow) cnt.adxLow++;

            const longSig = bounceUp && rsiLow && adxLow;
            const shortSig = bounceDown && rsiHigh && adxLow;

            if (longSig) {
                cnt.longAll++;
                position = {
                    side: "LONG", entry: bar.c, entryTs: bar.t,
                    stop: bar.c * (1 - p.stopLossPercent / 100),
                    tp: bar.c * (1 + p.profitTarget / 100),
                };
            } else if (shortSig) {
                cnt.shortAll++;
                position = {
                    side: "SHORT", entry: bar.c, entryTs: bar.t,
                    stop: bar.c * (1 + p.stopLossPercent / 100),
                    tp: bar.c * (1 - p.profitTarget / 100),
                };
            }
        }
    }

    // ---- metrics ----
    const wins = trades.filter((t) => t.netPct > 0);
    const losses = trades.filter((t) => t.netPct <= 0);
    const sumWin = wins.reduce((s, t) => s + t.netPct, 0);
    const sumLoss = Math.abs(losses.reduce((s, t) => s + t.netPct, 0));
    const netPct = trades.reduce((s, t) => s + t.netPct, 0);

    // equity curve (compounding each trade's netPct) for drawdown + Sharpe
    let eq = 1, peak = 1, maxDD = 0;
    const rets = [];
    for (const t of trades) {
        const prev = eq;
        eq *= 1 + t.netPct / 100;
        rets.push(eq / prev - 1);
        if (eq > peak) peak = eq;
        const dd = (peak - eq) / peak;
        if (dd > maxDD) maxDD = dd;
    }
    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const variance = rets.length
        ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length
        : 0;
    const stdev = Math.sqrt(variance);
    // Per-TRADE Sharpe (not annualized — trade count varies). Comparable across runs.
    const sharpePerTrade = stdev > 0 ? mean / stdev : 0;

    return {
        params: {
            rsiOversold: p.rsiOversold, rsiOverbought: p.rsiOverbought,
            bbStdDev: p.bbStdDev, adxThreshold: p.adxThreshold,
            stopLossPercent: p.stopLossPercent, profitTarget: p.profitTarget,
        },
        barsEvaluated: cnt.bars,
        totalTrades: trades.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate: trades.length ? +(wins.length / trades.length).toFixed(3) : 0,
        avgWinPct: wins.length ? +(sumWin / wins.length).toFixed(3) : 0,
        avgLossPct: losses.length ? +(sumLoss / losses.length).toFixed(3) : 0,
        profitFactor: sumLoss > 0 ? +(sumWin / sumLoss).toFixed(2) : (sumWin > 0 ? Infinity : 0),
        netReturnPct: +netPct.toFixed(2), // sum of per-trade net % (after fees)
        compoundedReturnPct: +((eq - 1) * 100).toFixed(2),
        maxDrawdownPct: +(maxDD * 100).toFixed(2),
        sharpePerTrade: +sharpePerTrade.toFixed(3),
        // diagnostics: WHY you get the trade count you get
        conditionHits: {
            bounceUp: cnt.bounceUp, bounceDown: cnt.bounceDown,
            rsiLow: cnt.rsiLow, rsiHigh: cnt.rsiHigh, adxLow: cnt.adxLow,
            fullLong: cnt.longAll, fullShort: cnt.shortAll,
        },
        trades,
    };
}

module.exports = { fastBacktestBbrsi, rollingBollinger, rollingRSI, rollingADX };
