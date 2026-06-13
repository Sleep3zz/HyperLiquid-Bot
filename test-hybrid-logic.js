const HybridStrategy = require('./src/strategy/HybridStrategy');
const RegimeDetector = require('./src/strategy/RegimeDetector');

// Patch RegimeDetector temporarily for debugging
const originalDetect = RegimeDetector.prototype.detect;
RegimeDetector.prototype.detect = function(ohlcv) {
    const result = originalDetect.call(this, ohlcv);
    
    if (result.type !== 'UNKNOWN') {
        console.log(`[DEBUG] Regime: ${result.type} | ADX: ${result.adx?.toFixed(1)} | ATR%: ${result.atrPct?.toFixed(2)} | BB Width: ${result.bbWidth?.toFixed(2)} | Confidence: ${result.confidence}`);
    }
    return result;
};

// ==================== MOCK WAYFINDER (same as last version) ====================
class MockWayfinder {
    constructor() {
        this.orders = new Map();
        this.position = { side: null, size: 0, entryPrice: null, unrealizedPnlPct: 0 };
        this.margin = 10000;
        this.orderIdCounter = 1000;
    }

    async getAvailableMargin() { return this.margin; }
    async getPosition() { return this.position; }
    async getPositionSize() { return Math.abs(this.position.size || 0); }
    async getOpenOrders() { return Array.from(this.orders.values()); }

    async placeLimitOrder({ coin, isBuy, size, price }) {
        const oid = `mock-${this.orderIdCounter++}`;
        this.orders.set(oid, { oid, coin, isBuy, size, price, status: 'resting' });
        console.log(`[MOCK] Placed ${isBuy ? 'BUY' : 'SELL'} @ $${price.toFixed(2)}`);
        return { status: 'ok', effects: [{ ok: true, result: { response: { data: { statuses: [{ resting: { oid } }] } } } }] };
    }

    async cancelOrder(oid) {
        this.orders.delete(oid);
        return { status: 'ok' };
    }

    async closePosition(coin) {
        this.position = { side: null, size: 0, entryPrice: null, unrealizedPnlPct: 0 };
        this.orders.clear();
        return { status: 'ok' };
    }
}

// ==================== DATA GENERATORS ====================
function generateTrendingOHLCV(length = 120, startPrice = 100) {
    const data = [];
    let price = startPrice;
    for (let i = 0; i < length; i++) {
        price += 1.1 + (Math.random() - 0.5) * 0.4; // Stronger trend
        data.push({
            t: Date.now() - (length - i) * 60000,
            o: Number(price.toFixed(4)),
            h: Number((price + 0.8).toFixed(4)),
            l: Number((price - 0.8).toFixed(4)),
            c: Number((price + (Math.random() - 0.5) * 0.3).toFixed(4)),
            v: 1500
        });
    }
    return data;
}

function generateRangingOHLCV(length = 120, center = 100) {
    const data = [];
    let price = center;
    for (let i = 0; i < length; i++) {
        price = center + Math.sin(i / 8) * 2.5 + (Math.random() - 0.5) * 0.8;
        data.push({
            t: Date.now() - (length - i) * 60000,
            o: Number(price.toFixed(4)),
            h: Number((price + 0.6).toFixed(4)),
            l: Number((price - 0.6).toFixed(4)),
            c: Number((price + (Math.random() - 0.5) * 0.3).toFixed(4)),
            v: 900
        });
    }
    return data;
}

// ==================== TEST ====================
async function runTest() {
    const wayfinder = new MockWayfinder();
    const hybrid = new HybridStrategy(console, wayfinder);

    console.log('\n=== TEST 1: Strong TRENDING ===');
    let ohlcv = generateTrendingOHLCV(120);
    await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length-1].c);

    console.log('\n=== TEST 2: RANGING ===');
    ohlcv = generateRangingOHLCV(120);
    await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length-1].c, wayfinder.position);

    console.log('\n=== TEST 3: TRENDING again ===');
    ohlcv = generateTrendingOHLCV(120);
    await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length-1].c, wayfinder.position);

    await hybrid.shutdown();
    console.log('\n✅ Debug test completed');
}

runTest().catch(console.error);
