#!/usr/bin/env node
/**
 * Phase 3: Multi-Coin Regime Observation Runner
 * 
 * Run this to observe market regimes for multiple coins simultaneously.
 * Logs regime flips and calculates thrash statistics for each coin.
 * 
 * Usage: 
 *   node phase3-observe-multi.js --coins BTC,ETH,ARB
 *   node phase3-observe-multi.js --coins BTC --interval 15m
 */

const path = require('path');
const fs = require('fs');

const WORKSPACE_ROOT = path.join(__dirname, '..');

const StrategyOrchestrator = require(path.join(WORKSPACE_ROOT, 'src', 'orchestrator'));
const WayfinderAgent = require(path.join(WORKSPACE_ROOT, '..', 'model-router', 'src', 'agents', 'wayfinder-agent'));

const DATA_DIR = path.join(__dirname, '..', 'data', 'regime-observation');

// Parse args
const args = process.argv.slice(2);
const coinsArg = args.find(a => a.startsWith('--coins'))?.split('=')[1] || 'BTC,ETH,ARB';
const intervalArg = args.find(a => a.startsWith('--interval'))?.split('=')[1] || '15m';

const COINS = coinsArg.split(',').map(c => c.trim().toUpperCase());
const INTERVAL_MS = parseInterval(intervalArg);

function parseInterval(str) {
    const num = parseInt(str);
    if (str.includes('m')) return num * 60 * 1000;
    if (str.includes('h')) return num * 60 * 60 * 1000;
    return num * 60 * 1000;
}

// Setup data directory
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Create multi-coin logger
const runId = Date.now();
const logFile = path.join(DATA_DIR, `MULTI-phase3-${runId}.log`);

const logger = {
    info: (msg) => {
        const line = `[${new Date().toISOString()}] INFO: ${msg}`;
        console.log(line);
        fs.appendFileSync(logFile, line + '\n');
    },
    warn: (msg) => {
        const line = `[${new Date().toISOString()}] WARN: ${msg}`;
        console.log(line);
        fs.appendFileSync(logFile, line + '\n');
    },
    error: (msg) => {
        const line = `[${new Date().toISOString()}] ERROR: ${msg}`;
        console.error(line);
        fs.appendFileSync(logFile, line + '\n');
    }
};

class MultiCoinObserver {
    constructor(coins, intervalMs) {
        this.coins = coins;
        this.intervalMs = intervalMs;
        this.orchestrators = new Map();
        this.wayfinder = new WayfinderAgent({ autoConnect: false });
    }

    async start() {
        logger.info(`Starting multi-coin observation for: ${this.coins.join(', ')}`);
        
        // Create orchestrator for each coin
        for (const coin of this.coins) {
            const orchestrator = new StrategyOrchestrator(this.wayfinder, {
                info: (msg) => logger.info(`[${coin}] ${msg}`),
                warn: (msg) => logger.warn(`[${coin}] ${msg}`),
                error: (msg) => logger.error(`[${coin}] ${msg}`)
            });
            
            this.orchestrators.set(coin, orchestrator);
            
            // Start observation with staggered timing to avoid rate limits
            await new Promise(r => setTimeout(r, 500));
            await orchestrator.startObservation(coin, this.intervalMs);
        }
        
        logger.info('All coins observing. Status reports every 5 minutes.');
    }

    stop() {
        for (const [coin, orch] of this.orchestrators) {
            orch.stopObservation();
        }
    }

    getStats() {
        const stats = {};
        for (const [coin, orch] of this.orchestrators) {
            stats[coin] = orch.regimeThrashStats();
        }
        return stats;
    }

    exportReport() {
        const reports = {};
        for (const [coin, orch] of this.orchestrators) {
            reports[coin] = orch.exportReport();
        }
        return {
            runId,
            timestamp: Date.now(),
            coins: this.coins,
            intervalMs: this.intervalMs,
            coinReports: reports
        };
    }
}

async function main() {
    console.log('='.repeat(70));
    console.log('PHASE 3: MULTI-COIN REGIME OBSERVATION');
    console.log('='.repeat(70));
    console.log(`Coins: ${COINS.join(', ')}`);
    console.log(`Interval: ${intervalArg} (${INTERVAL_MS/1000}s)`);
    console.log(`Log file: ${logFile}`);
    console.log('');
    console.log('This will observe market regimes WITHOUT trading.');
    console.log('Run for 2-3 days, then check thrash statistics.');
    console.log('Press Ctrl+C to stop and view report.');
    console.log('='.repeat(70));
    console.log('');

    const observer = new MultiCoinObserver(COINS, INTERVAL_MS);
    await observer.start();

    // Status reporting every 5 minutes
    const statusInterval = setInterval(() => {
        const stats = observer.getStats();
        logger.info('--- STATUS REPORT ---');
        for (const [coin, stat] of Object.entries(stats)) {
            logger.info(`${coin}: Obs=${stat.total}, Flips=${stat.flips}, Rate=${stat.flipRate}, Regime=${stat.lastRegime || 'N/A'}`);
        }
    }, 5 * 60 * 1000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n');
        console.log('='.repeat(70));
        console.log('OBSERVATION STOPPED');
        console.log('='.repeat(70));
        
        clearInterval(statusInterval);
        observer.stop();
        
        const report = observer.exportReport();
        const reportFile = path.join(DATA_DIR, `MULTI-phase3-report-${runId}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        
        console.log('');
        console.log('THRASH STATISTICS BY COIN:');
        for (const [coin, data] of Object.entries(report.coinReports)) {
            const s = data.stats;
            console.log(`  ${coin}:`);
            console.log(`    Observations: ${s.total}`);
            console.log(`    Flips: ${s.flips}`);
            console.log(`    Flip rate: ${s.flipRate} (target: <0.05)`);
            console.log(`    Regime time: ${JSON.stringify(s.byRegime)}`);
            console.log(`    Last regime: ${s.lastRegime || 'N/A'}`);
            
            const rate = parseFloat(s.flipRate);
            if (rate < 0.05) {
                console.log('    ✅ Healthy - ready for Phase 4');
            } else if (rate < 0.15) {
                console.log('    ⚠️  Elevated - consider raising hysteresis');
            } else {
                console.log('    🔴 Too high - needs tuning');
            }
            console.log('');
        }
        
        console.log(`Report saved: ${reportFile}`);
        console.log('');
        
        process.exit(0);
    });
}

main().catch(err => {
    logger.error('Fatal error: ' + err.message);
    console.error(err.stack);
    process.exit(1);
});
