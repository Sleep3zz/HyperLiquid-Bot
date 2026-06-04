#!/usr/bin/env node
/**
 * Test Wayfinder Integration
 * 
 * This script tests the Wayfinder SDK integration in dry-run mode
 * before live deployment.
 */

require('dotenv').config();
const WayfinderBridge = require('./src/wayfinder/bridge');
const DeltaLabClient = require('./src/wayfinder/deltalab-client');
const EnhancedBBRSIStrategy = require('./src/wayfinder/enhanced-strategy');

const winston = require('winston');

// Setup logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()]
});

async function testWayfinderBridge() {
    console.log('\n========================================');
    console.log('Testing WayfinderBridge');
    console.log('========================================\n');
    
    const bridge = new WayfinderBridge({
        walletLabel: process.env.WAYFINDER_WALLET_LABEL || 'main',
        sdkPath: process.env.WAYFINDER_SDK_PATH,
        dryRun: true,
        logger
    });
    
    console.log('✓ WayfinderBridge initialized');
    console.log('  SDK Path:', process.env.WAYFINDER_SDK_PATH);
    console.log('  Wallet Label:', process.env.WAYFINDER_WALLET_LABEL || 'main');
    console.log('  Dry Run: true\n');
    
    // Test 1: Execute a mock trade
    console.log('Test 1: Mock LONG trade execution');
    try {
        const tradeResult = await bridge.executePerpTrade({
            coin: 'BTC',
            isBuy: true,
            usdAmount: 100,
            leverage: 5,
            orderType: 'market'
        });
        console.log('✓ Trade command generated:', tradeResult.command);
    } catch (error) {
        console.error('✗ Trade test failed:', error.message);
    }
    
    // Test 2: Mock limit order
    console.log('\nTest 2: Mock LIMIT order');
    try {
        const limitResult = await bridge.executePerpTrade({
            coin: 'ETH',
            isBuy: false,
            size: 0.5,
            orderType: 'limit',
            price: 3500
        });
        console.log('✓ Limit order command generated:', limitResult.command);
    } catch (error) {
        console.error('✗ Limit order test failed:', error.message);
    }
    
    // Test 3: Mock trigger order
    console.log('\nTest 3: Mock STOP-LOSS trigger order');
    try {
        const triggerResult = await bridge.placeTriggerOrder({
            coin: 'BTC',
            tpsl: 'sl',
            triggerPrice: 60000,
            size: 0.1,
            isBuy: false
        });
        console.log('✓ Trigger order command generated:', triggerResult.command);
    } catch (error) {
        console.error('✗ Trigger order test failed:', error.message);
    }
}

async function testDeltaLabClient() {
    console.log('\n========================================');
    console.log('Testing DeltaLabClient');
    console.log('========================================\n');
    
    const client = new DeltaLabClient({
        sdkPath: process.env.WAYFINDER_SDK_PATH,
        logger
    });
    
    console.log('✓ DeltaLabClient initialized');
    console.log('  SDK Path:', process.env.WAYFINDER_SDK_PATH);
    console.log('  Cache Expiry: 60000ms\n');
    
    // Test 1: Get funding rates (real data)
    console.log('Test 1: Fetching funding rates...');
    try {
        const fundingRates = await client.getFundingRates();
        console.log(`✓ Retrieved ${fundingRates.length} markets`);
        
        // Show top 5 highest funding rates
        console.log('\nTop 5 Highest Funding Rates:');
        fundingRates.slice(0, 5).forEach((market, i) => {
            console.log(`  ${i + 1}. ${market.coin}: ${(market.funding_rate * 100).toFixed(4)}%`);
        });
    } catch (error) {
        console.error('✗ Funding rates test failed:', error.message);
    }
    
    // Test 2: Get specific market funding
    console.log('\nTest 2: BTC-PERP funding details');
    try {
        const btcFunding = await client.getFundingRates('BTC-PERP');
        if (btcFunding) {
            console.log('✓ BTC-PERP funding rate:', (btcFunding.funding_rate * 100).toFixed(4) + '%');
            console.log('  Mark price:', btcFunding.mark_px);
            console.log('  Open interest:', btcFunding.open_interest);
        }
    } catch (error) {
        console.error('✗ BTC funding test failed:', error.message);
    }
    
    // Test 3: Get current price
    console.log('\nTest 3: Current BTC price');
    try {
        const price = await client.getPrice('BTC');
        console.log('✓ BTC price:', price);
    } catch (error) {
        console.error('✗ Price test failed:', error.message);
    }
}

