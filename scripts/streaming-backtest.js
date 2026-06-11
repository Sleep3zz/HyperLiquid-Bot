/**
 * Optimized O(n) Streaming Backtest
 * 
 * Uses incremental indicator updates instead of recalculating from scratch.
 * Complexity: O(n) instead of O(n²)
 * 
 * Usage:
 *   node scripts/streaming-backtest.js --coin BTC --days 7
 *   node scripts/streaming-backtest.js --coin ETH --days 90
 */

const { loadCandles } = require('../src/utils/dataManager');
const { BBRSIStrategy } = require('../src/strategy/BBRSIStrategy');
const { RSI, BollingerBands, ADX } = require('trading-signals');

// Parse args
const args = process.argv.slice(2);
const coinArg = (args.find(a => a.startsWith('--coin'))?.split('=')[1] || 'BTC').toUpperCase();
const daysArg = parseInt(args.find(a => a.startsWith('--days'))?.split('=')[1] || '7');

class StreamingBacktest {
    constructor(coin, equity = 10000) {
        this.coin = coin;
        this.startEquity = equity;
        this.equity = equity;
        this.peakEquity = equity;
        this.maxDrawdownPct = 0;
        
        // Streaming indicators
        this.bb = new BollingerBands(20, 1.5);
        this.rsi = new RSI(14);
        this.adx = new ADX(14);
        
        this.position = null;
        this.trades = [];
        this.equityCurve = [];
        
        // Warmup counter
        this.warmup = 50;
        this.barCount = 0;
    }

    updateIndicators(candle) {
        // Incremental updates - O(1) per bar
        this.bb.update(candle.c);
        this.rsi.update(candle.c);
        this.adx.update({ high: candle.h, low: candle.l, close: candle.c });
        this.barCount++;
    }

    getIndicatorValues() {
        const bbResult = this.bb.getResult();
        return {
            lower: parseFloat(bbResult.lower.valueOf()),
            middle: parseFloat(bbResult.middle.valueOf()),
            upper: parseFloat(bbResult.upper.valueOf()),
            rsi: parseFloat(this.rsi.getResult().valueOf()),
            adx: parseFloat(this.adx.getResult().valueOf())
        };
    }

    checkEntry(ind, currentPrice, previousPrice) {
        const bouncedUpFromLower = previousPrice <= ind.lower && currentPrice > ind.lower;
        const bouncedDownFromUpper = previousPrice >= ind.upper && currentPrice < ind.upper;
        
        // MODIFIED parameters: RSI 40/60, ADX < 35
        const longConditions = bouncedUpFromLower && ind.rsi < 40 && ind.adx < 35;
        const shortConditions = bouncedDownFromUpper && ind.rsi > 60 && ind.adx < 35;
        
        if (longConditions) return { side: 'LONG', price: currentPrice };
        if (shortConditions) return { side: 'SHORT', price: currentPrice };
        return null;
    }

    checkExit(ind, currentPrice) {
        if (!this.position) return null;
        
        const entry = this.position.entryPrice;
        const direction = this.position.side === 'LONG' ? 1 : -1;
        const pnlPct = ((currentPrice - entry) / entry) * 100 * direction;
        
        // Simple stop/target: 2% stop, 3% target
        if (pnlPct <= -2) {
            return { price: currentPrice, pnlPct, reason: 'stop-loss' };
        }
        if (pnlPct >= 3) {
            return { price: currentPrice, pnlPct, reason: 'take-profit' };
        }
        return null;
    }

    executeTrade(candle, entry) {
        const stopLoss = entry.side === 'LONG' 
            ? entry.price * 0.98 
            : entry.price * 1.02;
        const takeProfit = entry.side === 'LONG'
            ? entry.price * 1.03
            : entry.price * 0.97;
        
        // Position sizing: 10% of equity per trade
        const positionSize = (this.equity * 0.10) / entry.price;
        
        this.position = {
            side: entry.side,
            entryPrice: entry.price,
            entryTime: candle.t,
            size: positionSize,
            stopLoss,
            takeProfit
        };
    }

