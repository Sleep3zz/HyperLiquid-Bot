#!/usr/bin/env node
/**
 * Test REST API Connection
 */

const WayfinderAdapterFinal = require('./src/wayfinder/adapter-final');

console.log('Testing Hyperliquid REST API Connection...\n');

const adapter = new WayfinderAdapterFinal({
    logger: {
        info: (msg, ...args) => console.log('[INFO]', msg, ...args),
        error: (msg, ...args) => console.error('[ERROR]', msg, ...args)
    }
});

async function test() {
    try {
        console.log('Testing connection...');
        const connected = await adapter.testConnection();
        
        if (!connected) {
            console.log('\n❌ FAILED: Could not connect to Hyperliquid API');
            process.exit(1);
        }
        
        console.log('\nFetching BTC and ETH prices...');
        const btc = await adapter.getPrice('BTC-PERP');
        const eth = await adapter.getPrice('ETH-PERP');
        
        console.log('\n✅ SUCCESS: Real-time prices received');
        console.log(`   BTC: $${btc}`);
        console.log(`   ETH: $${eth}`);
        
        console.log('\nStarting price polling (10 seconds)...');
        adapter.startPolling('BTC-PERP', (symbol, price) => {
            console.log(`📊 ${symbol}: $${price}`);
        });
        
        setTimeout(() => {
            console.log('\nStopping polling...');
            adapter.stopPolling('BTC-PERP');
            process.exit(0);
        }, 10000);
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        process.exit(1);
    }
}

test();
