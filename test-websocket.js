#!/usr/bin/env node
/**
 * Test Hyperliquid WebSocket Connection
 */

const HyperliquidWebSocketPriceFeed = require('./src/price-feeds/hyperliquid-ws');

console.log('Testing Hyperliquid WebSocket Connection...\n');

const feed = new HyperliquidWebSocketPriceFeed({
    logger: {
        info: (msg, ...args) => console.log('[INFO]', msg, ...args),
        error: (msg, ...args) => console.error('[ERROR]', msg, ...args),
        warn: (msg, ...args) => console.warn('[WARN]', msg, ...args)
    }
});

feed.on('connected', () => {
    console.log('\n✅ WebSocket Connected!');
    console.log('Subscribing to BTC and ETH...\n');
    
    feed.subscribe('BTC');
    feed.subscribe('ETH');
});

feed.on('price', ({ coin, price }) => {
    console.log(`📊 ${coin}: $${price}`);
});

feed.on('error', (error) => {
    console.error('\n❌ WebSocket Error:', error.message);
    process.exit(1);
});

feed.on('disconnected', () => {
    console.log('\n⚠️ WebSocket Disconnected');
});

console.log('Connecting to wss://api.hyperliquid.xyz/ws...');
feed.connect();

// Wait for prices
setTimeout(() => {
    const prices = feed.getAllPrices();
    console.log('\n📈 All Available Prices:', prices);
    
    const btcPrice = feed.getPrice('BTC');
    const ethPrice = feed.getPrice('ETH');
    
    if (btcPrice && ethPrice) {
        console.log('\n✅ SUCCESS: Real-time prices received');
        console.log(`   BTC: $${btcPrice}`);
        console.log(`   ETH: $${ethPrice}`);
    } else {
        console.log('\n❌ FAILED: Could not get real-time prices');
    }
    
    feed.disconnect();
    process.exit(0);
}, 10000);