    closeTrade(candle, exit) {
        const direction = this.position.side === 'LONG' ? 1 : -1;
        const grossPnl = ((exit.price - this.position.entryPrice) / this.position.entryPrice) * 100 * direction;
        const fee = 0.09; // Round-trip fee
        const netPnl = grossPnl - fee;
        
        const realizedUsd = (netPnl / 100) * this.equity;
        this.equity += realizedUsd;
        
        this.trades.push({
            coin: this.coin,
            side: this.position.side,
            entryTs: this.position.entryTime,
            exitTs: candle.t,
            entryPrice: this.position.entryPrice,
            exitPrice: exit.price,
            grossPnl,
            netPnl,
            realizedUsd,
            reason: exit.reason
        });
        
        this.position = null;
    }

    updateEquityCurve(candle) {
        this.equityCurve.push({ t: candle.t, equity: this.equity });
        if (this.equity > this.peakEquity) {
            this.peakEquity = this.equity;
        }
        const dd = ((this.peakEquity - this.equity) / this.peakEquity) * 100;
        if (dd > this.maxDrawdownPct) {
            this.maxDrawdownPct = dd;
        }
    }

    run(candles) {
        console.log(`\nStreaming backtest: ${this.coin}, ${candles.length} candles`);
        const startTime = Date.now();
        
        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];
            const prevCandle = i > 0 ? candles[i - 1] : candle;
            
            // Update indicators (O(1))
            this.updateIndicators(candle);
            
            // Skip warmup
            if (this.barCount < this.warmup) {
                this.updateEquityCurve(candle);
                continue;
            }
            
            const ind = this.getIndicatorValues();
            
            // Check exit if in position
            if (this.position) {
                const exit = this.checkExit(ind, candle.c);
                if (exit) {
                    this.closeTrade(candle, exit);
                }
            }
            // Check entry if flat
            else {
                const entry = this.checkEntry(ind, candle.c, prevCandle.c);
                if (entry) {
                    this.executeTrade(candle, entry);
                }
            }
            
            this.updateEquityCurve(candle);
        }
        
        const duration = Date.now() - startTime;
        return this.generateReport(duration);
    }

    generateReport(durationMs) {
        const wins = this.trades.filter(t => t.realizedUsd > 0);
        const losses = this.trades.filter(t => t.realizedUsd <= 0);
        const grossWin = wins.reduce((s, t) => s + t.realizedUsd, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedUsd, 0));
        
        return {
            coin: this.coin,
            candles: this.barCount,
            duration: (durationMs / 1000).toFixed(2) + 's',
            startEquity: this.startEquity,
            endEquity: this.equity,
            netPnlUsd: this.equity - this.startEquity,
            netPnlPct: ((this.equity - this.startEquity) / this.startEquity * 100).toFixed(2),
            totalTrades: this.trades.length,
            winningTrades: wins.length,
            losingTrades: losses.length,
            winRate: this.trades.length ? (wins.length / this.trades.length * 100).toFixed(1) : 0,
            profitFactor: grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? '∞' : 0,
            maxDrawdownPct: this.maxDrawdownPct.toFixed(2),
            trades: this.trades
        };
    }
}

async function main() {
    console.log('=== O(n) Streaming Backtest ===');
    console.log(`Coin: ${coinArg}, Days: ${daysArg}`);
    
    const allCandles = loadCandles(coinArg, '15m');
    const candles = allCandles.slice(-daysArg * 96);
    
    console.log(`Loaded ${candles.length} candles`);
    console.log(`Date range: ${new Date(candles[0].t).toISOString().split('T')[0]} to ${new Date(candles[candles.length-1].t).toISOString().split('T')[0]}`);
    
    const backtest = new StreamingBacktest(coinArg);
    const result = backtest.run(candles);
    
    console.log('\n=== RESULTS ===');
    console.log(`Duration: ${result.duration}`);
    console.log(`Candles processed: ${result.candles}`);
    console.log(`Trades: ${result.totalTrades}`);
    console.log(`Net PnL: $${result.netPnlUsd.toFixed(2)} (${result.netPnlPct}%)`);
    
    if (result.totalTrades > 0) {
        console.log(`Win Rate: ${result.winRate}%`);
        console.log(`Profit Factor: ${result.profitFactor}`);
        console.log(`Max Drawdown: ${result.maxDrawdownPct}%`);
        console.log('\nRecent trades:');
        result.trades.slice(-5).forEach((t, i) => {
            console.log(`  ${i+1}. ${t.side} @ $${t.entryPrice.toFixed(2)} -> $${t.exitPrice.toFixed(2)} | PnL: $${t.realizedUsd.toFixed(2)} | ${t.reason}`);
        });
    } else {
        console.log('\nNo trades generated. Market conditions did not meet entry criteria.');
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
