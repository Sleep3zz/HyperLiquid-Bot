#!/usr/bin/env node
/**
 * Single-Coin Parameter Optimization with Persistent Data Storage
 * 
 * Workflow:
 * 1. Download 90-day chart data for coin (save to disk)
 * 2. Run multiple parameter configurations on saved data
 * 3. Store results and recommend best config
 * 
 * Usage: node coin-optimizer.js --coin BTC
 */

const WayfinderAgent = require('../model-router/src/agents/wayfinder-agent');
const fs = require('fs');
const path = require('path');

// Parameter configurations to test
const PARAMETER_SETS = [
    {
        name: 'Conservative',
        leverage: 2,
        positionSize: 0.08,
        profitTarget: 1.0,
        stopLoss: 0.6,
        bbPeriod: 20,
        bbStdDev: 2.0,
        rsiPeriod: 14,
        rsiOverbought: 70,
        rsiOversold: 30,
        adxPeriod: 14,
        adxTrendThreshold: 25
    },
    {
        name: 'Moderate',
        leverage: 3,
        positionSize: 0.10,
        profitTarget: 1.5,
        stopLoss: 1.0,
        bbPeriod: 20,
        bbStdDev: 2.0,
        rsiPeriod: 14,
        rsiOverbought: 70,
        rsiOversold: 30,
        adxPeriod: 14,
        adxTrendThreshold: 25
    },
    {
        name: 'Aggressive',
        leverage: 5,
        positionSize: 0.15,
        profitTarget: 2.5,
        stopLoss: 1.5,
        bbPeriod: 20,
        bbStdDev: 2.5,
        rsiPeriod: 14,
        rsiOverbought: 75,
        rsiOversold: 25,
        adxPeriod: 14,
        adxTrendThreshold: 30
    },
    {
        name: 'High-Risk',
        leverage: 8,
        positionSize: 0.20,
        profitTarget: 4.0,
        stopLoss: 2.5,
        bbPeriod: 15,
        bbStdDev: 2.5,
        rsiPeriod: 10,
        rsiOverbought: 75,
        rsiOversold: 25,
        adxPeriod: 10,
        adxTrendThreshold: 35
    },
    {
        name: 'Mean-Reversion',
        leverage: 4,
        positionSize: 0.12,
        profitTarget: 1.2,
        stopLoss: 0.8,
        bbPeriod: 20,
        bbStdDev: 2.0,
        rsiPeriod: 14,
        rsiOverbought: 65,
        rsiOversold: 35,
        adxPeriod: 14,
        adxTrendThreshold: 20
    },
    {
        name: 'Trend-Following',
        leverage: 5,
        positionSize: 0.10,
        profitTarget: 3.0,
        stopLoss: 1.5,
        bbPeriod: 20,
        bbStdDev: 2.0,
        rsiPeriod: 14,
        rsiOverbought: 80,
        rsiOversold: 20,
        adxPeriod: 14,
        adxTrendThreshold: 35
    }
];

