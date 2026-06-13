const HybridStrategy = require('./src/strategy/HybridStrategy');

// ==================== MOCK WAYFINDER ====================
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
        console.log(`[MOCK] Placed ${isBuy ? 'BUY' : 'SELL'} limit @ $${price.toFixed(2)}`);
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

    async placeOrder(params) {
        return this.placeLimitOrder(params);
    }
}

// ==================== DATA GENERATORS ====================
function generateStrongTrending(length = 120, startPrice = 100) {
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

function generateStrongRanging(length = 200, center = 100) {
    const data = [];
    let price = center;
    for (let i = 0; i < length; i++) {
        const meanReversion = (center - price) * 0.35;
        const noise = (Math.random() - 0.5) * 2.8;
        price += meanReversion + noise;
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
async function testSwitching() {
    const wayfinder = new MockWayfinder();
    const hybrid = new HybridStrategy(
        console,
        wayfinder,
        './state/test',
        {}, // regimeConfig
        {
            totalBudget: 10000,
            gridAllocation: 0.6,   // $6000 max for Grid
            bbrsiAllocation: 0.8   // $8000 max for BBRSI
        }
    );

    console.log('\n========================================');
    console.log('TEST: TRENDING → RANGING → TRENDING');
    console.log('========================================');

    // Test 1: Start in trending
    console.log('\n--- TEST 1: Strong TRENDING ---');
    let ohlcv = generateStrongTrending(120);
    let result = await hybrid.update('BTC', ohlcv, 105.5);
    console.log('Result:', {
        regime: result.regime,
        strategy: result.strategy,
        action: result.action,
        thresholds: result.thresholds
    });

    // Test 2: Switch to ranging
    console.log('\n--- TEST 2: Switch to RANGING ---');
    ohlcv = generateStrongRanging(200);
    result = await hybrid.update('BTC', ohlcv, 100.2);
    console.log('Result:', {
        regime: result.regime,
        strategy: result.strategy,
        action: result.action,
        thresholds: result.thresholds
    });

    // Test 3: Stay in ranging (build confirmation)
    console.log('\n--- TEST 3: Confirm RANGING ---');
    ohlcv = generateStrongRanging(200);
    result = await hybrid.update('BTC', ohlcv, 101.5);
    console.log('Result:', {
        regime: result.regime,
        strategy: result.strategy,
        action: result.action
    });

    // Test 4: Switch back to trending
    console.log('\n--- TEST 4: Back to TRENDING ---');
    ohlcv = generateStrongTrending(120);
    result = await hybrid.update('BTC', ohlcv, 108.7);
    console.log('Result:', {
        regime: result.regime,
        strategy: result.strategy,
        action: result.action,
        thresholds: result.thresholds
    });

    console.log('\n========================================');
    console.log('Final Status:', hybrid.getStatus('BTC'));
    console.log('Capital Allocation:', hybrid.currentAllocatedCapital);
    console.log('========================================');

    await hybrid.shutdown();
    console.log('\n✅ Switching test completed');
}

testSwitching().catch(console.error);
