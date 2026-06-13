const HybridStrategy = require('./src/strategy/HybridStrategy');
const RegimeDetector = require('./src/strategy/RegimeDetector');

// Debug patch
const originalDetect = RegimeDetector.prototype.detect;
RegimeDetector.prototype.detect = function(ohlcv) {
    const result = originalDetect.call(this, ohlcv);
    if (result.type !== 'UNKNOWN') {
        console.log(`[DEBUG] ${result.type} | ADX: ${result.adx?.toFixed(1)} | ATR%: ${result.atrPct?.toFixed(2)} | BBW: ${result.bbWidth?.toFixed(2)}`);
    }
    return result;
};

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
    async cancelOrder(oid) { this.orders.delete(oid); return { status: 'ok' }; }
    async closePosition(coin) {
        this.position = { side: null, size: 0, entryPrice: null, unrealizedPnlPct: 0 };
        this.orders.clear();
        return { status: 'ok' };
    }
}

// ==================== IMPROVED DATA GENERATORS ====================

// Strong trending data
function generateTrendingOHLCV(length = 120, startPrice = 100) {
    const data = [];
    let price = startPrice;
    for (let i = 0; i < length; i++) {
        price += 1.2 + (Math.random() - 0.5) * 0.5;
        data.push({
            t: Date.now() - (length - i) * 60000,
            o: Number(price.toFixed(4)),
            h: Number((price + 0.9).toFixed(4)),
            l: Number((price - 0.9).toFixed(4)),
            c: Number((price + (Math.random() - 0.5) * 0.4).toFixed(4)),
            v: 1500
        });
    }
    return data;
}

// Much stronger RANGING generator (choppy, low directional movement)
function generateRangingOHLCV(length = 150, centerPrice = 100) {
    const data = [];
    let price = centerPrice;

    for (let i = 0; i < length; i++) {
        // Strong mean reversion + high noise (this helps ADX decay)
        const meanReversion = (centerPrice - price) * 0.35;
        const noise = (Math.random() - 0.5) * 2.8;
        price += meanReversion + noise;

        // Add occasional small spikes to simulate chop
        if (Math.random() < 0.15) {
            price += (Math.random() - 0.5) * 3.5;
        }

        const open = price;
        const high = price + 0.7 + Math.random() * 0.6;
        const low = price - 0.7 - Math.random() * 0.6;
        const close = price + (Math.random() - 0.5) * 0.5;

        data.push({
            t: Date.now() - (length - i) * 60000,
            o: Number(open.toFixed(4)),
            h: Number(high.toFixed(4)),
            l: Number(low.toFixed(4)),
            c: Number(close.toFixed(4)),
            v: 900 + Math.floor(Math.random() * 300)
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
    await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length - 1].c);

    console.log('\n=== TEST 2: RANGING (longer run for ADX to decay) ===');
    ohlcv = generateRangingOHLCV(180); // More bars to let ADX drop
    await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length - 1].c, wayfinder.position);

    console.log('\n=== TEST 3: TRENDING again ===');
    ohlcv = generateTrendingOHLCV(120);
    await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length - 1].c, wayfinder.position);

    await hybrid.shutdown();
    console.log('\n✅ Test completed');
}

runTest().catch(console.error);
