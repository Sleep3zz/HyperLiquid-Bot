/**
 * GridStrategy Live Testnet Test
 * 
 * Prerequisites:
 * 1. Wayfinder CLI installed and authenticated
 * 2. Testnet wallet configured
 * 3. WAYFINDER_SDK_PATH env var set
 * 
 * Run with: node testnet-grid-live.js
 */

const GridStrategy = require('./src/strategy/GridStrategy');
const WayfinderCommander = require('./src/wayfinder/WayfinderCommander');

// Logger
const logger = {
    info: (msg, ...args) => console.log(`[${new Date().toISOString()}] [INFO]`, msg, ...args),
    warn: (msg, ...args) => console.log(`[${new Date().toISOString()}] [WARN]`, msg, ...args),
    error: (msg, ...args) => console.log(`[${new Date().toISOString()}] [ERROR]`, msg, ...args),
    debug: (msg, ...args) => console.log(`[${new Date().toISOString()}] [DEBUG]`, msg, ...args)
};

async function runLiveTestnetTest() {
    console.log('========================================');
    console.log(' GridStrategy Live Testnet Test');
    console.log('========================================\n');

    // Check environment
    if (!process.env.WAYFINDER_SDK_PATH) {
        console.error('ERROR: WAYFINDER_SDK_PATH not set');
        console.log('Set it with: export WAYFINDER_SDK_PATH=/path/to/wayfinder-sdk');
        process.exit(1);
    }

    // Create wayfinder instance
    const wayfinder = new WayfinderCommander({
        sdkPath: process.env.WAYFINDER_SDK_PATH,
        walletLabel: process.env.WAYFINDER_WALLET_LABEL || 'testnet',
        logger
    });

    // Test 1: Check connection
    console.log('Test 1: Checking connection...');
    const price = wayfinder.getPrice('BTC');
    if (!price) {
        console.error('ERROR: Cannot get BTC price. Check Wayfinder connection.');
        process.exit(1);
    }
    console.log(`✓ BTC price: $${price.toFixed(2)}`);

    // Test 2: Check account state
    console.log('\nTest 2: Checking account state...');
    const state = wayfinder.getAccountState();
    if (!state) {
        console.error('ERROR: Cannot get account state. Check wallet configuration.');
        process.exit(1);
    }
    console.log('✓ Account connected');
    console.log(`  Margin: $${state.margin_summary?.account_value || 'N/A'}`);

    // Test 3: Create grid with VERY small size
    console.log('\nTest 3: Starting grid (SMALL SIZE)...');
    const grid = new GridStrategy(logger, wayfinder, {
        coin: 'BTC',
        baseAmount: 10,        // $10 per level (VERY SMALL)
        gridLevels: 3,          // 3 levels only
        gridSpacingPct: 0.5,    // 0.5% spacing
        maxGridCapital: 100,    // $100 max
        debugMode: true,        // Enable debug logging
        verboseLogging: true
    });

    console.log('Grid config:');
    console.log(`  Coin: ${grid.coin}`);
    console.log(`  Base Amount: $${grid.baseAmount}`);
    console.log(`  Grid Levels: ${grid.gridLevels}`);
    console.log(`  Spacing: ${grid.gridSpacingPct}%`);
    console.log(`  Max Capital: $${grid.maxGridCapital}`);

    // Start the grid
    console.log('\nStarting grid...');
    const startResult = await grid.startGrid('BTC');
    console.log(`Result: ${startResult}`);

    if (!grid.active) {
        console.error('ERROR: Grid failed to start');
        process.exit(1);
    }

    console.log(`✓ Grid active with ${grid.gridOrders.size} orders`);
    console.log(`✓ Capital used: $${grid.getCurrentCapitalUsage().toFixed(2)}`);

    // Test 4: Run for a few update cycles
    console.log('\nTest 4: Running update cycles (15s each)...');
    for (let i = 0; i < 3; i++) {
        console.log(`\n--- Cycle ${i + 1}/3 ---`);
        const currentPrice = wayfinder.getPrice('BTC');
        console.log(`Current BTC price: $${currentPrice.toFixed(2)}`);
        
        await grid.update(currentPrice);
        
        const status = await grid.getStatus();
        console.log(`Open orders: ${status.openOrders}, Filled: ${status.filledOrders}, PnL: $${status.totalPnL.toFixed(2)}`);
        
        if (i < 2) {
            console.log('Waiting 15s...');
            await new Promise(r => setTimeout(r, 15000));
        }
    }

    // Test 5: Stop grid
    console.log('\nTest 5: Stopping grid...');
    await grid.stopGrid();
    
    if (grid.active) {
        console.error('ERROR: Grid did not stop properly');
    } else {
        console.log('✓ Grid stopped cleanly');
    }

    // Final status
    console.log('\n========================================');
    console.log(' Final Results');
    console.log('========================================');
    console.log(`Final PnL: $${grid.totalPnL.toFixed(2)}`);
    console.log(`Filled orders: ${grid.filledOrders.length}`);
    console.log(`Open orders remaining: ${grid.gridOrders.size}`);

    console.log('\n========================================');
    console.log(' Test Complete!');
    console.log('========================================');
    console.log('\nNext steps:');
    console.log('1. Check Hyperliquid testnet for any orphaned orders');
    console.log('2. Compare totalPnL with exchange realized PnL');
    console.log('3. Review logs for any warnings/errors');
}

// Handle Ctrl+C
process.on('SIGINT', async () => {
    console.log('\n\nInterrupted! Stopping grid...');
    process.exit(0);
});

runLiveTestnetTest().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
