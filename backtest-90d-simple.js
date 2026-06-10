#!/usr/bin/env node
/**
 * Simple 90-Day BBRSI Backtest for BTC/ETH/SOL/HYPE
 * Uses synthetic data and the refactored BBRSIStrategy
 */

const fs = require('fs');
const path = require('path');
const { BBRSIStrategy } = require('./src/strategy/BBRSIStrategy');

const COINS = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP', 'HYPE-PERP'];
const DAYS = 90;
const TIMEFRAME = '15m';
const INITIAL_CAPITAL = 10000;

// Load synthetic data
function loadData(coin) {
    const filePath = path.join(__dirname, 'data', 'historical', `${coin.replace('-PERP', '')}_15m_90d.json`);
    if (!fs.existsSync(filePath)) {
        console.error(`Data not found: ${filePath}`);
        return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Mock config
const mockConfig = {
    trading: {
        market: 'BTC',
        timeframe: '15m',
        profitTarget: 2.0,
        stopLossPercent: 1.5,
        riskPerTrade: 1.0,
        maxLeverage: 5,
        assetMaxLeverage: 10,
        takerFeeRate: 0.00045,
        liqSafetyBuffer: 0.005,
        mode: 'reversion',
        trailingStopPercent: 0.8,
        dailyLossLimitPercent: 3.0,
        cooldownPeriod: 1,
        persistDebounceMs: 5000,
        minOrderSize: 0
    },
    indicators: {
        rsi: { period: 14, overbought: 75, oversold: 25 },
        bollinger: { period: 20, stdDev: 2 },
        adx: { period: 14, threshold: 25 }
    }
};

// Mock jest config for standalone run
if (!global.jest) {
    require('config').get = (key) => mockConfig[key];
}

class SimpleBacktest {
    constructor(coin, data) {
        this.coin = coin;
        this.data = data;
        this.capital = INITIAL_CAPITAL;
        this.position = null; // { side, entryPrice, size, entryTime }
        this.trades = [];
        this.dailyPnl = [];
        
        this.strategy = new BBRSIStrategy({
            info: (...args) => {},
            warn: (...args) => console.warn(`[${coin}]`, ...args),
            error: (...args) => console.error(`[${coin}]`, ...args)
        });
    }

    async run() {
        console.log(`\n========================================`);
        console.log(`Backtesting ${this.coin}`);
        console.log(`Bars: ${this.data.length} (${DAYS} days)`);
        console.log(`Initial Capital: $${INITIAL_CAPITAL.toLocaleString()}`);
        console.log(`========================================\n`);

        const startTime = Date.now();
        let barCount = 0;

        for (let i = 20; i < this.data.length; i++) {
            // Get window of data for indicators
            const window = this.data.slice(0, i + 1);
            const currentBar = this.data[i];
            
            // Calculate current PnL if in position
            let currentPnl = 0;
            if (this.position) {
                const price = parseFloat(currentBar.c);
                if (this.position.side === 'LONG') {
                    currentPnl = ((price - this.position.entryPrice) / this.position.entryPrice) * 100;
                } else {
                    currentPnl = ((this.position.entryPrice - price) / this.position.entryPrice) * 100;
                }
            }

            // Call strategy
            const result = await this.strategy.evaluatePosition(
                window,
                this.position?.side || null,
                this.capital,
                this.position?.entryPrice || null,
                currentPnl
            );

            // Process signal
            await this.processSignal(result, currentBar, i);
            
            barCount++;
            if (barCount % 1000 === 0) {
                process.stdout.write(`Progress: ${((i / this.data.length) * 100).toFixed(1)}%\r`);
            }
        }

        // Close any open position at end
        if (this.position) {
            const lastBar = this.data[this.data.length - 1];
            this.closePosition(lastBar, 'end-of-test');
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        return this.generateReport(duration);
    }

    async processSignal(result, bar, index) {
        const price = parseFloat(bar.c);

        // Entry signals
        if (result.signal === 'LONG' || result.signal === 'SHORT') {
            // Close existing position if any
            if (this.position) {
                this.closePosition(bar, 'reversal');
            }
            
            // Enter new position
            const side = result.signal === 'LONG' ? 'LONG' : 'SHORT';
            const size = (this.capital * 0.1) / price; // 10% position size
            
            this.position = {
                side,
                entryPrice: price,
                size,
                entryTime: bar.t,
                stopLoss: result.stopLoss,
                takeProfit: result.takeProfit
            };

            // Notify strategy of entry
            const fp = this.strategy._positionFingerprint(side, price);
            this.strategy.positionFingerprint = fp;
        }

        // Exit signals
        if (result.signal?.startsWith('CLOSE_') && this.position) {
            this.closePosition(bar, result.reason || 'signal');
        }
    }

    closePosition(bar, reason) {
        if (!this.position) return;

        const exitPrice = parseFloat(bar.c);
        const entryPrice = this.position.entryPrice;
        const size = this.position.size;
        
        let pnlPercent = 0;
        if (this.position.side === 'LONG') {
            pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
        } else {
            pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
        }

        // Apply leverage
        pnlPercent *= 5; // 5x leverage

        // Apply fees (0.09% round-trip)
        pnlPercent -= 0.09;

        const pnlAmount = (this.capital * 0.1) * (pnlPercent / 100);
        this.capital += pnlAmount;

        this.trades.push({
            side: this.position.side,
            entryPrice,
            exitPrice,
            entryTime: this.position.entryTime,
            exitTime: bar.t,
            pnlPercent,
            pnlAmount,
            reason
        });

        // Notify strategy
        this.strategy.notifyExit(
            bar.t,
            pnlPercent,
            {
                side: this.position.side,
                entryPrice,
                exitPrice
            }
        );

        this.position = null;
    }

    generateReport(duration) {
        const winningTrades = this.trades.filter(t => t.pnlAmount > 0);
        const losingTrades = this.trades.filter(t => t.pnlAmount <= 0);
        
        const totalReturn = ((this.capital - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;
        const winRate = this.trades.length > 0 ? (winningTrades.length / this.trades.length) * 100 : 0;
        
        // Calculate max drawdown
        let peak = INITIAL_CAPITAL;
        let maxDrawdown = 0;
        let runningCapital = INITIAL_CAPITAL;
        
        for (const trade of this.trades) {
            runningCapital += trade.pnlAmount;
            if (runningCapital > peak) {
                peak = runningCapital;
            }
            const drawdown = ((peak - runningCapital) / peak) * 100;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }

        const profitFactor = losingTrades.reduce((a, t) => a + Math.abs(t.pnlAmount), 0) > 0
            ? winningTrades.reduce((a, t) => a + t.pnlAmount, 0) / losingTrades.reduce((a, t) => a + Math.abs(t.pnlAmount), 0)
            : winningTrades.length > 0 ? Infinity : 0;

        return {
            coin: this.coin,
            initialCapital: INITIAL_CAPITAL,
            finalCapital: this.capital,
            totalReturn,
            totalTrades: this.trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate,
            maxDrawdown,
            profitFactor,
            avgTrade: this.trades.length > 0 ? this.trades.reduce((a, t) => a + t.pnlAmount, 0) / this.trades.length : 0,
            duration: `${duration}s`,
            trades: this.trades.slice(0, 5) // First 5 trades for inspection
        };
    }
}

async function runBacktests() {
    console.log(`\n🚀 90-Day BBRSI Backtest Suite`);
    console.log(`Assets: ${COINS.join(', ')}`);
    console.log(`Strategy: BBRSI v2 (with all safety fixes)`);
    console.log(`Leverage: 5x | Position: 10% | Risk/Trade: 1%\n`);

    const results = [];

    for (const coin of COINS) {
        const data = loadData(coin);
        if (!data) {
            console.error(`Skipping ${coin} - no data`);
            continue;
        }

        const backtest = new SimpleBacktest(coin, data);
        const result = await backtest.run();
        results.push(result);
    }

    // Print summary
    console.log(`\n\n========================================`);
    console.log(`📊 90-DAY BACKTEST SUMMARY`);
    console.log(`========================================\n`);

    // Sort by total return
    results.sort((a, b) => b.totalReturn - a.totalReturn);

    console.log('RANKING BY TOTAL RETURN:');
    console.log('-'.repeat(90));
    console.log(`${'Rank'.padEnd(6)} ${'Asset'.padEnd(12)} ${'Return'.padEnd(12)} ${'Win Rate'.padEnd(12)} ${'Trades'.padEnd(10)} ${'Max DD'.padEnd(12)} ${'Profit Fac'.padEnd(12)}`);
    console.log('-'.repeat(90));

    results.forEach((r, i) => {
        const rank = (i + 1).toString().padEnd(6);
        const asset = r.coin.padEnd(12);
        const ret = `${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(2)}%`.padEnd(12);
        const win = `${r.winRate.toFixed(1)}%`.padEnd(12);
        const trades = r.totalTrades.toString().padEnd(10);
        const dd = `${r.maxDrawdown.toFixed(2)}%`.padEnd(12);
        const pf = r.profitFactor.toFixed(2).padEnd(12);
        console.log(`${rank}${asset}${ret}${win}${trades}${dd}${pf}`);
    });

    const avgReturn = results.reduce((a, b) => a + b.totalReturn, 0) / results.length;
    const avgWinRate = results.reduce((a, b) => a + b.winRate, 0) / results.length;
    const totalTrades = results.reduce((a, b) => a + b.totalTrades, 0);

    console.log('-'.repeat(90));
    console.log(`\nPORTFOLIO SUMMARY:`);
    console.log(`  Average Return: ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%`);
    console.log(`  Average Win Rate: ${avgWinRate.toFixed(1)}%`);
    console.log(`  Total Trades: ${totalTrades}`);
    console.log(`========================================\n`);

    // Save results
    const outputFile = `backtest-results-90d-${Date.now()}.json`;
    fs.writeFileSync(outputFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        config: mockConfig.trading,
        results
    }, null, 2));
    console.log(`📁 Results saved to: ${outputFile}`);
}

// Run
runBacktests().catch(err => {
    console.error('Backtest failed:', err);
    process.exit(1);
});