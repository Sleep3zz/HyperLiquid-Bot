const config = require("config");
const { calculateBollingerBands, calculateADX, calculateRSI } = require("./indicators");

class BBRSIStrategy {
 constructor(logger) {
 this.logger = logger;

 const trading = config.get("trading");
 this.market = trading.market;
 this.timeframe = trading.timeframe;
 this.profitTarget = Number(trading.profitTarget) || 2.0;
 this.stopLossPercent = Number(trading.stopLossPercent) || 1.5;
 this.riskPerTrade = Number(trading.riskPerTrade) || 1.0;
 this.maxLeverage = Number(trading.maxLeverage) || 5;
 this.mode = (trading.mode || "reversion").toLowerCase();

 const indicators = config.get("indicators");
 this.rsiPeriod = indicators.rsi.period || 14;
 this.rsiOverbought = indicators.rsi.overbought || 75;
 this.rsiOversold = indicators.rsi.oversold || 25;
 this.rsiExitLong = indicators.rsi.exitLong || this.rsiOverbought;
 this.rsiExitShort = indicators.rsi.exitShort || this.rsiOversold;
 this.bbPeriod = indicators.bollinger.period || 20;
 this.bbStdDev = indicators.bollinger.stdDev || 2;
 this.adxPeriod = indicators.adx.period || 14;
 this.adxThreshold = indicators.adx.threshold || 25;

 // Sanity warning: reward must beat risk
 if (this.profitTarget <= this.stopLossPercent) {
 this.logger.warn("profitTarget <= stopLossPercent — reward:risk < 1", {
 profitTarget: this.profitTarget,
 stopLossPercent: this.stopLossPercent,
 });
 }

 this.logger.info("BBRSI Strategy initialized", {
 mode: this.mode,
 stopLossPercent: this.stopLossPercent,
 profitTarget: this.profitTarget,
 riskPerTrade: this.riskPerTrade,
 maxLeverage: this.maxLeverage,
 });
 }

 /** Coerce indicator outputs (number | array | object) into a single finite number. */
 _num(v) {
 if (v == null) return NaN;
 if (typeof v === "number") return v;
 if (Array.isArray(v)) return this._num(v.at(-1));
 if (typeof v === "object") return this._num(v.adx ?? v.value ?? v.rsi);
 const n = Number(v);
 return Number.isFinite(n) ? n : NaN;
 }

 calculatePositionSize(accountEquity, entryPrice, stopLossPrice) {
 if (!accountEquity || !entryPrice || !stopLossPrice) return 0;
 if (![accountEquity, entryPrice, stopLossPrice].every(Number.isFinite)) return 0;

 const riskAmount = accountEquity * (this.riskPerTrade / 100);
 const stopDistance = Math.abs(entryPrice - stopLossPrice);
 if (stopDistance <= 0) return 0;

 let size = riskAmount / stopDistance;
 const notional = size * entryPrice;
 const maxNotional = accountEquity * this.maxLeverage;

 if (notional > maxNotional) {
 size = maxNotional / entryPrice;
 this.logger.warn("Position size capped by maxLeverage", {
 requestedNotional: notional,
 maxNotional,
 });
 }
 return size > 0 ? size : 0;
 }

