const HybridStrategy = require('../../src/strategy/HybridStrategy');

class MockWayfinder {
    constructor() {
        this.positions = {};
        this.orders = [];
        this.closedPositions = [];
    }

    async getPrice(coin) {
        return 100 + Math.random() * 10;
    }

    async getPosition(coin) {
        return this.positions[coin] || { side: null, size: 0, entryPrice: null };
    }

    async placeOrder(params) {
        this.orders.push(params);
        return { status: 'ok' };
    }

    async closePosition(coin) {
        this.closedPositions.push(coin);
        this.positions[coin] = { side: null, size: 0, entryPrice: null };
        return { status: 'ok' };
    }

    // Simulate having an open position
    setPosition(coin, position) {
        this.positions[coin] = position;
    }
}

function generateTrendingData(length = 80) {
    const data = [];
    let price = 100;
    for (let i = 0; i < length; i++) {
        price += 1.1;
        data.push({
            t: Date.now() - (length - i) * 60000,
            o: price, h: price + 0.8, l: price - 0.8, c: price, v: 1500
        });
    }
    return data;
}

function generateRangingData(length = 150) {
    const data = [];
    let price = 100;
    for (let i = 0; i < length; i++) {
        price = 100 + Math.sin(i / 10) * 3 + (Math.random() - 0.5) * 1.5;
        data.push({
            t: Date.now() - (length - i) * 60000,
            o: price, h: price + 0.6, l: price - 0.6, c: price, v: 900
        });
    }
    return data;
}

async function runCriticalFixesTest() {
    const wayfinder = new MockWayfinder();
    const hybrid = new HybridStrategy(console, wayfinder, './state/test-critical', {}, {
        totalBudget: 10000,
        gridMaxAllocation: 0.6
    });

    console.log('\n=== TEST: GRID → BBRSI with position reconciliation ===');

    // Start in ranging → Grid should activate
    let ohlcv = generateRangingData(150);
    await hybrid.update('BTC', ohlcv, 100.5);

    // Simulate an open grid position
    wayfinder.setPosition('BTC', { side: 'LONG', size: 0.05, entryPrice: 99.8 });

    // Switch to trending
    ohlcv = generateTrendingData(80);
    const result = await hybrid.update('BTC', ohlcv, 108.3);

    console.log('Result after switch:', result);
    console.log('Orders placed:', wayfinder.orders.length);
    console.log('Closed positions:', wayfinder.closedPositions);

    // Check that stop-loss was placed
    const hasStopLoss = wayfinder.orders.some(o => o.reduceOnly === true);
    console.log('Stop-loss / TP placed?', hasStopLoss);

    const status = hybrid.getStatus('BTC');
    console.log('Final Status:', status);

    await hybrid.shutdown();
    console.log('\n✅ Critical fixes test completed');
}

runCriticalFixesTest().catch(console.error);
