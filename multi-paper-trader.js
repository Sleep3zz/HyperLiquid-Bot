#!/usr/bin/env node
/**
 * Multi-Coin Hybrid Paper Trader
 * Runs hybrid-paper-trader.js for multiple coins with regime-aware trading
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const COINS = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP']; // add more as needed
const DATA_DIR = path.join(__dirname, 'data', 'paper-trading');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     MULTI-COIN HYBRID PAPER TRADER                              ║');
console.log('║     Regime-Aware: BBRSI + Grid Strategy                         ║');
console.log('║     BTC | ETH | SOL                                             ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log('');

const processes = [];

function startHybridTrader(coin, capital = 1000) {
    console.log(`🚀 Starting hybrid trader for ${coin}...`);
    
    const child = spawn('node', [
        'hybrid-paper-trader.js',
        `--coin=${coin}`,
        `--capital=${capital}`
    ], {
        cwd: __dirname,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    processes.push({ coin, process: child });

    child.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                console.log(`[${coin}] ${line}`);
            }
        });
    });

    child.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                console.error(`[${coin} ERROR] ${line}`);
            }
        });
    });

    child.on('error', (err) => {
        console.error(`[${coin}] ❌ Failed to start: ${err.message}`);
    });

    child.on('exit', (code) => {
        console.log(`[${coin}] Process exited with code ${code}`);
    });

    console.log(`[MultiHybrid] Started hybrid trader for ${coin}`);
}

function shutdown() {
    console.log('\n[MultiHybrid] Shutting down all traders...');
    processes.forEach(({ coin, process }) => {
        console.log(`  Stopping ${coin}...`);
        process.kill('SIGINT');
    });
    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start all coins
COINS.forEach(coin => startHybridTrader(coin, 1000));

console.log('');
console.log('✅ All hybrid paper traders started!');
console.log('');
console.log('Press Ctrl+C to stop all traders');
console.log('');

// Keep process alive
setInterval(() => {}, 1000 * 60 * 60);
