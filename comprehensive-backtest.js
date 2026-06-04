#!/usr/bin/env node
/**
 * Comprehensive 90-Day Backtest Analysis
 * 
 * Tests multiple parameter configurations on top 10 coins
 * to find optimal performance settings
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [new winston.transports.Console()]
});

const TOP_COINS = [
    'BTC-PERP', 'ETH-PERP', 'SOL-PERP', 'HYPE-PERP', 'ARB-PERP',
    'OP-PERP', 'LINK-PERP', 'AVAX-PERP', 'NEAR-PERP', 'UNI-PERP'
];

// Parameter configurations to test
const PARAMETER_SETS = [
    { name: 'Conservative', leverage: 2, positionSize: 0.05, profitTarget: 1.2 },
    { name: 'Moderate', leverage: 3, positionSize: 0.08, profitTarget: 1.5 },
    { name: 'Aggressive', leverage: 5, positionSize: 0.12, profitTarget: 2.0 },
    { name: 'High-Risk', leverage: 10, positionSize: 0.2, profitTarget: 3.0 },
];

class ComprehensiveBacktester {
    constructor() {
        this.results = [];
        this.allResults = [];
    }

    /**
     * Run backtest for single coin with specific parameters
     */
    async runBacktest(coin, params) {
        try {
            const cmd = [
                'node src/backtesting/run.js',
                '--config backtest',
                `--market ${coin}`,
                '--timeframe 15m',
                `--leverage ${params.leverage}`,
                `--position ${params.positionSize}`,
                `--profit ${params.profitTarget}`,
                '--capital 10000'
            ].join(' ');

            logger.info(`[TEST] ${coin} | ${params.name} | Lev:${params.leverage}x | Pos:${(params.positionSize*100).toFixed(0)}% | TP:${params.profitTarget}x`);

            // Run backtest and capture output
            const output = execSync(cmd, {
                encoding: 'utf8',
                cwd: __dirname,
                timeout: 120000
            });

            // Parse metrics from log file
            const metrics = this.parseMetrics();
            
            return {
                success: true,
                coin,
                params: params.name,
                ...metrics
            };

        } catch (error) {
            logger.error(`[ERROR] ${coin} ${params.name}: ${error.message}`);
            return {
                success: false,
                coin,
                params: params.name,
                error: error.message
            };
        }
    }

    /**
     * Parse metrics from log file
     */
    parseMetrics() {
        const logFile = path.join(__dirname, 'backtest_results.log');
        if (!fs.existsSync(logFile)) {
            return {};
        }

        const logContent = fs.readFileSync(logFile, 'utf8');
        const lines = logContent.split('\n');
        const lastLines = lines.slice(-50); // Get last 50 lines

        const metrics = {};

        // Extract metrics from log
        for (const line of lastLines) {
            if (line.includes('Total Trades:')) {
                const match = line.match(/(\d+)/);
                if (match) metrics.totalTrades = parseInt(match[1]);
            }
            if (line.includes('Win Rate:')) {
                const match = line.match(/([\d.]+)%/);
                if (match) metrics.winRate = parseFloat(match[1]);
            }
            if (line.includes('Total Profit/Loss:') || line.includes('Total P&L:')) {
                const match = line.match(/-?\$?([\d,.]+)/);
                if (match) metrics.totalPnL = parseFloat(match[1].replace(',', ''));
            }
            if (line.includes('Max Drawdown:')) {
                const match = line.match(/([\d.]+)%/);
                if (match) metrics.maxDrawdown = parseFloat(match[1]);
            }
            if (line.includes('Sharpe Ratio:')) {
                const match = line.match(/([\d.]+)/);
                if (match) metrics.sharpeRatio = parseFloat(match[1]);
            }
            if (line.includes('Final Equity:')) {
                const match = line.match(/\$?([\d,.]+)/);
                if (match) metrics.finalEquity = parseFloat(match[1].replace(',', ''));
            }
            if (line.includes('Return:')) {
                const match = line.match(/([\d.]+)%/);
                if (match) metrics.totalReturn = parseFloat(match[1]);
            }
        }

        return metrics;
    }

    /**
     * Run comprehensive backtests
     */
    async runComprehensiveTests() {
        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║     COMPREHENSIVE 90-DAY BACKTEST - CLAUDE                     ║');
        console.log('║     Testing Multiple Parameter Configurations                  ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        console.log('Parameter Sets:');
        PARAMETER_SETS.forEach(p => {
            console.log(`  ${p.name.padEnd(12)} | Lev: ${p.leverage.toString().padStart(2)}x | Pos: ${(p.positionSize*100).toString().padStart(2)}% | TP: ${p.profitTarget}x`);
        });
        console.log('');
        console.log(`Coins: ${TOP_COINS.join(', ')}`);
        console.log(`Period: 90 days`);
        console.log(`Timeframe: 15m`);
        console.log('');

        // Run tests for all combinations
        for (const coin of TOP_COINS) {
            console.log(`\n📊 Testing ${coin}...`);
            console.log('─'.repeat(80));

            for (const params of PARAMETER_SETS) {
                const result = await this.runBacktest(coin, params);
                this.allResults.push(result);
                
                if (result.success) {
                    const pnlStr = result.totalPnL ? `$${result.totalPnL.toFixed(2)}` : 'N/A';
                    const sharpeStr = result.sharpeRatio ? result.sharpeRatio.toFixed(2) : 'N/A';
                    const winRateStr = result.winRate ? `${result.winRate.toFixed(1)}%` : 'N/A';
                    console.log(`  ✓ ${params.name.padEnd(12)} | PnL: ${pnlStr.padStart(10)} | Sharpe: ${sharpeStr.padStart(5)} | Win: ${winRateStr.padStart(6)}`);
                } else {
                    console.log(`  ✗ ${params.name.padEnd(12)} | ERROR`);
                }

                // Small delay
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        this.generateComprehensiveReport();
    }

    /**
     * Generate comprehensive analysis report
     */
    generateComprehensiveReport() {
        const validResults = this.allResults.filter(r => r.success);
        
        console.log('\n\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║           COMPREHENSIVE BACKTEST REPORT                        ║');
        console.log('║           90 Days | Top 10 Coins | 4 Parameter Sets           ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // Best by Total PnL
        const byPnL = [...validResults].sort((a, b) => (b.totalPnL || 0) - (a.totalPnL || 0));
        
        // Best by Sharpe Ratio
        const bySharpe = [...validResults].sort((a, b) => (b.sharpeRatio || 0) - (a.sharpeRatio || 0));
        
        // Best by Win Rate
        const byWinRate = [...validResults].sort((a, b) => (b.winRate || 0) - (a.winRate || 0));

        // Best Risk-Adjusted (PnL / Drawdown)
        const byRiskAdj = [...validResults].sort((a, b) => {
            const aScore = (a.totalPnL || 0) / (a.maxDrawdown || 1);
            const bScore = (b.totalPnL || 0) / (b.maxDrawdown || 1);
            return bScore - aScore;
        });

        // Aggregate by parameter set
        const byParams = {};
        PARAMETER_SETS.forEach(p => byParams[p.name] = []);
        validResults.forEach(r => byParams[r.params].push(r));

        // Calculate averages
        const paramSummary = {};
        for (const [paramName, results] of Object.entries(byParams)) {
            paramSummary[paramName] = {
                avgPnL: results.reduce((s, r) => s + (r.totalPnL || 0), 0) / results.length,
                avgSharpe: results.reduce((s, r) => s + (r.sharpeRatio || 0), 0) / results.length,
                avgWinRate: results.reduce((s, r) => s + (r.winRate || 0), 0) / results.length,
                avgDrawdown: results.reduce((s, r) => s + (r.maxDrawdown || 0), 0) / results.length,
                totalTrades: results.reduce((s, r) => s + (r.totalTrades || 0), 0)
            };
        }

        // PARAMETER SET PERFORMANCE
        console.log('PARAMETER SET COMPARISON');
        console.log('═'.repeat(80));
        console.log('Config       | Avg PnL    | Avg Sharpe | Avg Win%  | Avg DD    | Total Trades');
        console.log('─────────────|────────────|────────────|───────────|───────────|──────────────');
        
        for (const [name, stats] of Object.entries(paramSummary)) {
            const pnl = `$${stats.avgPnL.toFixed(2)}`.padStart(10);
            const sharpe = stats.avgSharpe.toFixed(2).padStart(10);
            const win = `${stats.avgWinRate.toFixed(1)}%`.padStart(9);
            const dd = `${stats.avgDrawdown.toFixed(1)}%`.padStart(9);
            const trades = stats.totalTrades.toString().padStart(12);
            console.log(`${name.padEnd(12)} | ${pnl} | ${sharpe} | ${win} | ${dd} | ${trades}`);
        }

        // TOP PERFORMERS
        console.log('\n\n🏆 TOP PERFORMERS BY CATEGORY');
        console.log('═'.repeat(80));

        console.log('\n📈 Best Total PnL:');
        byPnL.slice(0, 5).forEach((r, i) => {
            console.log(`  ${i+1}. ${r.coin} (${r.params}) - $${(r.totalPnL || 0).toFixed(2)} | Sharpe: ${(r.sharpeRatio || 0).toFixed(2)}`);
        });

        console.log('\n⚖️  Best Risk-Adjusted (Sharpe):');
        bySharpe.slice(0, 5).forEach((r, i) => {
            console.log(`  ${i+1}. ${r.coin} (${r.params}) - Sharpe: ${(r.sharpeRatio || 0).toFixed(2)} | PnL: $${(r.totalPnL || 0).toFixed(2)}`);
        });

        console.log('\n✅ Best Win Rate:');
        byWinRate.slice(0, 5).forEach((r, i) => {
            console.log(`  ${i+1}. ${r.coin} (${r.params}) - ${(r.winRate || 0).toFixed(1)}% | PnL: $${(r.totalPnL || 0).toFixed(2)}`);
        });

        console.log('\n🛡️  Best Risk/Reward (PnL/DD):');
        byRiskAdj.slice(0, 5).forEach((r, i) => {
            const ratio = ((r.totalPnL || 0) / (r.maxDrawdown || 1)).toFixed(2);
            console.log(`  ${i+1}. ${r.coin} (${r.params}) - Ratio: ${ratio} | PnL: $${(r.totalPnL || 0).toFixed(2)} | DD: ${(r.maxDrawdown || 0).toFixed(1)}%`);
        });

        // COIN-SPECIFIC RECOMMENDATIONS
        console.log('\n\n📊 COIN-SPECIFIC OPTIMAL SETTINGS');
        console.log('═'.repeat(80));

        TOP_COINS.forEach(coin => {
            const coinResults = validResults.filter(r => r.coin === coin);
            if (coinResults.length > 0) {
                const bestByPnL = coinResults.sort((a, b) => (b.totalPnL || 0) - (a.totalPnL || 0))[0];
                console.log(`${coin.padEnd(10)} | Best: ${bestByPnL.params.padEnd(12)} | PnL: $${(bestByPnL.totalPnL || 0).toFixed(2).padStart(8)} | Sharpe: ${(bestByPnL.sharpeRatio || 0).toFixed(2)}`);
            }
        });

        // CLAUDE'S ANALYSIS
        console.log('\n\n🔍 CLAUDE ANALYSIS');
        console.log('═'.repeat(80));

        const bestOverall = byPnL[0];
        const bestSharpe = bySharpe[0];
        const bestConservative = paramSummary['Conservative'];
        const bestAggressive = paramSummary['Aggressive'];

        console.log('\n1. OPTIMAL PARAMETER SET:');
        if (bestAggressive.avgPnL > bestConservative.avgPnL * 2 && bestAggressive.avgSharpe > 1) {
            console.log('   → Aggressive configuration shows strong returns with acceptable risk');
            console.log('   → Recommended for high-risk tolerance traders');
        } else if (bestConservative.avgSharpe > bestAggressive.avgSharpe) {
            console.log('   → Conservative configuration offers best risk-adjusted returns');
            console.log('   → Recommended for most traders');
        } else {
            console.log('   → Moderate configuration provides balanced risk/reward');
            console.log('   → Recommended for balanced approach');
        }

        console.log('\n2. BEST PERFORMING COIN:');
        console.log(`   → ${bestOverall.coin} with ${bestOverall.params} settings`);
        console.log(`   → Generated $${(bestOverall.totalPnL || 0).toFixed(2)} over 90 days`);
        console.log(`   → ${(bestOverall.totalReturn || 0).toFixed(2)}% return on $10,000 capital`);

        console.log('\n3. RISK ASSESSMENT:');
        const avgDrawdown = validResults.reduce((s, r) => s + (r.maxDrawdown || 0), 0) / validResults.length;
        if (avgDrawdown < 15) {
            console.log('   → Low average drawdown - strategy is relatively safe');
        } else if (avgDrawdown < 25) {
            console.log('   → Moderate drawdown - acceptable for active trading');
        } else {
            console.log('   → High drawdown - consider reducing leverage');
        }

        console.log('\n4. SHARPE RATIO ANALYSIS:');
        if (bestSharpe.sharpeRatio > 1.5) {
            console.log(`   → Excellent risk-adjusted returns (${bestSharpe.sharpeRatio.toFixed(2)} Sharpe)`);
            console.log(`   → Strategy consistently generates returns above risk-free rate`);
        } else if (bestSharpe.sharpeRatio > 1) {
            console.log(`   → Good risk-adjusted returns (${bestSharpe.sharpeRatio.toFixed(2)} Sharpe)`);
            console.log(`   → Strategy is viable for portfolio inclusion`);
        } else {
            console.log(`   → Below optimal Sharpe (${bestSharpe.sharpeRatio.toFixed(2)})`);
            console.log(`   → Consider optimizing entry/exit criteria`);
        }

        // RECOMMENDATIONS
        console.log('\n\n💡 CLAUDE RECOMMENDATIONS');
        console.log('═'.repeat(80));

        console.log('\n1. RECOMMENDED CONFIGURATION:');
        console.log(`   → Use ${bestSharpe.params} settings for best risk-adjusted returns`);
        console.log(`   → Focus on ${bestSharpe.coin} as primary trading pair`);
        console.log(`   → Leverage: ${PARAMETER_SETS.find(p => p.name === bestSharpe.params).leverage}x`);

        console.log('\n2. PORTFOLIO ALLOCATION:');
        console.log('   → Allocate 40% to top performer (' + bestOverall.coin + ')');
        console.log('   → Allocate 30% to second best performer');
        console.log('   → Allocate remaining 30% across other coins');

        console.log('\n3. RISK MANAGEMENT:');
        if (bestAggressive.avgDrawdown > 20) {
            console.log('   → Reduce maximum leverage from 10x to 5x');
        }
        console.log('   → Set daily loss limit at $500 (5% of capital)');
        console.log('   → Use stop-loss of 2% on all positions');
        console.log('   → Take profits at 3% target');

        console.log('\n4. NEXT STEPS:');
        console.log('   → Run ML optimization for top 3 performers');
        console.log(`   → Command: node src/backtesting/ml_optimize.js --market ${bestOverall.coin} --model xgboost`);
        console.log('   → Paper trade optimal configuration for 30 days');
        console.log('   → Monitor correlation between coins for diversification');
        console.log('   → Consider walk-forward analysis for out-of-sample validation');

        // Save detailed report
        const reportPath = path.join(__dirname, `comprehensive-backtest-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            period: '90 days',
            timeframe: '15m',
            coins: TOP_COINS,
            parameterSets: PARAMETER_SETS,
            results: validResults,
            summary: {
                byPnL: byPnL.slice(0, 10),
                bySharpe: bySharpe.slice(0, 10),
                byWinRate: byWinRate.slice(0, 10),
                byRiskAdj: byRiskAdj.slice(0, 10),
                paramSummary
            },
            recommendations: {
                bestOverall: { coin: bestOverall.coin, params: bestOverall.params },
                bestSharpe: { coin: bestSharpe.coin, params: bestSharpe.params },
                optimalLeverage: PARAMETER_SETS.find(p => p.name === bestSharpe.params).leverage
            }
        }, null, 2));

        console.log(`\n📄 Full report saved: ${reportPath}`);
        console.log('\n' + '═'.repeat(80));
    }
}

// Main
async function main() {
    const backtester = new ComprehensiveBacktester();
    await backtester.runComprehensiveTests();
}

if (require.main === module) {
    main().catch(error => {
        logger.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = ComprehensiveBacktester;
