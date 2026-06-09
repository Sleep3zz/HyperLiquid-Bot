// Mock config before requiring the strategy
jest.mock("config", () => ({
  get: (key) => ({
    trading: {
      market: "BTC",
      timeframe: "1h",
      profitTarget: 2.0,
      stopLossPercent: 1.5,
      riskPerTrade: 1.0,
      maxLeverage: 10,
      assetMaxLeverage: 20,
      takerFeeRate: 0.00045,
      liqSafetyBuffer: 0.005,
      mode: "reversion",
      trailingStopPercent: 0.8,
      dailyLossLimitPercent: 3.0,
      cooldownPeriod: 1,
      persistDebounceMs: 5000,
    },
    indicators: {
      rsi: { period: 14, overbought: 75, oversold: 25 },
      bollinger: { period: 20, stdDev: 2 },
      adx: { period: 14, threshold: 25 },
    },
  }[key]),
}));

const { BBRSIStrategy } = require('../../src/strategy/BBRSIStrategy');

// Helpers for regression tests
const HOUR_MS = 3600_000;
const UTC_NOON = Date.UTC(2024, 0, 15, 12, 0, 0);

function makeBars(last, endTs, basePrice = 100, n = 30) {
    const bars = [];
    for (let i = 0; i < n; i++) {
        const t = endTs - (n - 1 - i) * HOUR_MS;
        bars.push({ t, c: basePrice, h: basePrice, l: basePrice });
    }
    bars[n - 1] = { t: endTs, c: last.c, h: last.h, l: last.l };
    return bars;
}

