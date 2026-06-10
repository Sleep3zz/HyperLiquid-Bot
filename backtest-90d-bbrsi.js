#!/usr/bin/env node
/**
 * 90-Day BBRSI Backtest - BTC/ETH/SOL/HYPE
 * 
 * Tests the refactored BBRSIStrategy against 4 major assets
 * over a 90-day period with the latest risk management features
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TARGET_COINS = [
    'BTC-PERP',
    'ETH-PERP', 
    'SOL-PERP',
    'HYPE-PERP'
];

// Current strategy configuration
const STRATEGY_CONFIG = {
    name: 'BBRSI-v2',
    leverage: 5,
    position: 0.10,        // 10% of capital per trade
    profitTarget: 2.0,     // 2% take profit
    stopLoss: 1.5,         // 1.5% stop loss
    trailingStop: 0.8,     // 0.8% trailing stop
    dailyLossLimit: 3.0,   // 3% daily loss limit
    cooldownPeriod: 1,     // 1 minute cooldown
    riskPerTrade: 1.0,     // 1% risk per trade
    liqSafetyBuffer: 0.005 // 0.5% liquidation safety
};

// Timeframe settings
const TIMEFRAME = '15m';   // 15-minute candles
const DAYS = 90;

class BacktestRunner {
    constructor() {
        this.results = [];
        this.outputDir = path.join(__dirname, 'backtest-results');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    async runBacktest(coin) {
        console.log(`\n========================================`);
        console.log(`[${coin}] Starting 90-Day BBRSI Backtest`);
        console.log(`========================================`);
        console.log(`Config: ${STRATEGY_CONFIG.name}`);
        console.log(`Leverage: ${STRATEGY_CONFIG.leverage}x`);
        console.log(`Position: ${(STRATEGY_CONFIG.position * 100).toFixed(0)}%`);
        console.log(`Profit Target: ${STRATEGY_CONFIG.profitTarget}%`);
        console.log(`Stop Loss: ${STRATEGY_CONFIG.stopLoss}%`);
        console.log(`Trailing Stop: ${STRATEGY_CONFIG.trailingStop}%`);
        console.log(`Daily Loss Limit: ${STRATEGY_CONFIG.dailyLossLimit}%`);
        console.log(`Timeframe: ${TIMEFRAME}`);
        console.log(`Period: ${DAYS} days`);
        console.log(`========================================\n`);

        try {
            const cmd = [
                'node src/backtesting/run.js',
                '--config backtest',
                `--market ${coin}`,
                `--timeframe ${TIMEFRAME}`,
                `--leverage ${STRATEGY_CONFIG.leverage}`,
                `--position ${STRATEGY_CONFIG.position}`,
                `--profit ${STRATEGY_CONFIG.profitTarget}`,
                `--stop-loss ${STRATEGY_CONFIG.stopLoss}`,
                `--trailing-stop ${STRATEGY_CONFIG.trailingStop}`,
                `--daily-loss-limit ${STRATEGY_CONFIG.dailyLossLimit}`,
                `--cooldown ${STRATEGY_CONFIG.cooldownPeriod}`,
                `--risk-per-trade ${STRATEGY_CONFIG.riskPerTrade}`,
                `--liq-buffer ${STRATEGY_CONFIG.liqSafetyBuffer}`,
                '--capital 10000',
                '--mode reversion'  // or 'breakout' for breakout mode
            ].join(' ');

            console.log(`Running: ${cmd}\n`);
            
            const startTime = Date.now();
            const output = execSync(cmd, { 
                encoding: 'utf8',
                timeout: 300000, // 5 minute timeout
                cwd: __dirname
            });
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            
            // Parse results from output
            const result = this.parseResults(output, coin, duration);
            this.results.push(result);
            
            console.log(`\n✅ [${coin}] Completed in ${duration}s`);
            console.log(`   Total Return: ${result.totalReturn}%`);
            console.log(`   Win Rate: ${result.winRate}%`);
            console.log(`   Trades: ${result.totalTrades}`);
            console.log(`   Max Drawdown: ${result.maxDrawdown}%`);
            
            return result;
            
        } catch (error) {
            console.error(`\n❌ [${coin}] Backtest failed:`, error.message);
            return {
                coin,
                error: error.message,
                status: 'FAILED'
            };
        }
    }

    parseResults(output, coin, duration) {
        // Extract key metrics from backtest output
        const result = {
            coin,
            duration: `${duration}s`,
            timestamp: new Date().toISOString(),
            config: STRATEGY_CONFIG,
            status: 'COMPLETED'
        };

        // Try to extract metrics from output
        const totalReturnMatch = output.match(/Total Return[\s:]+([-\d.]+)%/);
        const winRateMatch = output.match(/Win Rate[\s:]+([\d.]+)%/);
        const tradesMatch = output.match(/Total Trades[\s:]+(\d+)/);
        const maxDrawdownMatch = output.match(/Max Drawdown[\s:]+([-\d.]+)%/);
        const profitFactorMatch = output.match(/Profit Factor[\s:]+([\d.]+)/);
        const sharpeMatch = output.match(/Sharpe Ratio[\s:]+([\d.]+)/);

        result.totalReturn = totalReturnMatch ? parseFloat(totalReturnMatch[1]) : 0;
        result.winRate = winRateMatch ? parseFloat(winRateMatch[1]) : 0;
        result.totalTrades = tradesMatch ? parseInt(tradesMatch[1]) : 0;
        result.maxDrawdown = maxDrawdownMatch ? parseFloat(maxDrawdownMatch[1]) : 0;
        result.profitFactor = profitFactorMatch ? parseFloat(profitFactorMatch[1]) : 0;
        result.sharpeRatio = sharpeMatch ? parseFloat(sharpeMatch[1]) : 0;

        return result;
    }

    async runAll() {
        console.log(`\n🚀 Starting 90-Day BBRSI Backtest Suite`);
        console.log(`Assets: ${TARGET_COINS.join(', ')}`);
        console.log(`Strategy: ${STRATEGY_CONFIG.name}`);
        console.log(`Estimated time: ~${TARGET_COINS.length * 2} minutes\n`);

        const startTime = Date.now();

        for (const coin of TARGET_COINS) {
            await this.runBacktest(coin);
        }

        const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        // Save results
        const resultsFile = path.join(this.outputDir, `backtest-90d-${Date.now()}.json`);
        fs.writeFileSync(resultsFile, JSON.stringify({
            timestamp: new Date().toISOString(),
            config: STRATEGY_CONFIG,
            timeframe: TIMEFRAME,
            days: DAYS,
            duration: `${totalDuration}s`,
            results: this.results
        }, null, 2));

        // Print summary
        this.printSummary(totalDuration);
        
        console.log(`\n📊 Results saved to: ${resultsFile}`);
    }

    printSummary(totalDuration) {
        console.log(`\n========================================`);
        console.log(`📊 90-DAY BACKTEST SUMMARY`);
        console.log(`========================================`);
        console.log(`Duration: ${totalDuration}s`);
        console.log(`Assets Tested: ${TARGET_COINS.length}`);
        console.log(`========================================\n`);

        // Sort by total return
        const sorted = [...this.results]
            .filter(r => r.status === 'COMPLETED')
            .sort((a, b) => b.totalReturn - a.totalReturn);

        console.log('RANKING BY TOTAL RETURN:');
        console.log('-'.repeat(80));
        console.log(`${'Rank'.padEnd(6)} ${'Asset'.padEnd(12)} ${'Return'.padEnd(12)} ${'Win Rate'.padEnd(12)} ${'Trades'.padEnd(10)} ${'Max DD'.padEnd(12)} ${'Status'.padEnd(10)}`);
        console.log('-'.repeat(80));

        sorted.forEach((result, i) => {
            const rank = (i + 1).toString().padEnd(6);
            const asset = result.coin.padEnd(12);
            const ret = `${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn.toFixed(2)}%`.padEnd(12);
            const win = `${result.winRate.toFixed(1)}%`.padEnd(12);
            const trades = result.totalTrades.toString().padEnd(10);
            const dd = `${result.maxDrawdown.toFixed(2)}%`.padEnd(12);
            const status = result.status.padEnd(10);
            console.log(`${rank}${asset}${ret}${win}${trades}${dd}${status}`);
        });

        // Calculate averages
        const avgReturn = sorted.reduce((a, b) => a + b.totalReturn, 0) / sorted.length;
        const avgWinRate = sorted.reduce((a, b) => a + b.winRate, 0) / sorted.length;
        const avgTrades = sorted.reduce((a, b) => a + b.totalTrades, 0) / sorted.length;
        const worstDD = Math.min(...sorted.map(r => r.maxDrawdown));

        console.log('-'.repeat(80));
        console.log(`\nAVERAGES:`);
        console.log(`  Average Return: ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%`);
        console.log(`  Average Win Rate: ${avgWinRate.toFixed(1)}%`);
        console.log(`  Average Trades: ${avgTrades.toFixed(0)}`);
        console.log(`  Worst Drawdown: ${worstDD.toFixed(2)}%`);
        console.log(`========================================\n`);
    }
}

// Run if called directly
if (require.main === module) {
    const runner = new BacktestRunner();
    runner.runAll().catch(err => {
        console.error('Backtest suite failed:', err);
        process.exit(1);
    });
}

module.exports = { BacktestRunner, TARGET_COINS, STRATEGY_CONFIG };