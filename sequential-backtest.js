#!/usr/bin/env node
/**
 * Sequential 90-Day Backtest for Top 10 Coins
 * 
 * Runs backtests one at a time to avoid overwhelming the system
 * Uses Claude for analysis of results
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOP_COINS = [
    'BTC-PERP', 'ETH-PERP', 'SOL-PERP', 'HYPE-PERP', 'ARB-PERP',
    'OP-PERP', 'LINK-PERP', 'AVAX-PERP', 'NEAR-PERP', 'UNI-PERP'
];

const CONFIGS = [
    { name: 'Conservative', leverage: 2, position: 0.05, profit: 1.2 },
    { name: 'Moderate', leverage: 3, position: 0.08, profit: 1.5 },
    { name: 'Aggressive', leverage: 5, position: 0.12, profit: 2.0 },
    { name: 'High-Risk', leverage: 10, position: 0.2, profit: 3.0 }
];

class SequentialBacktester {
    constructor() {
        this.results = [];
        this.outputDir = path.join(__dirname, 'backtest-results');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    async runBacktest(coin, config) {
        console.log(`\n[${coin}] Testing ${config.name} (lev:${config.leverage}x, pos:${(config.position*100).toFixed(0)}%)...`);
        
        try {
            const cmd = [
                'node src/backtesting/run.js',
                '--config backtest',
                `--market ${coin}`,
                '--timeframe 15m',
                `--leverage ${config.leverage}`,
                `--position ${config.position}`,
                `--profit ${config.profit}`,
                '--capital 10000'
            ].join(' ');

            const startTime = Date.now();
            
            // Run synchronously (one at a time)
            execSync(cmd, {
                encoding: 'utf8',
                cwd: __dirname,
                timeout: 300000, // 5 minute timeout per backtest
                stdio: 'pipe'
            });

            // Parse results from log
            const metrics = this.parseMetrics();
            
            const result = {
                coin,
                config: config.name,
                leverage: config.leverage,
                position: config.position,
                duration: Date.now() - startTime,
                ...metrics
            };

            this.results.push(result);
            
            console.log(`  ✓ ${config.name}: PnL:$${(metrics.totalPnL || 0).toFixed(2)} | Sharpe:${(metrics.sharpeRatio || 0).toFixed(2)} | Trades:${metrics.totalTrades || 0}`);
            
            return result;

        } catch (error) {
            console.error(`  ✗ Error: ${error.message}`);
            return { coin, config: config.name, error: error.message };
        }
    }

    parseMetrics() {
        const logFile = path.join(__dirname, 'backtest_results.log');
        if (!fs.existsSync(logFile)) return {};

        const logContent = fs.readFileSync(logFile, 'utf8');
        const lines = logContent.split('\n');
        const lastLines = lines.slice(-100);

        const metrics = {};

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
        }

        return metrics;
    }

    async runAll() {
        console.log('╔════════════════════════════════════════════════╗');
        console.log('║  SEQUENTIAL 90-DAY BACKTEST - TOP 10 COINS     ║');
        console.log('╚════════════════════════════════════════════════╝\n');
        
        console.log(`Coins: ${TOP_COINS.join(', ')}`);
        console.log(`Configurations: ${CONFIGS.map(c => c.name).join(', ')}`);
        console.log(`Total combinations: ${TOP_COINS.length * CONFIGS.length}`);
        console.log(`Estimated time: ~${Math.ceil((TOP_COINS.length * CONFIGS.length * 2) / 60)} hours\n`);
        console.log('Running sequentially to avoid system overload...\n');

        let completed = 0;
        const total = TOP_COINS.length * CONFIGS.length;

        for (const coin of TOP_COINS) {
            console.log(`\n📊 ${coin} (${++completed}/${total})`);
            console.log('─'.repeat(60));

            for (const config of CONFIGS) {
                await this.runBacktest(coin, config);
                completed++;
                
                // Small delay between backtests
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        this.generateReport();
    }

    generateReport() {
        const validResults = this.results.filter(r => !r.error);
        
        console.log('\n\n╔════════════════════════════════════════════════╗');
        console.log('║           BACKTEST REPORT                      ║');
        console.log('╚════════════════════════════════════════════════╝\n');

        // Best by PnL
        const byPnL = [...validResults].sort((a, b) => (b.totalPnL || 0) - (a.totalPnL || 0));
        
        // Best by Sharpe
        const bySharpe = [...validResults].sort((a, b) => (b.sharpeRatio || 0) - (a.sharpeRatio || 0));

        console.log('🏆 TOP 10 BY TOTAL P&L:');
        byPnL.slice(0, 10).forEach((r, i) => {
            console.log(`  ${i+1}. ${r.coin} (${r.config}): $${(r.totalPnL || 0).toFixed(2)} | Sharpe: ${(r.sharpeRatio || 0).toFixed(2)}`);
        });

        console.log('\n⚖️  TOP 10 BY SHARPE RATIO:');
        bySharpe.slice(0, 10).forEach((r, i) => {
            console.log(`  ${i+1}. ${r.coin} (${r.config}): ${(r.sharpeRatio || 0).toFixed(2)} | PnL: $${(r.totalPnL || 0).toFixed(2)}`);
        });

        // Configuration summary
        console.log('\n📊 CONFIGURATION SUMMARY:');
        CONFIGS.forEach(config => {
            const configResults = validResults.filter(r => r.config === config.name);
            const avgPnL = configResults.reduce((s, r) => s + (r.totalPnL || 0), 0) / configResults.length;
            const avgSharpe = configResults.reduce((s, r) => s + (r.sharpeRatio || 0), 0) / configResults.length;
            console.log(`  ${config.name.padEnd(12)} | Avg PnL: $${avgPnL.toFixed(2).padStart(8)} | Avg Sharpe: ${avgSharpe.toFixed(2)}`);
        });

        // Save results
        const reportPath = path.join(this.outputDir, `backtest-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            results: validResults,
            topByPnL: byPnL.slice(0, 10),
            topBySharpe: bySharpe.slice(0, 10)
        }, null, 2));

        console.log(`\n📄 Full report saved: ${reportPath}`);
    }
}

// Run if called directly
if (require.main === module) {
    const backtester = new SequentialBacktester();
    backtester.runAll().catch(console.error);
}

module.exports = SequentialBacktester;