class CoinOptimizer {
    constructor(coin) {
        this.coin = coin.toUpperCase();
        this.agent = new WayfinderAgent({ autoConnect: false });
        
        // Setup directory structure
        this.dataDir = path.join(__dirname, 'data', 'charts', this.coin);
        this.resultsDir = path.join(__dirname, 'data', 'results', this.coin);
        this.optimalDir = path.join(__dirname, 'data', 'optimal');
        
        [this.dataDir, this.resultsDir, this.optimalDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    /**
     * Step 1: Download and save 90-day chart data
     */
    async downloadData(interval = '15m') {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`DOWNLOADING DATA: ${this.coin}`);
        console.log('='.repeat(70));
        console.log(`Fetching 90 days of ${interval} candles...`);
        
        const candles = await this.agent.get90DayCandles(this.coin, interval);
        
        if (!candles || candles.length === 0) {
            throw new Error(`Failed to fetch data for ${this.coin}`);
        }
        
        // Save raw data
        const dataFile = path.join(this.dataDir, `${this.coin}-${interval}-90d.json`);
        const metadata = {
            coin: this.coin,
            interval,
            candles: candles.length,
            days: (candles.length / 96).toFixed(1),
            startTime: new Date(candles[0].t).toISOString(),
            endTime: new Date(candles[candles.length - 1].t).toISOString(),
            downloadedAt: new Date().toISOString()
        };
        
        fs.writeFileSync(dataFile, JSON.stringify({
            metadata,
            candles
        }, null, 2));
        
        console.log(`✅ Saved: ${dataFile}`);
        console.log(`   Candles: ${candles.length} (${metadata.days} days)`);
        console.log(`   Range: ${metadata.startTime} → ${metadata.endTime}`);
        
        return candles;
    }

    /**
     * Load saved chart data
     */
    loadData(interval = '15m') {
        const dataFile = path.join(this.dataDir, `${this.coin}-${interval}-90d.json`);
        
        if (!fs.existsSync(dataFile)) {
            return null;
        }
        
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        console.log(`📁 Loaded cached data: ${data.metadata.candles} candles (${data.metadata.days} days)`);
        return data.candles;
    }

    /**
     * Step 2: Run backtest with specific parameters
     */
    async runBacktest(candles, params) {
        const initialCapital = 10000;
        let equity = initialCapital;
        let position = null;
        const trades = [];
        const equityCurve = [];
        
        const lookback = Math.max(50, params.bbPeriod + 10);
        const tradingFee = 0.001; // 0.1%
        
        for (let i = lookback; i < candles.length; i++) {
            const currentCandle = candles[i];
            const currentPrice = currentCandle.c;
            
            // Get signal
            const lookbackData = candles.slice(i - lookback, i + 1);
            const signal = this.evaluateBBRSI(lookbackData, params);
            
            // Check take profit / stop loss
            if (position) {
                const pnl = this.calculatePnL(
                    position.entryPrice,
                    currentPrice,
                    position.type === 'LONG',
                    position.size,
                    params.leverage
                );
                
                const pnlPercent = (pnl / (initialCapital * position.size)) * 100;
                
                // Take profit
                if (pnlPercent >= params.profitTarget) {
                    const fees = initialCapital * position.size * tradingFee * 2;
                    const netPnL = pnl - fees;
                    
                    equity += netPnL;
                    trades.push({
                        type: position.type,
                        entry: position.entryPrice,
                        exit: currentPrice,
                        pnl: netPnL,
                        exitReason: 'TAKE_PROFIT',
                        timestamp: currentCandle.t
                    });
                    position = null;
                }
                // Stop loss
                else if (pnlPercent <= -params.stopLoss) {
                    const fees = initialCapital * position.size * tradingFee * 2;
                    const netPnL = pnl - fees;
                    
                    equity += netPnL;
                    trades.push({
                        type: position.type,
                        entry: position.entryPrice,
                        exit: currentPrice,
                        pnl: netPnL,
                        exitReason: 'STOP_LOSS',
                        timestamp: currentCandle.t
                    });
                    position = null;
                }
            }
            
            // Enter new position
            if (!position && signal !== 'NONE') {
                position = {
                    type: signal,
                    entryPrice: currentPrice,
                    size: params.positionSize,
                    entryTime: currentCandle.t
                };
            }
            
            // Close on opposite signal
            if (position && 
                ((position.type === 'LONG' && signal === 'SHORT') ||
                 (position.type === 'SHORT' && signal === 'LONG'))) {
                const pnl = this.calculatePnL(
                    position.entryPrice,
                    currentPrice,
                    position.type === 'LONG',
                    position.size,
                    params.leverage
                );
                const fees = initialCapital * position.size * tradingFee * 2;
                const netPnL = pnl - fees;
                
                equity += netPnL;
                trades.push({
                    type: position.type,
                    entry: position.entryPrice,
                    exit: currentPrice,
                    pnl: netPnL,
                    exitReason: 'SIGNAL_REVERSE',
                    timestamp: currentCandle.t
                });
                
                // Enter new position
                position = {
                    type: signal,
                    entryPrice: currentPrice,
                    size: params.positionSize,
                    entryTime: currentCandle.t
                };
            }
            
            equityCurve.push({
                time: currentCandle.t,
                equity: equity,
                price: currentPrice
            });
        }
        
        // Close any open position at end
        if (position) {
            const finalPrice = candles[candles.length - 1].c;
            const pnl = this.calculatePnL(
                position.entryPrice,
                finalPrice,
                position.type === 'LONG',
                position.size,
                params.leverage
            );
            const fees = initialCapital * position.size * tradingFee * 2;
            const netPnL = pnl - fees;
            
            equity += netPnL;
            trades.push({
                type: position.type,
                entry: position.entryPrice,
                exit: finalPrice,
                pnl: netPnL,
                exitReason: 'END_OF_PERIOD',
                timestamp: candles[candles.length - 1].t
            });
        }
        
        return this.calculateMetrics(trades, equityCurve, initialCapital, equity, params);
    }

    /**
     * BBRSI strategy evaluation
     */
    evaluateBBRSI(candles, params) {
        const closes = candles.map(c => c.c);
        const highs = candles.map(c => c.h);
        const lows = candles.map(c => c.l);
        
        const bb = this.calculateBollinger(closes, params.bbPeriod, params.bbStdDev);
        const rsi = this.calculateRSI(closes, params.rsiPeriod);
        const adx = this.calculateADX(highs, lows, closes, params.adxPeriod);
        
        const currentPrice = closes[closes.length - 1];
        const currentRSI = rsi[rsi.length - 1];
        const currentADX = adx[adx.length - 1];
        
        // Long signal: Price below lower band + RSI oversold + not strong trend
        if (currentPrice < bb.lower && 
            currentRSI < params.rsiOversold && 
            currentADX < params.adxTrendThreshold) {
            return 'LONG';
        }
        
        // Short signal: Price above upper band + RSI overbought + not strong trend
        if (currentPrice > bb.upper && 
            currentRSI > params.rsiOverbought && 
            currentADX < params.adxTrendThreshold) {
            return 'SHORT';
        }
        
        return 'NONE';
    }

    calculateBollinger(closes, period, stdDev) {
        const sma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
        const squaredDiffs = closes.slice(-period).map(c => Math.pow(c - sma, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
        const stdev = Math.sqrt(variance);
        
        return {
            middle: sma,
            upper: sma + (stdev * stdDev),
            lower: sma - (stdev * stdDev)
        };
    }

    calculateRSI(closes, period) {
        const gains = [];
        const losses = [];
        
        for (let i = 1; i < closes.length; i++) {
            const change = closes[i] - closes[i-1];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? Math.abs(change) : 0);
        }
        
        const rsi = [];
        let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < gains.length; i++) {
            avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
            avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
            const rs = avgGain / (avgLoss || 0.001);
            rsi.push(100 - (100 / (1 + rs)));
        }
        
        return rsi;
    }

    calculateADX(highs, lows, closes, period) {
        const tr = [];
        const plusDM = [];
        const minusDM = [];
        
        for (let i = 1; i < highs.length; i++) {
            tr.push(Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i-1]),
                Math.abs(lows[i] - closes[i-1])
            ));
            
