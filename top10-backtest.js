#!/usr/bin/env node
/**
 * Top 10 Coins Backtest - Using Claude for Analysis
 * 
 * Backtests the BBRSI strategy on top volume coins with ML optimization
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

// Setup logging
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'top10-backtest.log' })
    ]
});

// Top 10 coins by volume on Hyperliquid (typical)
const TOP_10_COINS = [
    'BTC-PERP',
    'ETH-PERP', 
    'SOL-PERP',
    'HYPE-PERP',
    'ARB-PERP',
    'OP-PERP',
    'LINK-PERP',
    'AVAX-PERP',
    'NEAR-PERP',
    'UNI-PERP'
];

class Top10Backtester {
    constructor(options = {}) {
        this.coins = options.coins || TOP_10_COINS;
        this.timeframe = options.timeframe || '15m';
        this.leverage = options.leverage || 3;
        this.initialCapital = options.initialCapital || 10000;
        this.useML = options.useML !== false;
        this.results = [];
    }

    /**
     * Fetch latest market data for a coin
     */
    async fetchMarketData(coin) {
        try {
            // Use wayfinder to get current market info
            const cmd = `wayfinder resource wayfinder://hyperliquid/prices/${coin.replace('-PERP', '')}`;
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: process.env.WAYFINDER_SDK_PATH || '/home/clawdbot/wayfinder-paths-sdk',
                timeout: 10000 
            });
            return JSON.parse(result);
        } catch (error) {
            logger.warn(`Failed to fetch market data for ${coin}: ${error.message}`);
            return null;
        }
    }

    /**
     * Check if historical data exists
     */
    hasHistoricalData(coin) {
        const dataPath = path.join(__dirname, 'src/backtesting/data', coin, `${coin}-${this.timeframe}.json`);
        return fs.existsSync(dataPath);
    }

    /**
     * Run backtest for a single coin
     */
    async backtestCoin(coin) {
        logger.info(`[CLAUDE] Analyzing ${coin}...`);
        
        try {
            // Check if we have data
            if (!this.hasHistoricalData(coin)) {
                logger.warn(`No historical data for ${coin}, skipping...`);
                return null;
            }

            // Run backtest
            const cmd = [
                'node src/backtesting/run.js',
                '--config backtest',
                `--market ${coin}`,
                `--timeframe ${this.timeframe}`,
                `--leverage ${this.leverage}`,
                `--capital ${this.initialCapital}`,
                this.useML ? '--use-ml' : ''
            ].join(' ');

            logger.info(`[CLAUDE] Running backtest: ${cmd}`);
            
            const result = execSync(cmd, {
                encoding: 'utf8',
                cwd: __dirname,
                timeout: 120000
            });

            // Parse results from log file
            const logFile = path.join(__dirname, 'backtest_results.log');
            let metrics = {};
            
            if (fs.existsSync(logFile)) {
                const logContent = fs.readFileSync(logFile, 'utf8');
                metrics = this.parseBacktestResults(logContent);
            }

            const coinResult = {
                coin,
                timeframe: this.timeframe,
                leverage: this.leverage,
                ...metrics,
                timestamp: Date.now()
            };

            this.results.push(coinResult);
            return coinResult;

        } catch (error) {
            logger.error(`[CLAUDE] Backtest failed for ${coin}: ${error.message}`);
            return null;
        }
    }

    /**
     * Parse backtest results from log
     */
    parseBacktestResults(logContent) {
        const metrics = {};
        
        // Extract key metrics using regex
        const totalTradesMatch = logContent.match(/Total Trades:\s*(\d+)/);
        const winRateMatch = logContent.match(/Win Rate:\s*([\d.]+)%/);
        const totalPnLMatch = logContent.match(/Total P&L:\s*\$?([\d.-]+)/);
        const maxDrawdownMatch = logContent.match(/Max Drawdown:\s*([\d.]+)%/);
        const sharpeMatch = logContent.match(/Sharpe Ratio:\s*([\d.]+)/);
        const finalEquityMatch = logContent.match(/Final Equity:\s*\$?([\d.]+)/);

        if (totalTradesMatch) metrics.totalTrades = parseInt(totalTradesMatch[1]);
        if (winRateMatch) metrics.winRate = parseFloat(winRateMatch[1]);
        if (totalPnLMatch) metrics.totalPnL = parseFloat(totalPnLMatch[1]);
        if (maxDrawdownMatch) metrics.maxDrawdown = parseFloat(maxDrawdownMatch[1]);
        if (sharpeMatch) metrics.sharpeRatio = parseFloat(sharpeMatch[1]);
        if (finalEquityMatch) metrics.finalEquity = parseFloat(finalEquityMatch[1]);

        return metrics;
    }

    /**
     * Run backtests on all top 10 coins
     */
    async runAllBacktests() {
        logger.info('[CLAUDE] Starting Top 10 Coins Backtest Analysis');
        logger.info(`[CLAUDE] Coins: ${this.coins.join(', ')}`);
        logger.info(`[CLAUDE] Timeframe: ${this.timeframe}`);
        logger.info(`[CLAUDE] Leverage: ${this.leverage}x`);
        logger.info(`[CLAUDE] Initial Capital per coin: $${this.initialCapital}`);
        logger.info(`[CLAUDE] Using ML: ${this.useML}`);

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║     TOP 10 COINS BACKTEST - CLAUDE ANALYSIS                ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        for (const coin of this.coins) {
            await this.backtestCoin(coin);
            
            // Small delay between backtests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.generateReport();
    }

    /**
     * Generate comprehensive analysis report
     */
    generateReport() {
        const validResults = this.results.filter(r => r !== null);
        
        if (validResults.length === 0) {
            console.log('\n❌ No valid backtest results');
            return;
        }

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║           TOP 10 BACKTEST RESULTS - CLAUDE                 ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        // Sort by total PnL
        const sortedByPnL = [...validResults].sort((a, b) => (b.totalPnL || 0) - (a.totalPnL || 0));
        
        // Sort by Sharpe ratio
        const sortedBySharpe = [...validResults].sort((a, b) => (b.sharpeRatio || 0) - (a.sharpeRatio || 0));

        // Display individual results
        console.log('Individual Coin Performance:');
        console.log('─'.repeat(80));
        console.log('Coin      | Trades | Win Rate | P&L        | Max DD  | Sharpe | Final Equity');
        console.log('─'.repeat(80));

        validResults.forEach(r => {
            const coin = r.coin.padEnd(9);
            const trades = (r.totalTrades || 0).toString().padStart(6);
            const winRate = `${(r.winRate || 0).toFixed(1)}%`.padStart(8);
            const pnl = `$${(r.totalPnL || 0).toFixed(2)}`.padStart(10);
            const drawdown = `${(r.maxDrawdown || 0).toFixed(1)}%`.padStart(7);
            const sharpe = (r.sharpeRatio || 0).toFixed(2).padStart(6);
            const equity = `$${(r.finalEquity || 0).toFixed(2)}`.padStart(12);
            
            console.log(`${coin} | ${trades} | ${winRate} | ${pnl} | ${drawdown} | ${sharpe} | ${equity}`);
        });

        // Aggregate statistics
        const totalTrades = validResults.reduce((sum, r) => sum + (r.totalTrades || 0), 0);
        const avgWinRate = validResults.reduce((sum, r) => sum + (r.winRate || 0), 0) / validResults.length;
        const totalPnL = validResults.reduce((sum, r) => sum + (r.totalPnL || 0), 0);
        const avgDrawdown = validResults.reduce((sum, r) => sum + (r.maxDrawdown || 0), 0) / validResults.length;
        const avgSharpe = validResults.reduce((sum, r) => sum + (r.sharpeRatio || 0), 0) / validResults.length;
        const totalEquity = validResults.reduce((sum, r) => sum + (r.finalEquity || 0), 0);
        const initialTotal = this.initialCapital * validResults.length;

        console.log('\n' + '─'.repeat(80));
        console.log('Aggregate Performance:');
        console.log(`  Total Trades:        ${totalTrades}`);
        console.log(`  Average Win Rate:    ${avgWinRate.toFixed(2)}%`);
        console.log(`  Total P&L:           $${totalPnL.toFixed(2)}`);
        console.log(`  Average Max DD:      ${avgDrawdown.toFixed(2)}%`);
        console.log(`  Average Sharpe:      ${avgSharpe.toFixed(2)}`);
        console.log(`  Total Final Equity:  $${totalEquity.toFixed(2)}`);
        console.log(`  Total Return:        ${((totalPnL / initialTotal) * 100).toFixed(2)}%`);

        // Top performers
        console.log('\n🏆 TOP PERFORMERS:');
        console.log(`  Best P&L:     ${sortedByPnL[0].coin} ($${sortedByPnL[0].totalPnL?.toFixed(2) || 0})`);
        console.log(`  Best Sharpe:  ${sortedBySharpe[0].coin} (${sortedBySharpe[0].sharpeRatio?.toFixed(2) || 0})`);
        console.log(`  Most Trades:  ${validResults.sort((a, b) => (b.totalTrades || 0) - (a.totalTrades || 0))[0].coin}`);

        // Claude's Analysis
        console.log('\n📊 CLAUDE ANALYSIS:');
        
        if (totalPnL > 0) {
            console.log('  ✅ Strategy shows positive returns across top 10 coins');
        } else {
            console.log('  ⚠️ Strategy needs optimization - negative aggregate returns');
        }

        if (avgSharpe > 1) {
            console.log('  ✅ Good risk-adjusted returns (Sharpe > 1)');
        } else if (avgSharpe > 0.5) {
            console.log('  ⚠️ Moderate risk-adjusted returns (Sharpe 0.5-1)');
        } else {
            console.log('  ❌ Poor risk-adjusted returns (Sharpe < 0.5)');
        }

        if (avgWinRate > 50) {
            console.log('  ✅ Win rate above 50% - favorable probability');
        } else {
            console.log('  ⚠️ Win rate below 50% - relies on risk/reward ratio');
        }

        if (avgDrawdown < 10) {
            console.log('  ✅ Low drawdown - good risk management');
        } else if (avgDrawdown < 20) {
            console.log('  ⚠️ Moderate drawdown - acceptable risk');
        } else {
            console.log('  ❌ High drawdown - consider reducing leverage');
        }

        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        
        const bestCoin = sortedByPnL[0];
        console.log(`  1. Focus on ${bestCoin.coin} - best performing coin`);
        
        if (this.useML) {
            console.log('  2. ML optimization is enabled - results use ML-tuned parameters');
        } else {
            console.log('  2. Consider running with --use-ml for optimized parameters');
        }

        if (avgDrawdown > 15) {
            console.log('  3. Reduce leverage or position size to lower drawdown');
        }

        if (avgWinRate < 45) {
            console.log('  4. Review entry criteria - win rate below optimal');
        }

        console.log(`\n  5. Run: node src/backtesting/ml_optimize.js --market ${bestCoin.coin} --model xgboost`);
        console.log('     to generate optimized parameters for best performer');

        console.log('\n' + '═'.repeat(80));

        // Save report
        const reportPath = path.join(__dirname, `top10-backtest-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            config: {
                coins: this.coins,
                timeframe: this.timeframe,
                leverage: this.leverage,
                initialCapital: this.initialCapital,
                useML: this.useML
            },
            results: validResults,
            aggregate: {
                totalTrades,
                avgWinRate,
                totalPnL,
                avgDrawdown,
                avgSharpe,
                totalEquity,
                totalReturn: (totalPnL / initialTotal) * 100
            },
            topPerformers: {
                bestPnL: sortedByPnL[0],
                bestSharpe: sortedBySharpe[0]
            }
        }, null, 2));

        console.log(`\n📄 Full report saved to: ${reportPath}`);
    }
}

// Main
async function main() {
    const backtester = new Top10Backtester({
        timeframe: '15m',
        leverage: 3,
        initialCapital: 10000,
        useML: true
    });

    await backtester.runAllBacktests();
}

if (require.main === module) {
    main().catch(error => {
        logger.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = Top10Backtester;
