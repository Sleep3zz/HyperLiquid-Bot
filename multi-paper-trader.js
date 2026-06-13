const { spawn } = require('child_process');
const DataProvider = require('./src/data/data-provider');

const COINS = [
    { symbol: 'BTC-PERP', capital: 2000 },
    { symbol: 'ETH-PERP', capital: 1500 },
    { symbol: 'SOL-PERP', capital: 1000 }
];

const dataProvider = new DataProvider('./data'); // Shared instance
const processes = [];

function startHybridTrader(coinConfig) {
    const { symbol, capital } = coinConfig;

    const child = spawn('node', [
        'hybrid-paper-trader.js',
        `--coin=${symbol}`,
        `--capital=${capital}`
    ], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            DATA_PROVIDER: 'shared' // Can be used inside hybrid-paper-trader if needed
        }
    });

    child.stdout.on('data', data => process.stdout.write(`[${symbol}] ${data}`));
    child.stderr.on('data', data => process.stderr.write(`[${symbol} ERROR] ${data}`));

    processes.push({ symbol, process: child });
}

function shutdown() {
    console.log('\n[MultiHybrid] Shutting down...');
    processes.forEach(p => p.process.kill('SIGINT'));
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

COINS.forEach(startHybridTrader);
setInterval(() => {}, 1000 * 60 * 60);
