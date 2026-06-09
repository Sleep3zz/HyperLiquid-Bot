#!/usr/bin/env node
/**
 * Batch Coin Optimizer
 * Runs coin-optimizer.js for all configured coins sequentially
 * 
 * Usage: node batch-optimizer.js [--coins BTC,ETH,SOL]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_COINS = [
    'BTC', 'ETH', 'SOL', 'HYPE', 'ARB',
    'OP', 'LINK', 'AVAX', 'NEAR', 'UNI'
];

class BatchOptimizer {
    constructor(coins) {
        this.coins = coins || DEFAULT_COINS;
        this.results = [];
        this.optimalDir = path.join(__dirname, 'data', 'optimal');
    }

    async runCoin(coin) {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`PROCESSING: ${coin}`);
        console.log('='.repeat(80));
        
        const startTime = Date.now();
        
        try {
            const output = execSync(
                `node coin-optimizer.js --coin ${coin}`,
                {
                    encoding: 'utf8',
                    cwd: __dirname,
                    timeout: 300000 // 5 minutes per coin
                }
            );
            
            console.log(output);
            
            // Load optimal config
            const optimalFile = path.join(this.optimalDir, `${coin}-optimal.json`);
            let optimal = null;
            if (fs.existsSync(optimalFile)) {
                optimal = JSON.parse(fs.readFileSync(optimalFile, 'utf8'));
            }
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            
            this.results.push({
                coin,
                status: 'SUCCESS',
                duration: `${duration}s`,
                recommended: optimal?.recommended || 'N/A',
                expectedReturn: optimal?.expectedReturn || 0,
                expectedSharpe: optimal?.expectedSharpe || 0
            });
            
            return true;
            
        } catch (error) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            
            this.results.push({
                coin,
                status: 'FAILED',
                duration: `${duration}s`,
                error: error.message
            });
            
            console.error(`❌ ${coin} failed: ${error.message}`);
            return false;
        }
    }

    async runAll() {
        console.log('\n' + '='.repeat(80));
        console.log('BATCH COIN OPTIMIZER');
        console.log('='.repeat(80));
        console.log(`Coins: ${this.coins.join(', ')}`);
        console.log(`Total: ${this.coins.length} coins`);
        console.log('='.repeat(80) + '\n');
        
        const totalStart = Date.now();
        let successCount = 0;
        
        for (const coin of this.coins) {
            const success = await this.runCoin(coin);
            if (success) successCount++;
            
            // Brief pause between coins
            if (coin !== this.coins[this.coins.length - 1]) {
                console.log('\n⏳ Pausing 2s before next coin...');
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        const totalDuration = ((Date.now() - totalStart) / 1000).toFixed(1);
        
        this.generateSummary(totalDuration, successCount);
    }

    generateSummary(duration, successCount) {
        console.log('\n\n' + '='.repeat(80));
        console.log('BATCH OPTIMIZATION SUMMARY');
        console.log('='.repeat(80));
        console.log(`Duration: ${duration}s`);
        console.log(`Success: ${successCount}/${this.coins.length}`);
        console.log('='.repeat(80) + '\n');
        
        // Load all optimal configs
        const optimalConfigs = [];
        for (const coin of this.coins) {
            const optimalFile = path.join(this.optimalDir, `${coin}-optimal.json`);
            if (fs.existsSync(optimalFile)) {
                const config = JSON.parse(fs.readFileSync(optimalFile, 'utf8'));
                optimalConfigs.push(config);
            }
        }
        
        // Sort by expected return
        const sortedByReturn = [...optimalConfigs].sort((a, b) => 
            (b.expectedReturn || 0) - (a.expectedReturn || 0)
        );
        
        // Display table
        console.log('OPTIMAL CONFIGURATIONS:');
        console.log('-'.repeat(80));
        console.log(`${'Coin'.padEnd(8)} ${'Config'.padEnd(18)} ${'Return'.padEnd(12)} ${'Sharpe'.padEnd(10)} ${'Status'.padEnd(12)}`);
        console.log('-'.repeat(80));
        
        this.results.forEach(r => {
            const returnStr = r.expectedReturn !== undefined 
                ? `${r.expectedReturn >= 0 ? '+' : ''}${r.expectedReturn.toFixed(2)}%`
                : 'N/A';
            const sharpeStr = r.expectedSharpe !== undefined 
                ? r.expectedSharpe.toFixed(2) 
                : 'N/A';
            console.log(
                `${r.coin.padEnd(8)} ` +
                `${(r.recommended || 'N/A').padEnd(18)} ` +
                `${returnStr.padEnd(12)} ` +
                `${sharpeStr.padEnd(10)} ` +
                `${r.status.padEnd(12)}`
            );
        });
        
        // Best performers
        if (sortedByReturn.length > 0) {
            console.log('\n' + '='.repeat(80));
            console.log('TOP PERFORMERS:');
            console.log('='.repeat(80));
            
            sortedByReturn.slice(0, 5).forEach((c, i) => {
                console.log(`${i + 1}. ${c.coin} (${c.recommended})`);
                console.log(`   Expected Return: ${c.expectedReturn.toFixed(2)}%`);
                console.log(`   Expected Sharpe: ${c.expectedSharpe.toFixed(2)}`);
                console.log(`   Leverage: ${c.params.leverage}x | Position: ${(c.params.positionSize * 100).toFixed(0)}%`);
            });
        }
        
        // File locations
        console.log('\n' + '='.repeat(80));
        console.log('DATA LOCATIONS:');
        console.log('='.repeat(80));
        console.log(`Chart Data:     data/charts/<coin>/`);
        console.log(`Test Results:   data/results/<coin>/`);
        console.log(`Optimal Config: data/optimal/<coin>-optimal.json`);
        
        // Save batch summary
        const summaryFile = path.join(__dirname, 'data', `batch-summary-${Date.now()}.json`);
        fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
        fs.writeFileSync(summaryFile, JSON.stringify({
            timestamp: new Date().toISOString(),
            duration: `${duration}s`,
            coins: this.coins,
            results: this.results,
            optimalConfigs: sortedByReturn
        }, null, 2));
        
        console.log(`\n📊 Summary saved: ${summaryFile}`);
        console.log('='.repeat(80) + '\n');
    }
}

// CLI
async function main() {
    const args = process.argv.slice(2);
    let coins = null;
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--coins' || args[i] === '-c') {
            coins = args[i + 1].split(',').map(c => c.trim().toUpperCase());
        }
    }
    
    const optimizer = new BatchOptimizer(coins);
    await optimizer.runAll();
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = BatchOptimizer;