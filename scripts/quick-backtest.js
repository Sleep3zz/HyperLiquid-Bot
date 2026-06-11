/**
 * Optimized Backtest - Streaming indicators (O(n) instead of O(n²))
 */
const { loadCandles } = require('../src/utils/dataManager');
const { RSI, BollingerBands, ADX } = require('trading-signals');

async function optimizedBacktest(coin, days) {
    console.log(`\n=== ${coin} ${days}-Day Optimized Backtest ===`);
    
    const allCandles = loadCandles(coin, '15m');
    const candles = allCandles.slice(-days * 96);
    console.log(`Using ${candles.length} candles`);
    
    // Setup indicators (single pass)
    const bb = new BollingerBands(20, 2);
    const rsi = new RSI(14);
    const adx = new ADX(14);
    
    const warmup = 50;
    let position = null;
    let equity = 10000;
    const trades = [];
    
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        
        // Update indicators
        bb.update(c.c);
        rsi.update(c.c);
        adx.update({ high: c.h, low: c.l, close: c.c });
        
        if (i < warmup) continue;
        
        // Get indicator values
        const bbResult = bb.getResult();
        const rsiVal = parseFloat(rsi.getResult().valueOf());
        const adxVal = parseFloat(adx.getResult().valueOf());
        
        const lower = parseFloat(bbResult.lower.valueOf());
        const upper = parseFloat(bbResult.upper.valueOf());
        
        // Check exit if in position
        if (position) {
            const pnl = position.side === 'LONG' 
                ? ((c.c - position.entry) / position.entry) * 100
                : ((position.entry - c.c) / position.entry) * 100;
            
            // Simple exit: stop loss or take profit
            if (pnl <= -2 || pnl >= 3) {
                trades.push({
                    side: position.side,
                    entry: position.entry,
                    exit: c.c,
                    pnl: pnl,
                    realized: (pnl / 100) * 100 // simplified
                });
                equity += (pnl / 100) * 100;
                position = null;
            }
        }
        
        // Check entry if flat
        else if (rsiVal < 35 && c.c < lower && adxVal < 20) {
            position = { side: 'LONG', entry: c.c, time: c.t };
        }
        else if (rsiVal > 65 && c.c > upper && adxVal < 20) {
            position = { side: 'SHORT', entry: c.c, time: c.t };
        }
    }
    
    console.log(`Trades: ${trades.length}`);
    console.log(`Equity: $${equity.toFixed(2)}`);
    console.log(`Net PnL: $${(equity - 10000).toFixed(2)}`);
    
    if (trades.length > 0) {
        const wins = trades.filter(t => t.pnl > 0).length;
        console.log(`Win Rate: ${(wins / trades.length * 100).toFixed(1)}%`);
        console.log(`Avg Trade: $${trades.reduce((a, t) => a + t.realized, 0) / trades.length}`);
    }
    
    return { trades, equity };
}

(async () => {
    await optimizedBacktest('BTC', 90);
    await optimizedBacktest('ETH', 90);
})();
