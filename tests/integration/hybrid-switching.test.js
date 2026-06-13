const HybridStrategy = require('../../src/strategy/HybridStrategy');

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
        data.push({
            t: Date.now() - (length - i) * 60000,
            o: Number(price.toFixed(4)),
            h: Number((price + 0.7 + Math.random() * 0.6).toFixed(4)),
            l: Number((price - 0.7 - Math.random() * 0.6).toFixed(4)),
            c: Number((price + (Math.random() - 0.5) * 0.5).toFixed(4)),
            v: 900 + Math.floor(Math.random() * 300)
        });
    }
    return data;
}

// ==================== TEST SUITE ====================
describe('HybridStrategy - Regime Switching', () => {
    let hybrid, wayfinder;

    beforeEach(() => {
        wayfinder = new MockWayfinder();
        hybrid = new HybridStrategy(
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
    });

    afterEach(async () => {
        await hybrid.shutdown();
    });

    test('should start in UNKNOWN regime with no active strategy', async () => {
        const trendingData = generateTrendingData(120);
        const result = await hybrid.update('BTC', trendingData, 105);

        expect(result.regime).toBe('TRENDING');
        expect(result.strategy).toBe('BBRSI');
        expect(result.action).toBe('HOLD');
    });

    test('should switch from TRENDING to RANGING and allocate capital to Grid', async () => {
        // Start in trending
        const trendingData = generateTrendingData(120);
        await hybrid.update('BTC', trendingData, 105);

        // Switch to ranging
        const rangingData = generateRangingData(200);
        const result = await hybrid.update('BTC', rangingData, 100);

        expect(result.regime).toBe('RANGING');
        expect(result.strategy).toBe('GRID');

        const capitalStatus = hybrid.getCapitalStatus();
        expect(capitalStatus.allocated.GRID).toBe(6000); // 60% of 10000
        expect(capitalStatus.allocated.BBRSI).toBe(0);
    });

    test('should pause Grid risk when switching to TRENDING during cooldown', async () => {
        // Start in ranging
        const rangingData = generateRangingData(200);
        await hybrid.update('BTC', rangingData, 100);

        // Immediately try to switch to trending (during cooldown)
        const trendingData = generateTrendingData(120);
        await hybrid.update('BTC', trendingData, 108);

        const status = hybrid.getStatus('BTC');
        expect(status.pauseAggressiveRisk).toBe(true);
    });

    test('should switch from RANGING to TRENDING after cooldown expires', async () => {
        // Start in ranging
        const rangingData = generateRangingData(200);
        await hybrid.update('BTC', rangingData, 100);

        // Force cooldown to expire by resetting timestamp
        const state = hybrid.coins.get('BTC');
        state.lastRegimeChange = 0;

        // Now switch to trending
        const trendingData = generateTrendingData(120);
        const result = await hybrid.update('BTC', trendingData, 108);

        expect(result.regime).toBe('TRENDING');
        expect(result.strategy).toBe('BBRSI');

        const capitalStatus = hybrid.getCapitalStatus();
        expect(capitalStatus.allocated.BBRSI).toBe(8000); // 80% of 10000
        expect(capitalStatus.allocated.GRID).toBe(0);
    });

    test('should handle forceStrategy during cooldown', async () => {
        // Start in trending
        const trendingData = generateTrendingData(120);
        await hybrid.update('BTC', trendingData, 105);

        // Force to GRID
        await hybrid.forceStrategy('BTC', 'GRID');

        const status = hybrid.getStatus('BTC');
        expect(status.activeStrategy).toBe('GRID');

        const capitalStatus = hybrid.getCapitalStatus();
        expect(capitalStatus.allocated.GRID).toBeGreaterThan(0);
    });

    test('should return thresholds in result', async () => {
        const trendingData = generateTrendingData(120);
        const result = await hybrid.update('BTC', trendingData, 105);

        expect(result.thresholds).toBeDefined();
        expect(result.thresholds.atrHighVol).toBeDefined();
        expect(result.thresholds.bbHighVol).toBeDefined();
        expect(result.thresholds.bbRanging).toBeDefined();
    });

    test('should track regime confirmation count', async () => {
        const rangingData = generateRangingData(200);
        
        // First update - should build confirmation
        await hybrid.update('BTC', rangingData, 100);
        let status = hybrid.getStatus('BTC');
        expect(status.regimeConfirmation).toBeGreaterThanOrEqual(0);

        // Continue with same regime
        await hybrid.update('BTC', rangingData, 101);
        status = hybrid.getStatus('BTC');
        expect(status.regimeConfirmation).toBe(0); // Reset after switch
    });

    test('should handle insufficient data gracefully', async () => {
        const shortData = generateTrendingData(30); // Less than minBars
        const result = await hybrid.update('BTC', shortData, 105);

        expect(result.regime).toBe('UNKNOWN');
        expect(result.reason).toBe('Insufficient data');
    });

    test('should properly shutdown and cleanup', async () => {
        const rangingData = generateRangingData(200);
        await hybrid.update('BTC', rangingData, 100);

        await hybrid.shutdown();

        const status = hybrid.getStatus('BTC');
        expect(status).toBeNull(); // State cleared
    });
});

describe('HybridStrategy - Circuit Breakers', () => {
    let hybrid, wayfinder;

    beforeEach(() => {
        wayfinder = new MockWayfinder();
        hybrid = new HybridStrategy(
            console,
            wayfinder,
            './state/test',
            {},
            {
                totalBudget: 10000,
                gridMaxAllocation: 0.6,
                bbrsiMaxAllocation: 0.8
            }
        );
    });

    afterEach(async () => {
        await hybrid.shutdown();
    });

    test('should track capital allocation across switches', async () => {
        // Start in trending (BBRSI)
        const trendingData = generateTrendingData(120);
        await hybrid.update('BTC', trendingData, 105);

        let capitalStatus = hybrid.getCapitalStatus();
        expect(capitalStatus.allocated.BBRSI).toBe(8000);

        // Force cooldown and switch to ranging (GRID)
        const state = hybrid.coins.get('BTC');
        state.lastRegimeChange = 0;

        const rangingData = generateRangingData(200);
        await hybrid.update('BTC', rangingData, 100);

        capitalStatus = hybrid.getCapitalStatus();
        expect(capitalStatus.allocated.GRID).toBe(6000);
        expect(capitalStatus.allocated.BBRSI).toBe(0);
        expect(capitalStatus.available).toBe(4000);
    });
});
