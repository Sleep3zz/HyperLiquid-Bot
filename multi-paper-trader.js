const { spawn } = require('child_process');
const DataProvider = require('./src/data/data-provider');

// === Shared DataProvider Configuration ===
const DATA_DIR = './data'; // Single source of truth
const dataProvider = new DataProvider(DATA_DIR);

const COINS = [
    { symbol: 'BTC-PERP', capital: 2000 },
    { symbol: 'ETH-PERP', capital: 1500 },
    { symbol: 'SOL-PERP', capital: 1000 }
];

const processes = [];

function startHybridTrader(coinConfig) {
    const { symbol, capital } = coinConfig;

    console.log(`[MultiHybrid] Starting hybrid trader for ${symbol}...`);

    const child = spawn('node', [
        'hybrid-paper-trader.js',
        `--coin=${symbol}`,
        `--capital=${capital}`,
        `--data-dir=${DATA_DIR}` // ← Pass shared data directory
    ], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
        process.stdout.write(`[${symbol}] ${data}`);
    });

    child.stderr.on('data', (data) => {
        process.stderr.write(`[${symbol} ERROR] ${data}`);
    });

    child.on('exit', (code) => {
        console.log(`[${symbol}] Process exited with code ${code}`);
    });

    processes.push({ symbol, process: child });
}

function shutdown() {
    console.log('\n[MultiHybrid] Shutting down all hybrid traders...');
    processes.forEach(({ symbol, process }) => {
        if (!process.killed) {
            process.kill('SIGINT');
        }
    });
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start all coins
COINS.forEach(startHybridTrader);

// Keep main process alive
setInterval(() => {}, 1000 * 60 * 60);
