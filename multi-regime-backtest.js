#!/usr/bin/env node
/**
 * 90-Day Multi-Regime Backtest with Improved WayfinderAgent Data Fetching
 * 
 * Features:
 * - Fetches live historical data via WayfinderAgent.getHistoricalCandles()
 * - Detects market regimes (trending, ranging, volatile) per coin
 * - Applies regime-optimized parameters for each coin
 * - 90-day backtest period
 */

const WayfinderAgent = require('../model-router/src/agents/wayfinder-agent');
const BBRSIStrategy = require('./src/strategy/BBRSIStrategy');
const fs = require('fs');
const path = require('path');

const TOP_COINS = [
    'BTC', 'ETH', 'SOL', 'HYPE', 'ARB',
    'OP', 'LINK', 'AVAX', 'NEAR', 'UNI'
];

// Regime-specific parameter sets optimized per market condition
const REGIME_PARAMS = {
    // Low volatility, mean-reverting markets
    ranging: {
        name: 'Ranging',
        leverage: 3,
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
    // Strong directional markets
    trending: {
        name: 'Trending',
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
    // High volatility markets
    volatile: {
        name: 'Volatile',
        leverage: 2,
        positionSize: 0.08,
        profitTarget: 3.0,
        stopLoss: 2.0,
        bbPeriod: 20,
        bbStdDev: 3.0,
        rsiPeriod: 10,
        rsiOverbought: 70,
        rsiOversold: 30,
        adxPeriod: 14,
        adxTrendThreshold: 35
    },
    // Default balanced settings
    balanced: {
        name: 'Balanced',
        leverage: 4,
        positionSize: 0.10,
        profitTarget: 1.8,
        stopLoss: 1.2,
        bbPeriod: 20,
        bbStdDev: 2.0,
        rsiPeriod: 14,
        rsiOverbought: 70,
        rsiOversold: 30,
        adxPeriod: 14,
        adxTrendThreshold: 25
    }
};

class MultiRegimeBacktester {
    constructor() {
        // Create agent with no-auto-connect option
        this.agent = new WayfinderAgent({ autoConnect: false });
        this.results = [];
        this.outputDir = path.join(__dirname, 'backtest-results');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
        
        // Don't wait for WS - use REST API directly
        this.wsReady = false;
    }

    async waitForConnection(timeout = 5000) {
        // Skip WS connection for backtesting - use REST only
        console.log('[INFO] Using REST API for historical data (no WebSocket needed)');
        return true;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Detect market regime from recent price action
     */
    detectRegime(candles) {
        if (candles.length < 50) return 'balanced';

        const closes = candles.map(c => c.c);
        const returns = [];
        for (let i = 1; i < closes.length; i++) {
            returns.push((closes[i] - closes[i-1]) / closes[i-1]);
        }

        // Calculate volatility (standard deviation of returns)
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
        const volatility = Math.sqrt(variance) * Math.sqrt(96); // Annualized (96 15m periods per day)

        // Calculate trend strength (linear regression slope)
        const n = Math.min(50, closes.length);
        const recentCloses = closes.slice(-n);
        const xMean = (n - 1) / 2;
        const yMean = recentCloses.reduce((a, b) => a + b, 0) / n;
        
        let numerator = 0;
        let denominator = 0;
        for (let i = 0; i < n; i++) {
            numerator += (i - xMean) * (recentCloses[i] - yMean);
            denominator += Math.pow(i - xMean, 2);
        }
        const slope = denominator > 0 ? numerator / denominator : 0;
        const trendStrength = Math.abs(slope) / yMean * 100;

        // ADX-like calculation for trend strength
        const atr = this.calculateATR(candles.slice(-20));
        const normalizedTrend = trendStrength / (atr / yMean * 100 + 0.001);

        // Classify regime
        if (volatility > 0.8) {
            return 'volatile';
        } else if (normalizedTrend > 1.5 && volatility < 0.5) {
            return 'trending';
        } else if (volatility < 0.4 && normalizedTrend < 0.8) {
            return 'ranging';
        }
        return 'balanced';
    }

    calculateATR(candles, period = 14) {
        if (candles.length < 2) return 0;
        
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].h;
            const low = candles[i].l;
            const prevClose = candles[i-1].c;
            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );
            trs.push(tr);
        }
        
        return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
    }

    /**
     * Fetch 90 days of historical data using improved WayfinderAgent method
     */
    async fetch90DayData(coin, interval = '15m') {
        console.log(`\n[${coin}] Fetching 90 days of ${interval} data...`);
        
        // Use the new get90DayCandles method
        const candles = await this.agent.get90DayCandles(coin, interval);
        
        if (!candles || candles.length === 0) {
            console.warn(`[${coin}] No data retrieved`);
            return [];
        }
        
        console.log(`[${coin}] Ready: ${candles.length} candles (${(candles.length / 96).toFixed(1)} days)`);
        return candles;
    }

    /**
     * Run backtest for a single coin with regime detection
     */
    async runCoinBacktest(coin) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`BACKTEST: ${coin} | 90 Days | Regime-Optimized`);
        console.log('='.repeat(60));

        // Fetch data using improved methods
        const candles = await this.fetch90DayData(coin, '15m');
        
        if (candles.length < 100) {
            console.error(`[${coin}] Insufficient data for backtest`);
            return null;
        }

        // Detect regime from first 30 days (in-sample)
        const regimeDetectionPeriod = Math.min(30 * 96, Math.floor(candles.length * 0.3));
        const regimeCandles = candles.slice(0, regimeDetectionPeriod);
        const regime = this.detectRegime(regimeCandles);
        const params = REGIME_PARAMS[regime];
        
        console.log(`[${coin}] Detected regime: ${regime.toUpperCase()}`);
        console.log(`[${coin}] Parameters: ${JSON.stringify(params, null, 2)}`);

        // Run backtest on remaining data (out-of-sample)
        const backtestCandles = candles.slice(regimeDetectionPeriod);
        const result = await this.simulateBacktest(coin, backtestCandles, params);
        
        result.regime = regime;
        result.coin = coin;
        result.totalCandles = candles.length;
        result.backtestCandles = backtestCandles.length;
        
        return result;
    }

    /**
     * Simulate backtest with given parameters
     */
    async simulateBacktest(coin, candles, params) {
        const initialCapital = 10000;
        let equity = initialCapital;
        let position = null;
        const trades = [];
        const equityCurve = [];
        
        // Initialize BBRSI strategy with regime parameters
        const strategyConfig = {
            bbPeriod: params.bbPeriod,
            bbStdDev: params.bbStdDev,
            rsiPeriod: params.rsiPeriod,
            rsiOverbought: params.rsiOverbought,
            rsiOversold: params.rsiOversold,
            adxPeriod: params.adxPeriod,
            adxTrendThreshold: params.adxTrendThreshold
        };

        // Create custom strategy instance
        const strategy = {
            evaluatePosition: (data) => this.evaluateBBRSI(data, strategyConfig)
        };

        const lookback = Math.max(50, params.bbPeriod + 10);
        const tradingFee = 0.001; // 0.1%

        for (let i = lookback; i < candles.length; i++) {
            const currentCandle = candles[i];
            const currentPrice = currentCandle.c;
            
            // Get signal
            const lookbackData = candles.slice(i - lookback, i + 1);
            const signal = strategy.evaluatePosition(lookbackData);
            
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
                    const grossPnL = this.calculatePnL(
                        position.entryPrice,
                        currentPrice,
                        position.type === 'LONG',
                        position.size,
                        params.leverage
                    );
                    const fees = initialCapital * position.size * tradingFee * 2;
                    const netPnL = grossPnL - fees;
                    
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
                    const grossPnL = this.calculatePnL(
                        position.entryPrice,
                        currentPrice,
                        position.type === 'LONG',
                        position.size,
                        params.leverage
                    );
                    const fees = initialCapital * position.size * tradingFee * 2;
                    const netPnL = grossPnL - fees;
                    
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
                const grossPnL = this.calculatePnL(
                    position.entryPrice,
                    currentPrice,
                    position.type === 'LONG',
                    position.size,
                    params.leverage
                );
                const fees = initialCapital * position.size * tradingFee * 2;
                const netPnL = grossPnL - fees;
                
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
            const grossPnL = this.calculatePnL(
                position.entryPrice,
                finalPrice,
                position.type === 'LONG',
                position.size,
                params.leverage
            );
            const fees = initialCapital * position.size * tradingFee * 2;
            const netPnL = grossPnL - fees;
            
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
    evaluateBBRSI(candles, config) {
        const closes = candles.map(c => c.c);
        const highs = candles.map(c => c.h);
        const lows = candles.map(c => c.l);
        
        // Calculate indicators
        const bb = this.calculateBollinger(closes, config.bbPeriod, config.bbStdDev);
        const rsi = this.calculateRSI(closes, config.rsiPeriod);
        const adx = this.calculateADX(highs, lows, closes, config.adxPeriod);
        
        const currentPrice = closes[closes.length - 1];
        const currentRSI = rsi[rsi.length - 1];
        const currentADX = adx[adx.length - 1];
        
        // Long signal: Price below lower band + RSI oversold + not strong trend
        if (currentPrice < bb.lower && 
            currentRSI < config.rsiOversold && 
            currentADX < config.adxTrendThreshold) {
            return 'LONG';
        }
        
        // Short signal: Price above upper band + RSI overbought + not strong trend
        if (currentPrice > bb.upper && 
            currentRSI > config.rsiOverbought && 
            currentADX < config.adxTrendThreshold) {
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
        // Simplified ADX calculation
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
        
        return adx.length > 0 ? adx : [25]; // Default neutral
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
            avgWin: winningTrades.length > 0 ? grossProfit / winningTrades.length : 0,
            avgLoss: losingTrades.length > 0 ? grossLoss / losingTrades.length : 0,
            params,
            trades: trades.slice(0, 20), // Store first 20 for analysis
            exitReasons: trades.reduce((acc, t) => {
                acc[t.exitReason] = (acc[t.exitReason] || 0) + 1;
                return acc;
            }, {})
        };
    }

    /**
     * Run full backtest suite
     */
    async runAll() {
        console.log('\n' + '='.repeat(80));
        console.log('90-DAY MULTI-REGIME BACKTEST SUITE');
        console.log('Using Improved WayfinderAgent Data Fetching');
        console.log('='.repeat(80));
        console.log(`Coins: ${TOP_COINS.join(', ')}`);
        console.log(`Regimes: ${Object.keys(REGIME_PARAMS).join(', ')}`);
        console.log(`Initial Capital: $10,000 per coin`);
        console.log('='.repeat(80) + '\n');

        // Wait for WebSocket
        await this.waitForConnection();

        const startTime = Date.now();

        for (const coin of TOP_COINS) {
            try {
                const result = await this.runCoinBacktest(coin);
                if (result) {
                    this.results.push(result);
                }
                
                // Rate limiting between coins
                await this.sleep(2000);
            } catch (err) {
                console.error(`[${coin}] Fatal error: ${err.message}`);
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        this.generateReport(duration);
    }

    generateReport(duration) {
        console.log('\n\n' + '='.repeat(80));
        console.log('COMPREHENSIVE BACKTEST REPORT');
        console.log('='.repeat(80));
        console.log(`Duration: ${duration}s`);
        console.log(`Coins Tested: ${this.results.length}/${TOP_COINS.length}`);
        console.log('='.repeat(80) + '\n');

        // Sort by total return
        const sorted = [...this.results].sort((a, b) => b.totalReturn - a.totalReturn);

        console.log('RANKING BY TOTAL RETURN:');
        console.log('-'.repeat(100));
        console.log(`${'Rank'.padEnd(6)} ${'Coin'.padEnd(10)} ${'Regime'.padEnd(12)} ${'Return'.padEnd(12)} ${'Win Rate'.padEnd(12)} ${'Trades'.padEnd(10)} ${'Max DD'.padEnd(12)} ${'Sharpe'.padEnd(10)}`);
        console.log('-'.repeat(100));

        sorted.forEach((r, i) => {
            console.log(
                `${(i + 1).toString().padEnd(6)} ` +
                `${r.coin.padEnd(10)} ` +
                `${r.regime.toUpperCase().padEnd(12)} ` +
                `${(r.totalReturn >= 0 ? '+' : '').padEnd(1)}${r.totalReturn.toFixed(2)}%`.padEnd(12) +
                `${r.winRate.toFixed(1)}%`.padEnd(12) +
                `${r.totalTrades.toString().padEnd(10)} ` +
                `${r.maxDrawdown.toFixed(2)}%`.padEnd(12) +
                `${r.sharpeRatio.toFixed(2)}`
            );
        });

        // Aggregate by regime
        const regimeStats = {};
        for (const r of this.results) {
            if (!regimeStats[r.regime]) {
                regimeStats[r.regime] = { 
                    count: 0, 
                    totalReturn: 0, 
                    avgWinRate: 0,
                    avgDrawdown: 0,
                    avgSharpe: 0
                };
            }
            regimeStats[r.regime].count++;
            regimeStats[r.regime].totalReturn += r.totalReturn;
            regimeStats[r.regime].avgWinRate += r.winRate;
            regimeStats[r.regime].avgDrawdown += r.maxDrawdown;
            regimeStats[r.regime].avgSharpe += r.sharpeRatio;
        }

        console.log('\n\nREGIME PERFORMANCE SUMMARY:');
        console.log('-'.repeat(80));
        console.log(`${'Regime'.padEnd(12)} ${'Coins'.padEnd(8)} ${'Avg Return'.padEnd(12)} ${'Avg Win%'.padEnd(12)} ${'Avg DD'.padEnd(12)} ${'Avg Sharpe'.padEnd(12)}`);
        console.log('-'.repeat(80));

        for (const [regime, stats] of Object.entries(regimeStats)) {
            const count = stats.count;
            console.log(
                `${regime.toUpperCase().padEnd(12)} ` +
                `${count.toString().padEnd(8)} ` +
                `${(stats.totalReturn / count).toFixed(2)}%`.padEnd(12) +
                `${(stats.avgWinRate / count).toFixed(1)}%`.padEnd(12) +
                `${(stats.avgDrawdown / count).toFixed(2)}%`.padEnd(12) +
                `${(stats.avgSharpe / count).toFixed(2)}`
            );
        }

        // Portfolio simulation
        const portfolioReturn = this.results.reduce((a, b) => a + b.totalReturn, 0) / this.results.length;
        console.log('\n\nPORTFOLIO SIMULATION (Equal Weight):');
        console.log(`  Average Return Across All Coins: ${portfolioReturn.toFixed(2)}%`);
        console.log(`  $10,000 per coin → $${(10000 * (1 + portfolioReturn/100) * this.results.length).toFixed(2)} total`);

        // Save results
        const resultsPath = path.join(this.outputDir, `multi-regime-backtest-${Date.now()}.json`);
        fs.writeFileSync(resultsPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            duration: `${duration}s`,
            coins: TOP_COINS,
            regimeParams: REGIME_PARAMS,
            results: this.results,
            summary: {
                regimeStats,
                portfolioReturn,
                bestCoin: sorted[0]?.coin,
                bestReturn: sorted[0]?.totalReturn
            }
        }, null, 2));

        console.log(`\n📊 Full results saved: ${resultsPath}`);
        console.log('='.repeat(80) + '\n');

        // Recommendations
        console.log('💡 KEY INSIGHTS:');
        console.log(`  • Best performing regime: ${Object.entries(regimeStats).sort((a,b) => (b[1].totalReturn/b[1].count) - (a[1].totalReturn/a[1].count))[0][0].toUpperCase()}`);
        console.log(`  • Best performing coin: ${sorted[0]?.coin} (${sorted[0]?.totalReturn.toFixed(2)}%)`);
        console.log(`  • Most trades: ${this.results.sort((a,b) => b.totalTrades - a.totalTrades)[0]?.coin} (${this.results.sort((a,b) => b.totalTrades - a.totalTrades)[0]?.totalTrades} trades)`);
        console.log(`  • Best risk-adjusted: ${this.results.sort((a,b) => b.sharpeRatio - a.sharpeRatio)[0]?.coin} (Sharpe: ${this.results.sort((a,b) => b.sharpeRatio - a.sharpeRatio)[0]?.sharpeRatio.toFixed(2)})`);
    }
}

// Run if called directly
if (require.main === module) {
    const backtester = new MultiRegimeBacktester();
    backtester.runAll().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = MultiRegimeBacktester;