#!/usr/bin/env node
/**
 * Phase 3: Regime Observation Runner
 * 
 * Run this to observe market regimes for 2-3 days without trading.
 * Logs regime flips and calculates thrash statistics.
 * 
 * Usage: node phase3-observe.js --coin BTC [--interval 15m]
 */

const path = require('path');
const fs = require('fs');

const WORKSPACE_ROOT = path.join(__dirname, '..');

const StrategyOrchestrator = require(path.join(WORKSPACE_ROOT, 'src', 'orchestrator'));
const WayfinderAgent = require(path.join(WORKSPACE_ROOT, '..', 'model-router', 'src', 'agents', 'wayfinder-agent'));

const DATA_DIR = path.join(__dirname, '..', 'data', 'regime-observation');

// Parse args
const args = process.argv.slice(2);
const coinArg = args.find(a => a.startsWith('--coin'))?.split('=')[1] || 'BTC';
const intervalArg = args.find(a => a.startsWith('--interval'))?.split('=')[1] || '15m';

const COIN = coinArg.toUpperCase();
const INTERVAL_MS = parseInterval(intervalArg);

function parseInterval(str) {
    const num = parseInt(str);
    if (str.includes('m')) return num * 60 * 1000;
    if (str.includes('h')) return num * 60 * 60 * 1000;
    return num * 60 * 1000; // default minutes
}

// Setup logging
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const logFile = path.join(DATA_DIR, `${COIN}-phase3-${Date.now()}.log`);

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

async function main() {
    console.log('='.repeat(70));
    console.log('PHASE 3: REGIME OBSERVATION');
    console.log('='.repeat(70));
    console.log(`Coin: ${COIN}`);
    console.log(`Interval: ${intervalArg} (${INTERVAL_MS/1000}s)`);
    console.log(`Log file: ${logFile}`);
    console.log('');
    console.log('This will observe market regimes WITHOUT trading.');
    console.log('Run for 2-3 days, then check thrash statistics.');
    console.log('Press Ctrl+C to stop and view report.');
    console.log('='.repeat(70));
    console.log('');

    const wayfinder = new WayfinderAgent({ autoConnect: false });
    const orchestrator = new StrategyOrchestrator(wayfinder, logger);

    // Start observation
    await orchestrator.startObservation(COIN, INTERVAL_MS);

    // Status reporting every 5 minutes
    const statusInterval = setInterval(() => {
        const stats = orchestrator.regimeThrashStats();
        logger.info(`[STATUS] Observations: ${stats.total}, Flips: ${stats.flips}, FlipRate: ${stats.flipRate}`);
        logger.info(`[STATUS] Regime distribution: ${JSON.stringify(stats.byRegime)}`);
    }, 5 * 60 * 1000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n');
        console.log('='.repeat(70));
        console.log('OBSERVATION STOPPED');
        console.log('='.repeat(70));
        
        clearInterval(statusInterval);
        orchestrator.stopObservation();
        
        const report = orchestrator.exportReport();
        const reportFile = path.join(DATA_DIR, `${COIN}-phase3-report-${Date.now()}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        
        console.log('');
        console.log('THRASH STATISTICS:');
        console.log(`  Total observations: ${report.stats.total}`);
        console.log(`  Regime flips: ${report.stats.flips}`);
        console.log(`  Flip rate: ${report.stats.flipRate} (target: <0.05)`);
        console.log(`  Time by regime: ${JSON.stringify(report.stats.byRegime)}`);
        console.log(`  Last regime: ${report.stats.lastRegime}`);
        console.log('');
        console.log(`Report saved: ${reportFile}`);
        console.log('');
        console.log('INTERPRETATION:');
        if (parseFloat(report.stats.flipRate) < 0.05) {
            console.log('  ✅ Flip rate is healthy (< 5%). Ready for Phase 4.');
        } else if (parseFloat(report.stats.flipRate) < 0.15) {
            console.log('  ⚠️  Flip rate is elevated (5-15%). Consider raising hysteresis.');
        } else {
            console.log('  🔴 Flip rate is too high (> 15%). Regime detection needs tuning.');
        }
        console.log('');
        
        process.exit(0);
    });
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
