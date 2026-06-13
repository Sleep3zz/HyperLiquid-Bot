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
function generateTrendingData(length = 120, startPrice = 100) {
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

function generateRangingData(length = 200, center = 100) {
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
async function runSwitchingTests() {
    const wayfinder = new MockWayfinder();
    const hybrid = new HybridStrategy(
        console,
        wayfinder,
        './state/test',
        {}, // regimeConfig
        {
            totalBudget: 10000,
            gridMaxAllocation: 0.6,
            bbrsiMaxAllocation: 0.8
        }
    );

    console.log('\n========================================');
    console.log('TEST 1: TRENDING → RANGING (with cooldown)');
    console.log('========================================');
    
    // Start in trending
    let ohlcv = generateTrendingData(120);
    await hybrid.update('BTC', ohlcv, 105);
    
    // Switch to ranging
    ohlcv = generateRangingData(200);
    let result = await hybrid.update('BTC', ohlcv, 100.5);
    console.log('Result:', {
        regime: result.regime,
        strategy: result.strategy,
        action: result.action,
        thresholds: result.thresholds
    });
    console.log('Capital Status:', hybrid.getCapitalStatus());
    console.log('Grid Status:', hybrid.getStatus('BTC'));

    console.log('\n========================================');
    console.log('TEST 2: RANGING → TRENDING (pauseAggressiveRisk test)');
    console.log('========================================');
    
    ohlcv = generateTrendingData(120);
    result = await hybrid.update('BTC', ohlcv, 108.2);
    console.log('Result:', {
        regime: result.regime,
        strategy: result.strategy,
        action: result.action,
        pauseAggressiveRisk: hybrid.getStatus('BTC')?.pauseAggressiveRisk
    });
    console.log('Status:', hybrid.getStatus('BTC'));

    console.log('\n========================================');
    console.log('TEST 3: Force switch during cooldown');
    console.log('========================================');
    
    await hybrid.forceStrategy('BTC', 'GRID');
    console.log('After force:', hybrid.getStatus('BTC'));
    console.log('Capital Status:', hybrid.getCapitalStatus());

    console.log('\n========================================');
    console.log('Final Summary');
    console.log('========================================');
    console.log('Capital Status:', hybrid.getCapitalStatus());
    console.log('Grid Status:', hybrid.getStatus('BTC'));

    await hybrid.shutdown();
    console.log('\n✅ All switching path tests completed');
}

runSwitchingTests().catch(console.error);
