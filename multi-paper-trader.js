const { spawn } = require('child_process');

const COINS = [
    { symbol: 'BTC-PERP', capital: 2000 },
    { symbol: 'ETH-PERP', capital: 1500 },
    { symbol: 'SOL-PERP', capital: 1000 }
];

const processes = [];

function startCoin(coinConfig) {
    const { symbol, capital } = coinConfig;

    const child = spawn('node', [
        'hybrid-paper-trader.js',
        `--coin=${symbol}`,
        `--capital=${capital}`
    ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', data => process.stdout.write(`[${symbol}] ${data}`));
    child.stderr.on('data', data => process.stderr.write(`[${symbol} ERROR] ${data}`));

    processes.push({ symbol, process: child });
    console.log(`[MultiHybrid] Launched hybrid trader for ${symbol}`);
}

function shutdown() {
    console.log('\n[MultiHybrid] Shutting down all traders...');
    processes.forEach(p => p.process.kill('SIGINT'));
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

COINS.forEach(startCoin);
setInterval(() => {}, 1000 * 60 * 60); // keep alive
