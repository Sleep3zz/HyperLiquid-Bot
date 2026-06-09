// __tests__/BBRSIStrategy.forceClose.test.js

jest.mock("config", () => ({
 get: (key) => {
 const cfg = {
 trading: {
 market: "BTC", timeframe: "1h",
 profitTarget: 2.0, stopLossPercent: 1.5, riskPerTrade: 1.0,
 maxLeverage: 10, assetMaxLeverage: 20, takerFeeRate: 0.00045,
 liqSafetyBuffer: 0.005, mode: "reversion",
 trailingStopPercent: 0.8, dailyLossLimitPercent: 3.0,
 cooldownPeriod: 1,
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

// Neutral indicators so they never drive the signal during these tests.
jest.mock("../indicators", () => ({
 calculateRSI: () => 50,
 calculateBollingerBands: () => ({ upper: 110, middle: 100, lower: 90 }),
 calculateADX: () => 30,
}), { virtual: true });

const { BBRSIStrategy } = require("../BBRSIStrategy");

function makeLogger() {
 return {
 info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
 };
}

describe("Daily loss limit force-close (regression)", () => {
 let strategy;
 const UTC_NOON = Date.UTC(2024, 0, 15, 12, 0, 0); // fixed bar timestamp

 beforeEach(() => {
 strategy = new BBRSIStrategy(makeLogger());
 // Simulate that we're already deep in the red for the day.
 strategy.dailyRealizedPnl = -2.5;             // already -2.5%
 strategy.dailyLossStartTs = strategy._utcDayStart(UTC_NOON);
 });

 test("emits CLOSE_LONG when daily limit breached while holding a LONG", async () => {
 // currentPnl pushes total below -dailyLossLimitPercent (-3.0%)
 const data = [
 { t: UTC_NOON - 3600000, c: 100, h: 101, l: 99 },
 { t: UTC_NOON, c: 99, h: 99.5, l: 98.8 },
 ];
 const result = await strategy.evaluatePosition(data, "LONG", 1000, 100, -1.0);

 // THE ASSERTION THAT FAILS ON BUGGY CODE:
 expect(result.signal).toBe("CLOSE_LONG");
 expect(result.reason).toBe("daily-loss-limit-force-close");
 });

 test("emits CLOSE_SHORT when daily limit breached while holding a SHORT", async () => {
 const data = [
 { t: UTC_NOON - 3600000, c: 100, h: 101, l: 99 },
 { t: UTC_NOON, c: 101, h: 101.2, l: 100.5 },
 ];
 const result = await strategy.evaluatePosition(data, "SHORT", 1000, 100, -1.0);

 expect(result.signal).toBe("CLOSE_SHORT");
 expect(result.reason).toBe("daily-loss-limit-force-close");
 });

 test("blocks NEW entries (no position) when daily limit already breached", async () => {
 strategy.dailyRealizedPnl = -3.5; // already past the limit
 const data = [
 { t: UTC_NOON - 3600000, c: 100, h: 100, l: 100 },
 { t: UTC_NOON, c: 100, h: 100, l: 100 },
 ];
 const result = await strategy.evaluatePosition(data, null, 1000, null, 0);

 expect(result.signal).toBe("NONE");
 expect(result.reason).toBe("daily loss limit reached");
 });

 test("does NOT force-close when within daily limit", async () => {
 const data = [
 { t: UTC_NOON - 3600000, c: 100, h: 101, l: 99 },
 { t: UTC_NOON, c: 99.9, h: 100.1, l: 99.8 },
 ];
 const result = await strategy.evaluatePosition(data, "LONG", 1000, 100, -0.2);

 expect(result.signal).not.toBe("CLOSE_LONG");
 });
});