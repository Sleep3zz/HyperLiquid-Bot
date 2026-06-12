const HybridStrategy = require('./src/strategy/HybridStrategy');

// ==================== IMPROVED MOCK ====================
class MockWayfinder {
    constructor() {
        this.position = { side: null, size: 0, entryPrice: null, unrealizedPnlPct: 0 };
        this.margin = 10000;
    }

    async getAvailableMargin() { return this.margin; }
    async getPosition() { return this.position; }

    async placeOrder({ coin, isBuy, size, price }) {
        console.log(`[MOCK] ${isBuy ? 'BUY' : 'SELL'} ${size.toFixed(4)} @ $${price.toFixed(2)}`);
        this.position = { side: isBuy ? 'LONG' : 'SHORT', size, entryPrice: price, unrealizedPnlPct: 0 };
        return { status: 'ok' };
    }

    async closePosition(coin) {
        console.log(`[MOCK] Closed position on ${coin}`);
        this.position = { side: null, size: 0, entryPrice: null, unrealizedPnlPct: 0 };
        return { status: 'ok' };
    }
}

// Better mock data generator (avoids big.js issues)
function generateOHLCV(regime, length = 80) {
    const data = [];
    let price = 100.0;

    for (let i = 0; i < length; i++) {
        let change = 0;

        if (regime === 'RANGING') {
            change = (Math.random() - 0.5) * 0.4;
        } else if (regime === 'TRENDING') {
            change = 0.6 + (Math.random() - 0.5) * 0.3; // steady uptrend
        } else {
            change = (Math.random() - 0.5) * 3.5; // high volatility
        }

        price = Math.max(50, price + change); // prevent negative prices

        const open = price;
        const high = price + Math.random() * 0.8;
        const low = price - Math.random() * 0.8;
        const close = price + (Math.random() - 0.5) * 0.3;

        data.push({
            t: Date.now() - (length - i) * 60000,
            o: Number(open.toFixed(4)),
            h: Number(high.toFixed(4)),
            l: Number(low.toFixed(4)),
            c: Number(close.toFixed(4)),
            v: 1000 + Math.floor(Math.random() * 500)
        });
    }
    return data;
}

// ==================== TEST ====================
async function runTest() {
    const wayfinder = new MockWayfinder();
    const hybrid = new HybridStrategy(console, wayfinder);

    console.log('\n=== TEST 1: RANGING regime ===');
    let ohlcv = generateOHLCV('RANGING', 80);
    let result = await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length-1].c);
    console.log('Result:', result);
    console.log('Status:', hybrid.getStatus('BTC'));

    console.log('\n=== TEST 2: TRENDING regime ===');
    ohlcv = generateOHLCV('TRENDING', 80);
    result = await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length-1].c, wayfinder.position);
    console.log('Result:', result);
    console.log('Status:', hybrid.getStatus('BTC'));

    console.log('\n=== TEST 3: Back to RANGING ===');
    ohlcv = generateOHLCV('RANGING', 80);
    result = await hybrid.update('BTC', ohlcv, ohlcv[ohlcv.length-1].c, wayfinder.position);
    console.log('Result:', result);
    console.log('Status:', hybrid.getStatus('BTC'));

    await hybrid.shutdown();
    console.log('\n✅ Test finished');
}

runTest().catch(console.error);
