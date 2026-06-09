// __tests__/BBRSIStrategy.forceClose.test.js

// ──────────────────────────────────────────────────────────────
// Mock config BEFORE requiring the strategy.
// ──────────────────────────────────────────────────────────────
jest.mock("config", () => ({
 get: (key) => {
 const cfg = {
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
 };
 return cfg[key];
 },
}));

// ──────────────────────────────────────────────────────────────
// Mock indicators to NEUTRAL values so they never drive an exit/entry
// and never return NaN. This isolates the daily-loss circuit-breaker.
// ──────────────────────────────────────────────────────────────
jest.mock("../indicators", () => ({
 calculateRSI: jest.fn(() => 50),
 calculateBollingerBands: jest.fn(() => ({ upper: 110, middle: 100, lower: 90 })),
 calculateADX: jest.fn(() => 30),
}));

const { BBRSIStrategy } = require("../BBRSIStrategy");

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function makeLogger() {
 return {
 info: jest.fn(),
 warn: jest.fn(),
 error: jest.fn(),
 debug: jest.fn(),
 };
}

const HOUR_MS = 3600_000;

/**
 * Build an ascending OHLCV array long enough to pass the
 * `data.length < bbPeriod + 2` guard (bbPeriod = 20 → need >= 22).
 */
function makeBars(last, endTs, basePrice = 100, n = 30) {
 const bars = [];
 for (let i = 0; i < n; i++) {
 const t = endTs - (n - 1 - i) * HOUR_MS;
 bars.push({ t, c: basePrice, h: basePrice, l: basePrice });
 }
 bars[n - 1] = { t: endTs, c: last.c, h: last.h, l: last.l };
 return bars;
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────
describe("Daily loss limit force-close (regression)", () => {
 let strategy;
 const UTC_NOON = Date.UTC(2024, 0, 15, 12, 0, 0);
 const EQUITY = 10000;

 beforeEach(() => {
 strategy = new BBRSIStrategy(makeLogger());
 strategy.dailyRealizedPnl = -2.5;
 strategy.dailyLossStartTs = strategy._utcDayStart(UTC_NOON);
 });

 test("emits CLOSE_LONG when daily limit breached while holding a LONG", async () => {
 const data = makeBars({ c: 99, h: 99.5, l: 98.8 }, UTC_NOON);
 const result = await strategy.evaluatePosition(data, "LONG", EQUITY, 100, -1.0);
 expect(result.signal).toBe("CLOSE_LONG");
 expect(result.reason).toBe("daily-loss-limit-force-close");
 });

 test("emits CLOSE_SHORT when daily limit breached while holding a SHORT", async () => {
 const data = makeBars({ c: 101, h: 101.2, l: 100.5 }, UTC_NOON);
 const result = await strategy.evaluatePosition(data, "SHORT", EQUITY, 100, -1.0);
 expect(result.signal).toBe("CLOSE_SHORT");
 expect(result.reason).toBe("daily-loss-limit-force-close");
 });

 test("force-close fires even when indicators are NaN", async () => {
 const { calculateRSI, calculateBollingerBands, calculateADX } = require("../indicators");
 calculateRSI.mockReturnValueOnce(NaN);
 calculateBollingerBands.mockReturnValueOnce({ upper: NaN, middle: NaN, lower: NaN });
 calculateADX.mockReturnValueOnce(NaN);

 const data = makeBars({ c: 99, h: 99.5, l: 98.8 }, UTC_NOON);
 const result = await strategy.evaluatePosition(data, "LONG", EQUITY, 100, -1.0);

 expect(result.signal).toBe("CLOSE_LONG");
 expect(result.reason).toBe("daily-loss-limit-force-close");
 });

 test("force-close fires even with insufficient data", async () => {
 const data = makeBars({ c: 99, h: 99.5, l: 98.8 }, UTC_NOON, 100, 5);
 const result = await strategy.evaluatePosition(data, "LONG", EQUITY, 100, -1.0);
 expect(result.signal).toBe("CLOSE_LONG");
 expect(result.reason).toBe("daily-loss-limit-force-close");
 });

 test("blocks NEW entries (flat) when daily limit already breached", async () => {
 strategy.dailyRealizedPnl = -3.5;
 const data = makeBars({ c: 100, h: 100, l: 100 }, UTC_NOON);
 const result = await strategy.evaluatePosition(data, null, EQUITY, null, 0);
 expect(result.signal).toBe("NONE");
 expect(result.reason).toBe("daily loss limit reached");
 });

 test("does NOT force-close when within daily limit", async () => {
 const data = makeBars({ c: 99.9, h: 100.1, l: 99.8 }, UTC_NOON);
 const result = await strategy.evaluatePosition(data, "LONG", EQUITY, 100, -0.2);
 expect(result.signal).not.toBe("CLOSE_LONG");
 expect(result.reason).not.toBe("daily-loss-limit-force-close");
 });

 test("forces a durable state flush on force-close", async () => {
 const saved = [];
 strategy.stateStore = { load: () => ({}), save: (s) => saved.push(s) };
 const data = makeBars({ c: 99, h: 99.5, l: 98.8 }, UTC_NOON);
 await strategy.evaluatePosition(data, "LONG", EQUITY, 100, -1.0);
 expect(saved.length).toBeGreaterThanOrEqual(1);
 const lastSnapshot = saved[saved.length - 1];
 expect(lastSnapshot).toHaveProperty("dailyRealizedPnl");
 });
});

describe("UTC daily reset", () => {
 let strategy;

 beforeEach(() => {
 strategy = new BBRSIStrategy(makeLogger());
 });

 test("resets dailyRealizedPnl when crossing into a new UTC day", async () => {
 const day1 = Date.UTC(2024, 0, 15, 23, 0, 0);
 const day2 = Date.UTC(2024, 0, 16, 1, 0, 0);

 strategy.dailyRealizedPnl = -2.9;
 strategy.dailyLossStartTs = strategy._utcDayStart(day1);

 const breached = strategy.checkDailyLossLimit(0, day2);

 expect(breached).toBe(false);
 expect(strategy.dailyRealizedPnl).toBe(0);
 expect(strategy.dailyLossStartTs).toBe(strategy._utcDayStart(day2));
 });
});