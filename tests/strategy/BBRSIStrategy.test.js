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
        strategy.checkTrailingStop("LONG", entry, 110, {}); // set high-water
        const exit = strategy.checkTrailingStop("LONG", entry, 108, { signal: "NONE" });
        expect(exit?.signal).toBe("CLOSE_LONG");
        expect(exit?.reason).toBe("trailing-stop");
    });

    test('trailing stop does NOT fire on entry bar', () => {
        const entry = 100;
        const exit = strategy.checkTrailingStop("LONG", entry, 100, { signal: "NONE" });
        expect(exit).toBeNull();
    });

    test('daily loss limit uses REALIZED PnL + current snapshot (no double-counting)', () => {
        strategy.notifyExit(1000001, -2.0); // bank realized loss
        strategy.notifyExit(1000002, -1.5); // bank another
        expect(strategy.dailyRealizedPnl).toBeCloseTo(-3.5);

        // open position at -0.5% unrealized
        expect(strategy.checkDailyLossLimit(-0.5, 1000003)).toBe(true);
    });

    test('daily loss limit resets after 24h window', () => {
        const day1 = 1000000;
        strategy.notifyExit(day1, -2.5);
        expect(strategy.dailyRealizedPnl).toBeCloseTo(-2.5);

        const day2 = day1 + 24 * 60 * 60 * 1000 + 1;
        strategy.checkDailyLossLimit(0, day2); // crosses window
        expect(strategy.dailyRealizedPnl).toBe(0); // reset happened
    });

    test('position size never returns negative or zero when conditions are valid', () => {
        const size = strategy.calculatePositionSize("LONG", 10000, 100, 98);
        expect(size).toBeGreaterThan(0);
    });
});