 async evaluatePosition(data, currentPosition = null, accountEquity = null, entryPrice = null) {
 try {
 if (!Array.isArray(data)) {
 return { signal: "NONE", reason: "data is not an array" };
 }
 if (data.length < this.bbPeriod + 2) {
 return { signal: "NONE", reason: "insufficient data" };
 }

 const bbRaw = calculateBollingerBands(data, this.bbPeriod, this.bbStdDev);
 const adx = this._num(calculateADX(data, this.adxPeriod));
 const rsi = this._num(calculateRSI(data, this.rsiPeriod));

 const last = data[data.length - 1];
 const prev = data[data.length - 2];

 const currentPrice = parseFloat(last.c);
 const previousPrice = parseFloat(prev.c);
 const currentHigh = parseFloat(last.h ?? last.c);
 const currentLow = parseFloat(last.l ?? last.c);

 const bb = {
 upper: this._num(bbRaw?.upper),
 middle: this._num(bbRaw?.middle),
 lower: this._num(bbRaw?.lower),
 };

 const allFinite = [
 bb.upper, bb.middle, bb.lower, rsi, adx,
 currentPrice, previousPrice, currentHigh, currentLow,
 ].every(Number.isFinite);

 if (!allFinite) {
 return { signal: "NONE", reason: "invalid indicator/price values" };
 }

 // Guard against degenerate / inverted bands
 if (bb.upper <= bb.lower || bb.middle <= bb.lower || bb.middle >= bb.upper) {
 return { signal: "NONE", reason: "degenerate bollinger bands" };
 }

 const result = {
 signal: "NONE",
 indicators: { bb, rsi, adx, price: currentPrice },
 };

 // ===================== EXIT LOGIC (highest priority) =====================
 if (currentPosition === "LONG") {
 if (entryPrice && currentLow <= entryPrice * (1 - this.stopLossPercent / 100)) {
 return { ...result, signal: "CLOSE_LONG", reason: "stop-loss hit" };
 }
 if (entryPrice && currentHigh >= entryPrice * (1 + this.profitTarget / 100)) {
 return { ...result, signal: "CLOSE_LONG", reason: "take-profit hit" };
 }
 const crossedUnderMiddle = previousPrice >= bb.middle && currentPrice < bb.middle;
 if (crossedUnderMiddle || rsi >= this.rsiExitLong) {
 return { ...result, signal: "CLOSE_LONG", reason: "indicator exit" };
 }
 return result; // stay long
 }

 if (currentPosition === "SHORT") {
 if (entryPrice && currentHigh >= entryPrice * (1 + this.stopLossPercent / 100)) {
 return { ...result, signal: "CLOSE_SHORT", reason: "stop-loss hit" };
 }
 if (entryPrice && currentLow <= entryPrice * (1 - this.profitTarget / 100)) {
 return { ...result, signal: "CLOSE_SHORT", reason: "take-profit hit" };
 }
 const crossedOverMiddle = previousPrice <= bb.middle && currentPrice > bb.middle;
 if (crossedOverMiddle || rsi <= this.rsiExitShort) {
 return { ...result, signal: "CLOSE_SHORT", reason: "indicator exit" };
 }
 return result; // stay short
 }

 // ===================== ENTRY LOGIC =====================
 let longConditions = false;
 let shortConditions = false;

 if (this.mode === "breakout") {
 const brokeAboveUpper = previousPrice <= bb.upper && currentPrice > bb.upper;
 const brokeBelowLower = previousPrice >= bb.lower && currentPrice < bb.lower;
 longConditions = brokeAboveUpper && rsi > 50 && adx >= this.adxThreshold;
 shortConditions = brokeBelowLower && rsi < 50 && adx >= this.adxThreshold;
 } else {
 // REVERSION (mean-reversion bounce)
 const bouncedUpFromLower = previousPrice <= bb.lower && currentPrice > bb.lower;
 const bouncedDownFromUpper = previousPrice >= bb.upper && currentPrice < bb.upper;
 longConditions = bouncedUpFromLower && rsi < this.rsiOversold && adx < this.adxThreshold;
 shortConditions = bouncedDownFromUpper && rsi > this.rsiOverbought && adx < this.adxThreshold;
 }

 if (longConditions) {
 result.signal = "LONG";
 result.stopLoss = currentPrice * (1 - this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 + this.profitTarget / 100);
 if (accountEquity) result.positionSize = this.calculatePositionSize(accountEquity, currentPrice, result.stopLoss);
 this.logger.debug("LONG signal generated with risk management");
 } else if (shortConditions) {
 result.signal = "SHORT";
 result.stopLoss = currentPrice * (1 + this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 - this.profitTarget / 100);
 if (accountEquity) result.positionSize = this.calculatePositionSize(accountEquity, currentPrice, result.stopLoss);
 this.logger.debug("SHORT signal generated with risk management");
 }

 return result;
 } catch (error) {
 this.logger.error("Error in evaluatePosition", { error: error.message });
 return { signal: "NONE", error: error.message };
 }
 }
}

module.exports = BBRSIStrategy;