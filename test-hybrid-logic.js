const HybridStrategy = require('./src/strategy/HybridStrategy');

// ==================== IMPROVED MOCK WAYFINDER ====================
class MockWayfinder {
    constructor() {
        this.orders = new Map();
        this.position = { side: null, size: 0, entryPrice: null, unrealizedPnlPct: 0 };
        this.margin = 10000;
        this.orderIdCounter = 1000;
    }

    async getAvailableMargin() {
        return this.margin;
    }

    async getPosition() {
        return this.position;
    }

    async getPositionSize() {
        return Math.abs(this.position.size || 0);
    }

    async getOpenOrders() {
        return Array.from(this.orders.values());
    }

    async placeLimitOrder({ coin, isBuy, size, price }) {
        const oid = `mock-${this.orderIdCounter++}`;
        const order = { oid, coin, isBuy, size, price, status: 'resting' };
        this.orders.set(oid, order);
        console.log(`[MOCK] Placed ${isBuy ? 'BUY' : 'SELL'} limit @ $${price.toFixed(2)} | size: ${size.toFixed(4)} | oid: ${oid}`);
        return { status: 'ok', effects: [{ ok: true, result: { response: { data: { statuses: [{ resting: { oid } }] } } } }] };
    }

    async cancelOrder(oid) {
        if (this.orders.has(oid)) {
            this.orders.delete(oid);
            console.log(`[MOCK] Cancelled order ${oid}`);
            return { status: 'ok' };
        }
        return { status: 'error', reason: 'Order not found' };
    }

    async placeOrder(params) {
        // Fallback for BBRSI
        return this.placeLimitOrder(params);
    }

    async closePosition(coin) {
        console.log(`[MOCK] Closed entire position on ${coin}`);
        this.position = { side: null, size: 0, entryPrice: null, unrealizedPnlPct: 0 };
        this.orders.clear();
        return { status: 'ok' };
    }
}

// ==================== STRONG REGIME DATA GENERATORS ====================
function generateTrendingOHLCV(length = 100, startPrice = 100) {
    const data = [];
    let price = startPrice;

    for (let i = 0; i < length; i++) {
        // Strong upward trend + small noise
        const trend = 0.85;
        const noise = (Math.random() - 0.5) * 0.6;
        price += trend + noise;

        const open = price;
        const high = price + 0.7 + Math.random() * 0.4;
        const low = price - 0.7 - Math.random() * 0.4;
        const close = price + (Math.random() - 0.5) * 0.4;

        data.push({
            t: Date.now() - (length - i) * 60000,
            o: Number(open.toFixed(4)),
            h: Number(high.toFixed(4)),
            l: Number(low.toFixed(4)),
            c: Number(close.toFixed(4)),
            v: 1200 + Math.floor(Math.random() * 800)
        });
    }
    return data;
}

function generateRangingOHLCV(length = 100, centerPrice = 100) {
    const data = [];
    let price = centerPrice;

    for (let i = 0; i < length; i++) {
        // Mean-reverting behavior (ranging)
        const pull = (centerPrice - price) * 0.15;
        const noise = (Math.random() - 0.5) * 1.2;
        price += pull + noise;

        const open = price;
        const high = price + 0.5 + Math.random() * 0.3;
        const low = price - 0.5 - Math.random() * 0.3;
        const close = price + (Math.random() - 0.5) * 0.25;

        data.push({
            t: Date.now() - (length - i) * 60000,
            o: Number(open.toFixed(4)),
            h: Number(high.toFixed(4)),
            l: Number(low.toFixed(4)),
            c: Number(close.toFixed(4)),
            v: 800 + Math.floor(Math.random() * 400)
        });
    }
    return data;
}

// ==================== TEST ====================
async function runTest() {
    const wayfinder = new MockWayfinder();
    const hybrid = new HybridStrategy(console, wayfinder);

    console.log('\n========================================');
    console.log('TEST 1: Strong TRENDING regime');
    console.log('========================================');
    let ohlcv = generateTrendingOHLCV(90);
    let result = await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length - 1].c);
    console.log('Result:', result);
    console.log('Status:', hybrid.getStatus('BTC'));

    console.log('\n========================================');
    console.log('TEST 2: Switch to RANGING regime');
    console.log('========================================');
    ohlcv = generateRangingOHLCV(90);
    result = await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length - 1].c, wayfinder.position);
    console.log('Result:', result);
    console.log('Status:', hybrid.getStatus('BTC'));

    console.log('\n========================================');
    console.log('TEST 3: Back to TRENDING');
    console.log('========================================');
    ohlcv = generateTrendingOHLCV(90);
    result = await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length - 1].c, wayfinder.position);
    console.log('Result:', result);
    console.log('Status:', hybrid.getStatus('BTC'));

    await hybrid.shutdown();
    console.log('\n✅ Strengthened test completed');
}

runTest().catch(console.error);
