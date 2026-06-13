/**
 * Multi-Coin Hybrid Paper Trader
 * 
 * Each coin runs in its own process for isolation.
 * This prevents issues with position tracking and allows
 * independent circuit breaker behavior per coin.
 */

const { spawn } = require('child_process');
const DataProvider = require('./src/data/data-provider');

const DATA_DIR = './data';
const dataProvider = new DataProvider(DATA_DIR);

const COINS = [
    { symbol: 'BTC-PERP', capital: 2000 },
    { symbol: 'ETH-PERP', capital: 1500 },
    { symbol: 'SOL-PERP', capital: 1000 }
];

// === Shared Configuration (applied to all coins) ===
const SHARED_CONFIG = {
    regimeConfig: {
        adxTrending: 26,
        adxRanging: 19,
        atrHighVolPercentile: 78,
        bbWidthHighVolPercentile: 72,
        bbWidthRangingPercentile: 28,
        lookback: 120
    },
    notifications: {
        enabled: true,
        email: 'alerts@yourdomain.com',
        from: 'trading@yourdomain.com',
        smtp: {
            host: 'smtp.yourdomain.com',
            port: 587,
            secure: false,
            auth: {
                user: 'trading@yourdomain.com',
                pass: 'your-app-password'
            }
        }
    }
};

const processes = [];

function startHybridTrader(coinConfig) {
    const { symbol, capital } = coinConfig;

    const args = [
        'hybrid-paper-trader.js',
        `--coin=${symbol}`,
        `--capital=${capital}`,
        `--data-dir=${DATA_DIR}`,
        `--regime-config=${JSON.stringify(SHARED_CONFIG.regimeConfig)}`,
        `--notifications=${JSON.stringify(SHARED_CONFIG.notifications)}`
    ];

    console.log(`[MultiHybrid] Starting ${symbol} with shared config...`);

    const child = spawn('node', args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
        process.stdout.write(`[${symbol}] ${data}`);
    });

    child.stderr.on('data', (data) => {
        process.stderr.write(`[${symbol} ERROR] ${data}`);
    });

    processes.push({ symbol, process: child });
}

function shutdown() {
    console.log('\n[MultiHybrid] Shutting down all traders...');
    processes.forEach(({ symbol, process }) => {
        if (!process.killed) process.kill('SIGINT');
    });
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

COINS.forEach(startHybridTrader);
setInterval(() => {}, 1000 * 60 * 60);