describe('BBRSIStrategy', () => {
    let strategy;
    const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };

    beforeEach(() => {
        strategy = new BBRSIStrategy(logger);
        strategy.setCurrentTimestamp(1000000); // clean starting timestamp
    });

    test('cooldown boundary is strict < (entry allowed exactly at boundary)', () => {
        strategy.registerExit();
        expect(strategy.inCooldown()).toBe(true); // same candle

        strategy.setCurrentTimestamp(1000000 + strategy.cooldownPeriodMs);
        expect(strategy.inCooldown()).toBe(false); // boundary = allowed
    });

    test('trailing stop fires correctly after high-water mark retrace (LONG)', () => {
        const entry = 100;
        // Set high-water at 110 (currentHigh=110, currentLow=109)
        strategy.checkTrailingStop("LONG", entry, 110, 109, { signal: "NONE" });
        // Price drops to 108, low hits 107 — should trigger trailing stop
        const exit = strategy.checkTrailingStop("LONG", entry, 108, 107, { signal: "NONE" });
        expect(exit?.signal).toBe("CLOSE_LONG");
        expect(exit?.reason).toBe("trailing-stop");
    });

    test('trailing stop does NOT fire on entry bar', () => {
        const entry = 100;
        // On entry bar: high=100, low=100 — no retrace yet
        const exit = strategy.checkTrailingStop("LONG", entry, 100, 100, { signal: "NONE" });
        expect(exit).toBeNull();
    });

    test('daily loss limit uses REALIZED PnL + current snapshot (no double-counting)', () => {
        strategy.notifyExit(1000001, -2.0); // bank realized loss
        strategy.notifyExit(1000002, -1.5); // bank another
        expect(strategy.dailyRealizedPnl).toBeCloseTo(-3.5);

        // open position at -0.5% unrealized
        expect(strategy.checkDailyLossLimit(-0.5, 1000003)).toBe(true);
    });

    test('daily loss limit resets after UTC day rollover', () => {
        const day1 = Date.UTC(2024, 0, 15, 23, 0, 0); // 23:00 UTC
        strategy.notifyExit(day1, -2.5);
        expect(strategy.dailyRealizedPnl).toBeCloseTo(-2.5);
        expect(strategy.dailyLossStartTs).toBe(strategy._utcDayStart(day1));

        const day2 = Date.UTC(2024, 0, 16, 1, 0, 0); // 01:00 UTC next day
        const breached = strategy.checkDailyLossLimit(0, day2);
        expect(breached).toBe(false);
        expect(strategy.dailyRealizedPnl).toBe(0); // reset happened
        expect(strategy.dailyLossStartTs).toBe(strategy._utcDayStart(day2));
    });

    test('position size never returns negative or zero when conditions are valid', () => {
        const size = strategy.calculatePositionSize("LONG", 10000, 100, 98);
        expect(size).toBeGreaterThan(0);
    });

    // Regression tests for fixes #1, #2, #4
    test('#1: trailing stop does NOT fire on entry bar (seed from entry)', async () => {
        // Wide entry bar: high 100, low 98.5, trail 0.8% → naive stop 99.2 would fire.
        // Seed is max(100, 100) = 100. Trail needs high-water > 100 to arm.
        const data = makeBars({ c: 99, h: 100, l: 98.5 }, UTC_NOON);
        const result = await strategy.evaluatePosition(data, "LONG", 10000, 100, -0.5);
        // Should NOT be trailing-stop; hard stop at 98.5 (1.5%) is the floor.
        expect(result.reason).not.toBe("trailing-stop");
    });

    test('#2: hard stop takes precedence over trailing on same bar', async () => {
        // Move price up first to arm the trail above entry
        await strategy.evaluatePosition(
            makeBars({ c: 103, h: 103, l: 102 }, UTC_NOON - HOUR_MS),
            "LONG", 10000, 100, 3
        );
        // Crash bar that hits BOTH the hard stop (98.5) and the trail
        const result = await strategy.evaluatePosition(
            makeBars({ c: 98, h: 102.5, l: 98.0 }, UTC_NOON),
            "LONG", 10000, 100, -2
        );
        expect(result.reason).toBe("stop-loss");
    });

    test('#4: force-close emitted once, then suppressed until fill', async () => {
        strategy.dailyRealizedPnl = -2.5;
        strategy.dailyLossStartTs = strategy._utcDayStart(UTC_NOON);

        // First call emits force-close
        const data = makeBars({ c: 99, h: 99.5, l: 98.8 }, UTC_NOON);
        const r1 = await strategy.evaluatePosition(data, "LONG", 10000, 100, -1.0);
        expect(r1.signal).toBe("CLOSE_LONG");
        expect(r1.reason).toBe("daily-loss-limit-force-close");

        // Second call (same position, still breached) is suppressed
        const r2 = await strategy.evaluatePosition(data, "LONG", 10000, 100, -1.0);
        expect(r2.signal).toBe("NONE");
        expect(r2.reason).toBe("force-close already emitted; awaiting fill");
    });

    test('#4: force-close re-arms after UTC day rollover if position still open', async () => {
        const day1 = Date.UTC(2024, 0, 15, 12, 0, 0);
        const day2 = Date.UTC(2024, 0, 16, 12, 0, 0);

        // Day 1: breach + emit
        strategy.dailyRealizedPnl = -2.5;
        strategy.dailyLossStartTs = strategy._utcDayStart(day1);
        const r1 = await strategy.evaluatePosition(
            makeBars({ c: 99, h: 99.5, l: 98.8 }, day1), "LONG", 10000, 100, -1.0
        );
        expect(r1.signal).toBe("CLOSE_LONG");
        expect(r1.reason).toBe("daily-loss-limit-force-close");

        // Day 2: rollover zeroes realized PnL. To breach again, currentPnl alone
        // must exceed the limit. Use -3.5% unrealized (beyond -3.0% limit).
        // low: 98.8 > hard stop 98.5, so daily force-close is the exit under test.
        const r2 = await strategy.evaluatePosition(
            makeBars({ c: 96.5, h: 99.0, l: 98.8 }, day2), "LONG", 10000, 100, -3.5
        );

        // MUST re-emit, not suppress:
        expect(r2.signal).toBe("CLOSE_LONG");
        expect(r2.reason).toBe("daily-loss-limit-force-close");
    });
});
