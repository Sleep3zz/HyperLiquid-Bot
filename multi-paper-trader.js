#!/usr/bin/env node
/**
 * Multi-Coin Paper Trader
 * Runs paper trading for BTC, SOL, and HYPE with optimal parameters
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const COINS = ['BTC', 'SOL', 'HYPE'];
const DATA_DIR = path.join(__dirname, 'data', 'paper-trading');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     MULTI-COIN PAPER TRADER                                     ║');
console.log('║     BTC | SOL | HYPE                                            ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log('');

const processes = [];

COINS.forEach(coin => {
    console.log(`🚀 Starting paper trader for ${coin}...`);
    
    const proc = spawn('node', ['paper-trader.js', '--coin', coin, '--capital', '1000'], {
        cwd: __dirname,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    
    processes.push({ coin, proc });
    
    proc.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                console.log(`[${coin}] ${line}`);
            }
        });
    });
    
    proc.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                console.error(`[${coin}] ⚠️ ${line}`);
            }
        });
    });
    
    proc.on('error', (err) => {
        console.error(`[${coin}] ❌ Failed to start: ${err.message}`);
    });
    
    proc.on('exit', (code) => {
        console.log(`[${coin}] Process exited with code ${code}`);
    });
});

console.log('');
console.log('✅ All paper traders started!');
console.log('');
console.log('Dashboard: https://trading.s3zapp.us');
console.log('Password:  4EsJ9QU$7ATNWjm');
console.log('');
console.log('Press Ctrl+C to stop all traders');
console.log('');

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Stopping all paper traders...');
    processes.forEach(({ coin, proc }) => {
        console.log(`  Stopping ${coin}...`);
        proc.kill('SIGTERM');
    });
    setTimeout(() => process.exit(0), 1000);
});

process.on('SIGTERM', () => {
    processes.forEach(({ proc }) => proc.kill('SIGTERM'));
    setTimeout(() => process.exit(0), 1000);
});

// Keep process alive
setInterval(() => {}, 1000);
