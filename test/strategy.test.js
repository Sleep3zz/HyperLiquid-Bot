const assert = require("assert");
const BBRSIStrategy = require("../src/strategy/BBRSIStrategy");

function makeStrategy(overrides = {}) {
    const s = Object.create(BBRSIStrategy.prototype);
    Object.assign(s, {
        logger: { info() {}, error() {}, warn() {} },
        stopLossPercent: 1.5,
        profitTarget: 2.0,
        riskPerTrade: 1.0,
        maxLeverage: 5,
        assetMaxLeverage: 5,
        takerFeeRate: 0.00045,
        liqSafetyBuffer: 0.005,
        mode: "reversion",
    }, overrides);
    return s;
}

let passed = 0, failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (e) {
        console.error(`❌ ${name}\n   ${e.message}`);
        failed++;
    }
}

// ====================== calculatePositionSize ======================
console.log("\n=== calculatePositionSize ===");

test("returns 0 for invalid side", () => {
    const s = makeStrategy();
    assert.strictEqual(s.calculatePositionSize("FLAT", 1000, 100, 98), 0);
});

test("returns 0 for non-finite inputs", () => {
    const s = makeStrategy();
    assert.strictEqual(s.calculatePositionSize("LONG", NaN, 100, 98), 0);
});

test("LONG stop >= entry → 0", () => {
    const s = makeStrategy();
    assert.strictEqual(s.calculatePositionSize("LONG", 1000, 100, 100), 0);
});

test("SHORT stop <= entry → 0", () => {
    const s = makeStrategy();
    assert.strictEqual(s.calculatePositionSize("SHORT", 1000, 100, 100), 0);
});

test("risk-based sizing: 1% risk on $10k with $2 stop = 50 units", () => {
    const s = makeStrategy({ riskPerTrade: 1.0, liqSafetyBuffer: 0 });
    const size = s.calculatePositionSize("LONG", 10000, 100, 98);
    assert.ok(Math.abs(size - 50) < 0.01);
});

test("leverage clamp works", () => {
    const s = makeStrategy({ riskPerTrade: 50, maxLeverage: 3, assetMaxLeverage: 3, liqSafetyBuffer: 0 });
    const size = s.calculatePositionSize("LONG", 1000, 100, 99.99);
    const notional = size * 100;
    assert.ok(notional <= 1000 * 3 + 1e-6);
});

test("liq safety buffer shrinks size when needed", () => {
    const sNoBuf = makeStrategy({ riskPerTrade: 50, maxLeverage: 50, assetMaxLeverage: 50, liqSafetyBuffer: 0 });
    const sBuf   = makeStrategy({ riskPerTrade: 50, maxLeverage: 50, assetMaxLeverage: 50, liqSafetyBuffer: 0.02 });
    const a = sNoBuf.calculatePositionSize("LONG", 1000, 100, 99);
    const b = sBuf.calculatePositionSize("LONG", 1000, 100, 99);
    assert.ok(b <= a);
});

test("shrinks to very small size for extreme safety requirements", () => {
    const s = makeStrategy({ riskPerTrade: 1.0, liqSafetyBuffer: 0.9999 });
    const size = s.calculatePositionSize("LONG", 1000, 100, 99.9999999);
    assert.ok(size < 10, `Expected very small size (<10), got ${size}`);
});

// ====================== liquidationPrice ======================
console.log("\n=== liquidationPrice ===");

test("LONG liq price is below entry", () => {
    const s = makeStrategy({ assetMaxLeverage: 10 });
    const liq = s.liquidationPrice("LONG", 100, 5);
    assert.ok(liq < 100);
});

test("SHORT liq price is above entry", () => {
    const s = makeStrategy({ assetMaxLeverage: 10 });
    const liq = s.liquidationPrice("SHORT", 100, 5);
    assert.ok(liq > 100);
});

// ====================== evaluateExit ======================
console.log("\n=== evaluateExit ===");

test("LONG stop-loss wins when both SL and TP are hit", () => {
    const s = makeStrategy({ stopLossPercent: 1.5, profitTarget: 2.0 });
    const r = s.evaluateExit("LONG", 100, 103, 98);
    assert.strictEqual(r.reason, "stop-loss");
});

test("SHORT stop-loss wins when both hit", () => {
    const s = makeStrategy({ stopLossPercent: 1.5, profitTarget: 2.0 });
    const r = s.evaluateExit("SHORT", 100, 102, 97);
    assert.strictEqual(r.reason, "stop-loss");
});

console.log(`\nTests complete: ${passed} passed, ${failed} failed`);
