#!/usr/bin/env node
/**
 * Weekly Parameter Update Scheduler
 * 
 * Run this weekly to:
 * 1. Download fresh 90-day data for all coins
 * 2. Run parameter optimization
 * 3. Save results and update bot configs
 * 4. Generate reports on parameter changes
 * 
 * Usage:
 *   node weekly-update.js              # Run full update
 *   node weekly-update.js --dry-run    # Simulate without saving
 *   node weekly-update.js --coins BTC,ETH  # Update specific coins only
 * 
 * To schedule (Linux/Mac):
 *   crontab -e
 *   # Add: 0 0 * * 0 cd /path/to/HyperLiquid-Bot && node weekly-update.js >> weekly-update.log 2>&1
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ParameterManager = require('./param-manager');

const DEFAULT_COINS = [
    'BTC', 'ETH', 'SOL', 'HYPE', 'ARB',
    'OP', 'LINK', 'AVAX', 'NEAR', 'UNI'
];

const REPORT_DIR = path.join(__dirname, 'data', 'weekly-reports');

class WeeklyUpdate {
    constructor(options = {}) {
        this.coins = options.coins || DEFAULT_COINS;
        this.dryRun = options.dryRun || false;
        this.results = [];
        
        if (!fs.existsSync(REPORT_DIR)) {
            fs.mkdirSync(REPORT_DIR, { recursive: true });
        }
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warn' ? '⚠️' : 'ℹ️';
        console.log(`[${timestamp}] ${prefix} ${message}`);
    }

    /**
     * Step 1: Backup current configs
     */
    backupConfigs() {
        this.log('Backing up current configurations...');
        
        const backupDir = path.join(__dirname, 'data', 'backups', `backup-${Date.now()}`);
        fs.mkdirSync(backupDir, { recursive: true });
        
        const optimalDir = path.join(__dirname, 'data', 'optimal');
        
        if (fs.existsSync(optimalDir)) {
            const files = fs.readdirSync(optimalDir);
            for (const file of files) {
                const src = path.join(optimalDir, file);
                const dest = path.join(backupDir, file);
                fs.copyFileSync(src, dest);
            }
            this.log(`Backed up ${files.length} configs to ${backupDir}`, 'success');
        }
        
        return backupDir;
    }

    /**
     * Step 2: Run optimizer for each coin
     */
    async runOptimization() {
        this.log(`Starting optimization for ${this.coins.length} coins...`);
        
        const startTime = Date.now();
        
        for (const coin of this.coins) {
            try {
                this.log(`Processing ${coin}...`);
                
                // Get old params for comparison
                const oldParams = ParameterManager.getOptimalParams(coin);
                
                // Run optimizer
                const cmd = `node coin-optimizer.js --coin ${coin}`;
                const output = execSync(cmd, {
                    encoding: 'utf8',
                    cwd: __dirname,
                    timeout: 300000
                });
                
                // Get new params
                const newParams = ParameterManager.getOptimalParams(coin);
                
                // Save to history
                if (!this.dryRun) {
                    ParameterManager.saveParamHistory(coin, newParams, {
                        expectedReturn: newParams.expectedReturn,
                        expectedSharpe: newParams.expectedSharpe
                    });
                }
                
                this.results.push({
                    coin,
                    status: 'SUCCESS',
                    oldParams,
                    newParams,
                    changed: oldParams.configName !== newParams.configName ||
                             oldParams.leverage !== newParams.leverage ||
                             oldParams.positionSize !== newParams.positionSize
                });
                
                this.log(`${coin} complete: ${newParams.configName} config, ${newParams.expectedReturn.toFixed(2)}% expected return`, 'success');
                
                // Brief pause between coins
                await new Promise(r => setTimeout(r, 1000));
                
            } catch (error) {
                this.log(`${coin} failed: ${error.message}`, 'error');
                this.results.push({
                    coin,
                    status: 'FAILED',
                    error: error.message
                });
            }
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        this.log(`Optimization complete in ${duration}s`, 'success');
    }

    /**
     * Step 3: Generate bot config
     */
    generateBotConfig() {
        this.log('Generating bot configuration...');
        
        if (!this.dryRun) {
            ParameterManager.generateBotConfig();
        }
        
        this.log('Bot config generated', 'success');
    }

    /**
     * Step 4: Generate weekly report
     */
    generateReport() {
        this.log('Generating weekly report...');
        
        const changedCoins = this.results.filter(r => r.changed);
        const failedCoins = this.results.filter(r => r.status === 'FAILED');
        const successfulCoins = this.results.filter(r => r.status === 'SUCCESS');
        
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalCoins: this.coins.length,
                successful: successfulCoins.length,
                failed: failedCoins.length,
                changed: changedCoins.length
            },
            coins: this.results.map(r => ({
                coin: r.coin,
                status: r.status,
                config: r.newParams?.configName || 'N/A',
                leverage: r.newParams?.leverage || 0,
                positionSize: r.newParams?.positionSize || 0,
                expectedReturn: r.newParams?.expectedReturn || 0,
                expectedSharpe: r.newParams?.expectedSharpe || 0,
                changed: r.changed || false
            })),
            changes: changedCoins.map(r => ({
                coin: r.coin,
                from: {
                    config: r.oldParams.configName,
                    leverage: r.oldParams.leverage,
                    positionSize: r.oldParams.positionSize
                },
                to: {
                    config: r.newParams.configName,
                    leverage: r.newParams.leverage,
                    positionSize: r.newParams.positionSize
                }
            })),
            recommendations: this.generateRecommendations()
        };
        
        // Save report
        const reportFile = path.join(REPORT_DIR, `weekly-report-${Date.now()}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        
        // Also save as latest
        const latestFile = path.join(REPORT_DIR, 'latest-report.json');
        fs.writeFileSync(latestFile, JSON.stringify(report, null, 2));
        
        this.log(`Report saved: ${reportFile}`, 'success');
        
        return report;
    }

    /**
     * Generate trading recommendations based on results
     */
    generateRecommendations() {
        const recommendations = [];
        
        for (const result of this.results) {
            if (result.status !== 'SUCCESS') continue;
            
            const p = result.newParams;
            let action = 'HOLD';
            let priority = 'low';
            
            if (p.expectedSharpe > 0.5 && p.expectedReturn > 0.5) {
                action = 'ADD_POSITION';
                priority = 'high';
            } else if (p.expectedSharpe > 0.3 && p.expectedReturn > 0) {
                action = 'TRADE';
                priority = 'medium';
            } else if (p.expectedReturn < 0) {
                action = 'REDUCE';
                priority = 'high';
            }
            
            if (result.changed) {
                action = 'REVIEW';
                priority = 'high';
            }
            
            recommendations.push({
                coin: result.coin,
                action,
                priority,
                reason: this.getRecommendationReason(result, action),
                params: {
                    leverage: p.leverage,
                    positionSize: p.positionSize,
                    profitTarget: p.profitTarget,
                    stopLoss: p.stopLoss
                }
            });
        }
        
        // Sort by priority
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    }

    getRecommendationReason(result, action) {
        const p = result.newParams;
        
        switch (action) {
            case 'ADD_POSITION':
                return `Strong performance expected (${p.expectedReturn.toFixed(2)}% return, ${p.expectedSharpe.toFixed(2)} Sharpe)`;
            case 'TRADE':
                return `Moderate performance expected (${p.expectedReturn.toFixed(2)}% return)`;
            case 'REDUCE':
                return `Poor expected performance (${p.expectedReturn.toFixed(2)}% return)`;
            case 'REVIEW':
                return `Parameters changed from ${result.oldParams.configName} to ${p.configName}`;
            default:
                return 'No action required';
        }
    }

    /**
     * Print summary to console
     */
    printSummary(report) {
        console.log('\n' + '='.repeat(80));
        console.log('WEEKLY UPDATE SUMMARY');
        console.log('='.repeat(80));
        console.log(`Timestamp: ${report.timestamp}`);
        console.log(`Coins Processed: ${report.summary.totalCoins}`);
        console.log(`Successful: ${report.summary.successful}`);
        console.log(`Failed: ${report.summary.failed}`);
        console.log(`Parameters Changed: ${report.summary.changed}`);
        console.log('='.repeat(80));
        
        if (report.changes.length > 0) {
            console.log('\nPARAMETER CHANGES:');
            console.log('-'.repeat(80));
            for (const change of report.changes) {
                console.log(`${change.coin}:`);
                console.log(`  ${change.from.config} (${change.from.leverage}x, ${(change.from.positionSize * 100).toFixed(0)}%)`);
                console.log(`  → ${change.to.config} (${change.to.leverage}x, ${(change.to.positionSize * 100).toFixed(0)}%)`);
            }
        }
        
        console.log('\nTOP RECOMMENDATIONS:');
        console.log('-'.repeat(80));
        const highPriority = report.recommendations.filter(r => r.priority === 'high').slice(0, 5);
        for (const rec of highPriority) {
            console.log(`${rec.action.padEnd(15)} ${rec.coin.padEnd(8)} ${rec.reason}`);
        }
        
        console.log('='.repeat(80) + '\n');
    }

    /**
     * Main execution
     */
    async run() {
        console.log('\n' + '='.repeat(80));
        console.log('WEEKLY PARAMETER UPDATE');
        console.log('='.repeat(80));
        console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}`);
        console.log(`Coins: ${this.coins.join(', ')}`);
        console.log(`Time: ${new Date().toISOString()}`);
        console.log('='.repeat(80) + '\n');
        
        // Step 1: Backup
        if (!this.dryRun) {
            this.backupConfigs();
        }
        
        // Step 2: Optimize
        await this.runOptimization();
        
        // Step 3: Generate config
        this.generateBotConfig();
        
        // Step 4: Report
        const report = this.generateReport();
        this.printSummary(report);
        
        // Final status
        const allSuccess = this.results.every(r => r.status === 'SUCCESS');
        console.log(allSuccess 
            ? '✅ Weekly update completed successfully' 
            : `⚠️ Weekly update completed with ${this.results.filter(r => r.status === 'FAILED').length} failures`);
        
        return report;
    }
}

// CLI
async function main() {
    const args = process.argv.slice(2);
    const options = {
        dryRun: args.includes('--dry-run'),
        coins: null
    };
    
    // Parse --coins flag
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--coins' && args[i + 1]) {
            options.coins = args[i + 1].split(',').map(c => c.trim().toUpperCase());
        }
    }
    
    const updater = new WeeklyUpdate(options);
    await updater.run();
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = WeeklyUpdate;