            const upMove = highs[i] - highs[i-1];
            const downMove = lows[i-1] - lows[i];
            
            plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
            minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
        }
        
        const adx = [];
        let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let plusDI = plusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let minusDI = minusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < tr.length; i++) {
            atr = ((atr * (period - 1)) + tr[i]) / period;
            plusDI = ((plusDI * (period - 1)) + plusDM[i]) / period;
            minusDI = ((minusDI * (period - 1)) + minusDM[i]) / period;
            
            const plusDIval = (plusDI / atr) * 100;
            const minusDIval = (minusDI / atr) * 100;
            const dx = (Math.abs(plusDIval - minusDIval) / (plusDIval + minusDIval || 0.001)) * 100;
            adx.push(dx);
        }
        
        return adx.length > 0 ? adx : [25];
    }

    calculatePnL(entryPrice, exitPrice, isLong, size, leverage) {
        const direction = isLong ? 1 : -1;
        const percentageChange = ((exitPrice - entryPrice) / entryPrice) * direction;
        return 10000 * size * percentageChange * leverage;
    }

    calculateMetrics(trades, equityCurve, initialCapital, finalEquity, params) {
        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl <= 0);
        
        const totalPnL = trades.reduce((a, b) => a + b.pnl, 0);
        const grossProfit = winningTrades.reduce((a, b) => a + b.pnl, 0);
        const grossLoss = Math.abs(losingTrades.reduce((a, b) => a + b.pnl, 0));
        
        // Calculate max drawdown
        let peak = initialCapital;
        let maxDrawdown = 0;
        for (const point of equityCurve) {
            if (point.equity > peak) peak = point.equity;
            const dd = (peak - point.equity) / peak;
            if (dd > maxDrawdown) maxDrawdown = dd;
        }
        
        // Calculate Sharpe ratio
        const returns = [];
        for (let i = 1; i < equityCurve.length; i++) {
            returns.push((equityCurve[i].equity - equityCurve[i-1].equity) / equityCurve[i-1].equity);
        }
        const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
        const stdDev = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length || 1));
        const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
        
        // Calmar ratio (return / max drawdown)
        const calmarRatio = maxDrawdown > 0 
            ? ((finalEquity - initialCapital) / initialCapital) / maxDrawdown 
            : finalEquity > initialCapital ? Infinity : 0;
        
        return {
            initialCapital,
            finalEquity,
            totalReturn: ((finalEquity - initialCapital) / initialCapital) * 100,
            totalPnL,
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
            profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
            maxDrawdown: maxDrawdown * 100,
            sharpeRatio,
            calmarRatio: calmarRatio === Infinity ? 999 : calmarRatio,
            avgWin: winningTrades.length > 0 ? grossProfit / winningTrades.length : 0,
            avgLoss: losingTrades.length > 0 ? grossLoss / losingTrades.length : 0,
            params,
            exitReasons: trades.reduce((acc, t) => {
                acc[t.exitReason] = (acc[t.exitReason] || 0) + 1;
                return acc;
            }, {})
        };
    }

    /**
     * Step 3: Run all parameter sets
     */
    async runAllTests(candles) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`TESTING PARAMETERS: ${this.coin}`);
        console.log('='.repeat(70));
        console.log(`Configurations: ${PARAMETER_SETS.length}`);
        console.log(`Data: ${candles.length} candles\n`);
        
        const results = [];
        
        for (const params of PARAMETER_SETS) {
            process.stdout.write(`Testing ${params.name}... `);
            const startTime = Date.now();
            
            const result = await this.runBacktest(candles, params);
            result.coin = this.coin;
            result.testDuration = ((Date.now() - startTime) / 1000).toFixed(2);
            
            results.push(result);
            
            console.log(`${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn.toFixed(2)}% | ${result.totalTrades} trades | Sharpe: ${result.sharpeRatio.toFixed(2)} (${result.testDuration}s)`);
        }
        
        return results;
    }

    /**
     * Step 4: Generate and save report
     */
    generateReport(results) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`RESULTS: ${this.coin}`);
        console.log('='.repeat(70));
        
        // Sort by different metrics
        const byReturn = [...results].sort((a, b) => b.totalReturn - a.totalReturn);
        const bySharpe = [...results].sort((a, b) => b.sharpeRatio - a.sharpeRatio);
        const byCalmar = [...results].sort((a, b) => b.calmarRatio - a.calmarRatio);
        const byWinRate = [...results].sort((a, b) => b.winRate - a.winRate);
        
        // Display ranking table
        console.log(`\n${'CONFIG'.padEnd(15)} ${'RETURN'.padEnd(12)} ${'TRADES'.padEnd(8)} ${'WIN%'.padEnd(10)} ${'MAX DD'.padEnd(10)} ${'SHARPE'.padEnd(10)} ${'CALMAR'.padEnd(10)}`);
        console.log('-'.repeat(70));
        
        results.forEach(r => {
            const returnStr = `${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(2)}%`.padEnd(12);
            console.log(
                `${r.params.name.padEnd(15)} ` +
                `${returnStr} ` +
                `${r.totalTrades.toString().padEnd(8)} ` +
                `${r.winRate.toFixed(1)}%`.padEnd(10) +
                `${r.maxDrawdown.toFixed(2)}%`.padEnd(10) +
                `${r.sharpeRatio.toFixed(2)}`.padEnd(10) +
                `${r.calmarRatio.toFixed(2)}`
            );
        });
        
        // Best by category
        console.log(`\n${'='.repeat(70)}`);
        console.log('BEST BY CATEGORY:');
        console.log('='.repeat(70));
        console.log(`🏆 Best Return:    ${byReturn[0].params.name} (${byReturn[0].totalReturn.toFixed(2)}%)`);
        console.log(`⚖️  Best Sharpe:     ${bySharpe[0].params.name} (Sharpe: ${bySharpe[0].sharpeRatio.toFixed(2)})`);
        console.log(`🛡️  Best Calmar:     ${byCalmar[0].params.name} (Calmar: ${byCalmar[0].calmarRatio.toFixed(2)})`);
        console.log(`✅ Best Win Rate:   ${byWinRate[0].params.name} (${byWinRate[0].winRate.toFixed(1)}%)`);
        
        // Recommendation
        console.log(`\n${'='.repeat(70)}`);
        console.log('RECOMMENDATION:');
        console.log('='.repeat(70));
        
        // Choose best based on Sharpe (risk-adjusted) unless return is negative
        let recommended = bySharpe[0];
        if (byReturn[0].totalReturn > 0 && byReturn[0].sharpeRatio > 0.5) {
            recommended = byReturn[0];
        }
        
        console.log(`Recommended: ${recommended.params.name}`);
        console.log(`  Return: ${recommended.totalReturn.toFixed(2)}%`);
        console.log(`  Sharpe: ${recommended.sharpeRatio.toFixed(2)}`);
        console.log(`  Win Rate: ${recommended.winRate.toFixed(1)}%`);
        console.log(`  Max Drawdown: ${recommended.maxDrawdown.toFixed(2)}%`);
        console.log(`  Trades: ${recommended.totalTrades}`);
        console.log(`\nParameters:`);
        console.log(`  Leverage: ${recommended.params.leverage}x`);
        console.log(`  Position: ${(recommended.params.positionSize * 100).toFixed(0)}%`);
        console.log(`  Profit Target: ${recommended.params.profitTarget}%`);
        console.log(`  Stop Loss: ${recommended.params.stopLoss}%`);
        
        // Save results
        const timestamp = Date.now();
        const resultsFile = path.join(this.resultsDir, `${this.coin}-results-${timestamp}.json`);
        fs.writeFileSync(resultsFile, JSON.stringify({
            coin: this.coin,
            timestamp: new Date().toISOString(),
            results,
            rankings: {
                byReturn: byReturn.map(r => ({ name: r.params.name, value: r.totalReturn })),
                bySharpe: bySharpe.map(r => ({ name: r.params.name, value: r.sharpeRatio })),
                byCalmar: byCalmar.map(r => ({ name: r.params.name, value: r.calmarRatio }))
            },
            recommendation: {
                config: recommended.params.name,
                params: recommended.params,
                metrics: {
                    return: recommended.totalReturn,
                    sharpe: recommended.sharpeRatio,
                    winRate: recommended.winRate,
                    maxDrawdown: recommended.maxDrawdown,
                    totalTrades: recommended.totalTrades
                }
            }
        }, null, 2));
        
        console.log(`\n📊 Results saved: ${resultsFile}`);
        
        // Save optimal config
        const optimalFile = path.join(this.optimalDir, `${this.coin}-optimal.json`);
        fs.writeFileSync(optimalFile, JSON.stringify({
            coin: this.coin,
            updatedAt: new Date().toISOString(),
            recommended: recommended.params.name,
            params: recommended.params,
            expectedReturn: recommended.totalReturn,
            expectedSharpe: recommended.sharpeRatio
        }, null, 2));
        
        console.log(`⭐ Optimal config: ${optimalFile}`);
        
        return recommended;
    }

    /**
     * Main execution
     */
    async run() {
        console.log(`\n🚀 COIN OPTIMIZER: ${this.coin}`);
        console.log('─'.repeat(70));
        
        // Step 1: Get data
        let candles = this.loadData();
        if (!candles) {
            candles = await this.downloadData();
        }
        
        // Step 2 & 3: Run tests
        const results = await this.runAllTests(candles);
        
        // Step 4: Generate report
        const recommended = this.generateReport(results);
        
        console.log(`\n✅ Optimization complete for ${this.coin}`);
        return recommended;
    }
}

// CLI
async function main() {
    const args = process.argv.slice(2);
    let coin = 'BTC';
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--coin' || args[i] === '-c') {
            coin = args[i + 1];
        }
    }
    
    if (!coin) {
        console.log('Usage: node coin-optimizer.js --coin BTC');
        process.exit(1);
    }
    
    const optimizer = new CoinOptimizer(coin);
    await optimizer.run();
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = CoinOptimizer;