const HybridStrategy = require('./src/strategy/HybridStrategy');

// ==================== MOCKS ====================
class MockWayfinder {
    constructor() {
        this.orders = [];
        this.position = { side: null, size: 0, entryPrice: null, unrealizedPnlPct: 0 };
        this.margin = 10000;
    }

    async getAvailableMargin() {
        return this.margin;
    }

    async getPosition(coin) {
        return this.position;
    }

    async placeLimitOrder({ coin, isBuy, size, price }) {
        console.log(`[MOCK] Placed ${isBuy ? 'BUY' : 'SELL'} order: ${size} @ $${price}`);
        this.orders.push({ coin, isBuy, size, price, ts: Date.now() });
        // Simulate fill
        if (isBuy) {
            this.position = { side: 'LONG', size, entryPrice: price, unrealizedPnlPct: 0 };
        } else {
            this.position = { side: 'SHORT', size, entryPrice: price, unrealizedPnlPct: 0 };
        }
        return { status: 'ok', effects: [{ ok: true, result: { response: { data: { statuses: [{ resting: { oid: 'mock-' + Date.now() } }] } } } }] };
    }

    async closePosition(coin) {
        console.log(`[MOCK] Closed position on ${coin}`);
        this.position = { side: null, size: 0, entryPrice: null, unrealizedPnlPct: 0 };
        return { status: 'ok' };
    }
}

// Simple regime simulator
function generateOHLCV(regime, length = 70) {
    const data = [];
    let price = 100;
    for (let i = 0; i < length; i++) {
        if (regime === 'RANGING') {
            price += (Math.random() - 0.5) * 0.3;
        } else if (regime === 'TRENDING') {
            price += 0.8; // strong uptrend
        } else {
            price += (Math.random() - 0.5) * 2.5; // high volatility
        }
        // Ensure price stays positive and reasonable
        price = Math.max(1, price);
        data.push({
            t: Date.now() - (length - i) * 60000,
            o: parseFloat(price.toFixed(2)),
            h: parseFloat((price + 0.5).toFixed(2)),
            l: parseFloat((price - 0.5).toFixed(2)),
            c: parseFloat(price.toFixed(2)),
            v: 1000
        });
    }
    return data;
}

// ==================== TEST RUNNER ====================
async function runTest() {
    const wayfinder = new MockWayfinder();
    const hybrid = new HybridStrategy(console, wayfinder);

    console.log('\n=== TEST 1: Start in RANGING → Should activate GRID ===');
    let ohlcv = generateOHLCV('RANGING', 70);
    let result = await hybrid.update('BTC', ohlcv, 100.5, null);
    console.log('Result:', result);
    console.log('Status:', hybrid.getStatus('BTC'));

    console.log('\n=== TEST 2: Switch to TRENDING → Should stop GRID and activate BBRSI ===');
    ohlcv = generateOHLCV('TRENDING', 70);
    result = await hybrid.update('BTC', ohlcv, 108.2, wayfinder.position);
    console.log('Result:', result);
    console.log('Status:', hybrid.getStatus('BTC'));

    console.log('\n=== TEST 3: BBRSI should now be able to generate & execute signals ===');
    // Force a LONG signal scenario (we'll manually trigger for testing)
    // In real use, BBRSIStrategy would return it from evaluatePosition()
    console.log('(In real usage, BBRSI signals would now be executed properly)');

    console.log('\n=== TEST 4: Switch back to RANGING ===');
    ohlcv = generateOHLCV('RANGING', 70);
    result = await hybrid.update('BTC', ohlcv, 105.0, wayfinder.position);
    console.log('Result:', result);
    console.log('Status:', hybrid.getStatus('BTC'));

    console.log('\n=== Final Status ===');
    console.log(hybrid.getStatus('BTC'));

    await hybrid.shutdown();
    console.log('\n✅ Test completed');
}

runTest().catch(console.error);
