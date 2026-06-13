const { spawn } = require('child_process');

const COINS = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP']; // Add/remove coins here
const CAPITAL_PER_COIN = 1000;

const activeProcesses = [];

function startHybridTrader(coin) {
    console.log(`[MultiHybrid] Starting hybrid trader for ${coin}...`);

    const child = spawn('node', [
        'hybrid-paper-trader.js',
        `--coin=${coin}`,
        `--capital=${CAPITAL_PER_COIN}`
    ], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
        process.stdout.write(`[${coin}] ${data}`);
    });

    child.stderr.on('data', (data) => {
        process.stderr.write(`[${coin} ERROR] ${data}`);
    });

    child.on('exit', (code) => {
        console.log(`[${coin}] Process exited with code ${code}`);
    });

    activeProcesses.push({ coin, process: child });
}

function shutdownAll() {
    console.log('\n[MultiHybrid] Shutting down all hybrid traders...');
    activeProcesses.forEach(({ coin, process }) => {
        if (!process.killed) {
            process.kill('SIGINT');
            console.log(`[MultiHybrid] Sent shutdown signal to ${coin}`);
        }
    });
    process.exit(0);
}

process.on('SIGINT', shutdownAll);
process.on('SIGTERM', shutdownAll);

// Start all coins
COINS.forEach(coin => startHybridTrader(coin));

// Keep the main process alive
setInterval(() => {}, 1000 * 60 * 60);