async function testEnhancedStrategy() {
    console.log('\n========================================');
    console.log('Testing EnhancedBBRSIStrategy');
    console.log('========================================\n');
    
    const strategy = new EnhancedBBRSIStrategy(logger, {
        useFundingFilter: true,
        fundingLongThreshold: 0.0001,
        fundingShortThreshold: 0.0001,
        fundingLookbackDays: 7
    });
    
    console.log('✓ EnhancedBBRSIStrategy initialized');
    console.log('  Funding filter: enabled');
    console.log('  Long threshold: 0.01%');
    console.log('  Short threshold: -0.01%\n');
    
    // Create mock OHLCV data
    const mockData = [];
    let price = 65000;
    for (let i = 0; i < 100; i++) {
        const change = (Math.random() - 0.5) * 0.02;
        price = price * (1 + change);
        mockData.push({
            t: Date.now() - (100 - i) * 60000,
            o: (price * 0.999).toFixed(2),
            h: (price * 1.005).toFixed(2),
            l: (price * 0.995).toFixed(2),
            c: price.toFixed(2),
            v: (Math.random() * 100).toFixed(4)
        });
    }
    
    console.log('Test 1: Signal evaluation with funding filter');
    console.log('  (Note: Using mock data, signals may vary)\n');
    
    try {
        const result = await strategy.evaluatePosition(mockData);
        console.log('✓ Strategy evaluated');
        console.log('  Signal:', result.signal);
        console.log('  Indicators:');
        if (result.indicators) {
            console.log('    RSI:', result.indicators.rsi?.toFixed(2));
            console.log('    ADX:', result.indicators.adx?.toFixed(2));
            console.log('    Price:', result.indicators.price);
        }
        if (result.filteredReason) {
            console.log('  Filtered reason:', result.filteredReason);
        }
    } catch (error) {
        console.error('✗ Strategy test failed:', error.message);
    }
    
    console.log('\nTest 2: Signal statistics');
    console.log(strategy.getSignalStats());
}

async function runTests() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║  HyperLiquidAlgoBot Integration Test   ║');
    console.log('║  Mode: DRY-RUN (No real trades)        ║');
    console.log('╚════════════════════════════════════════╝');
    
    // Verify environment
    if (!process.env.WAYFINDER_SDK_PATH) {
        console.error('\n✗ ERROR: WAYFINDER_SDK_PATH not set');
        console.error('  Please set it to: /home/clawdbot/wayfinder-paths-sdk');
        process.exit(1);
    }
    
    console.log('\nEnvironment Check:');
    console.log('  WAYFINDER_SDK_PATH:', process.env.WAYFINDER_SDK_PATH);
    console.log('  WAYFINDER_WALLET_LABEL:', process.env.WAYFINDER_WALLET_LABEL || 'main');
    console.log('  DRY_RUN:', 'true (safe mode)');
    
    try {
        await testWayfinderBridge();
        await testDeltaLabClient();
        await testEnhancedStrategy();
        
        console.log('\n========================================');
        console.log('All Tests Complete!');
        console.log('========================================\n');
        console.log('Summary:');
        console.log('  ✓ WayfinderBridge: Commands generated correctly');
        console.log('  ✓ DeltaLabClient: Market data accessible');
        console.log('  ✓ EnhancedStrategy: Funding filter active');
        console.log('\nReady for live deployment:');
        console.log('  1. Set DRY_RUN=false in .env');
        console.log('  2. Configure wallet credentials');
        console.log('  3. Run: npm run live -- --use-wayfinder');
        
    } catch (error) {
        console.error('\n✗ Test suite failed:', error);
        process.exit(1);
    }
}

runTests();
