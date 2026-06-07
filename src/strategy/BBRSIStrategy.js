const config = require("config");
const { calculateBollingerBands, calculateADX, calculateRSI } = require("./indicators");

class BBRSIStrategy {
 constructor(logger) {
 this.logger = logger;

 // Trading config
 this.market = config.get("trading.market");
 this.timeframe = config.get("trading.timeframe");
 this.profitTarget = config.get("trading.profitTarget") || 2.0;

 // Risk management
 const trading = config.get("trading");
 this.stopLossPercent = trading.stopLossPercent || 1.5;
 this.riskPerTrade = trading.riskPerTrade || 1.0;
 this.maxLeverage = trading.maxLeverage || 5;
 this.mode = (trading.mode || "reversion").toLowerCase(); // "reversion" or "breakout"

 // Indicators
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

 this.logger.info("BBRSI Strategy initialized", {
 mode: this.mode,
 stopLossPercent: this.stopLossPercent,
 riskPerTrade: this.riskPerTrade,
 maxLeverage: this.maxLeverage,
 });
 }

 _num(v) {
 if (v == null) return NaN;
 if (typeof v === "number") return v;
 if (Array.isArray(v)) return this._num(v.at(-1));
 if (typeof v === "object") return this._num(v.adx ?? v.value ?? v.rsi);
 return NaN;
 }

 calculatePositionSize(accountEquity, entryPrice, stopLossPrice) {
 if (!accountEquity || !entryPrice || !stopLossPrice) return 0;
 const riskAmount = accountEquity * (this.riskPerTrade / 100);
 const stopDistance = Math.abs(entryPrice - stopLossPrice);
 if (stopDistance <= 0) return 0;
 let size = riskAmount / stopDistance;
 const notional = size * entryPrice;
 const maxNotional = accountEquity * this.maxLeverage;
 if (notional > maxNotional) {
 size = maxNotional / entryPrice;
 this.logger.warn("Position size capped by maxLeverage");
 }
 return size;
 }

 async evaluatePosition(data, currentPosition = null, accountEquity = null, entryPrice = null) {
 try {
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

 if (![bb.upper, bb.middle, bb.lower, rsi, adx, currentPrice, previousPrice].every(Number.isFinite)) {
 return { signal: "NONE", reason: "invalid indicator values" };
 }

 const result = { signal: "NONE", indicators: { bb, rsi, adx, price: currentPrice } };

 // === EXIT LOGIC FIRST ===
 if (currentPosition === "LONG") {
 if (entryPrice && currentLow <= entryPrice * (1 - this.stopLossPercent / 100)) {
 return { ...result, signal: "CLOSE_LONG", reason: "stop-loss hit" };
 }
 if (entryPrice && currentHigh >= entryPrice * (1 + this.profitTarget / 100)) {
 return { ...result, signal: "CLOSE_LONG", reason: "take-profit hit" };
 }
 const crossedUnderMiddle = previousPrice >= bb.middle && currentPrice < bb.middle;
 if (crossedUnderMiddle || rsi > this.rsiExitLong) {
 return { ...result, signal: "CLOSE_LONG", reason: "indicator exit" };
 }
 }

 if (currentPosition === "SHORT") {
 if (entryPrice && currentHigh >= entryPrice * (1 + this.stopLossPercent / 100)) {
 return { ...result, signal: "CLOSE_SHORT", reason: "stop-loss hit" };
 }
 if (entryPrice && currentLow <= entryPrice * (1 - this.profitTarget / 100)) {
 return { ...result, signal: "CLOSE_SHORT", reason: "take-profit hit" };
 }
 const crossedOverMiddle = previousPrice <= bb.middle && currentPrice > bb.middle;
 if (crossedOverMiddle || rsi < this.rsiExitShort) {
 return { ...result, signal: "CLOSE_SHORT", reason: "indicator exit" };
 }
 }

 // === ENTRY LOGIC ===
 if (!currentPosition) {
 let longConditions = false;
 let shortConditions = false;

 if (this.mode === "breakout") {
 const brokeAboveUpper = previousPrice <= bb.upper && currentPrice > bb.upper;
 const brokeBelowLower = previousPrice >= bb.lower && currentPrice < bb.lower;
 longConditions = brokeAboveUpper && rsi > 50 && adx >= this.adxThreshold;
 shortConditions = brokeBelowLower && rsi < 50 && adx >= this.adxThreshold;
 } else {
 // reversion mode
 const touchedLower = previousPrice >= bb.lower && currentPrice > bb.lower;
 const touchedUpper = previousPrice <= bb.upper && currentPrice < bb.upper;
 longConditions = touchedLower && rsi < this.rsiOversold && adx < this.adxThreshold;
 shortConditions = touchedUpper && rsi > this.rsiOverbought && adx < this.adxThreshold;
 }

 if (longConditions) {
 result.signal = "LONG";
 result.stopLoss = currentPrice * (1 - this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 + this.profitTarget / 100);
 if (accountEquity) result.positionSize = this.calculatePositionSize(accountEquity, currentPrice, result.stopLoss);
 this.logger.debug("LONG signal with risk management");
 } else if (shortConditions) {
 result.signal = "SHORT";
 result.stopLoss = currentPrice * (1 + this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 - this.profitTarget / 100);
 if (accountEquity) result.positionSize = this.calculatePositionSize(accountEquity, currentPrice, result.stopLoss);
 this.logger.debug("SHORT signal with risk management");
 }
 }

 return result;
 } catch (error) {
 this.logger.error("Error in evaluatePosition", { error: error.message });
 return { signal: "NONE", error: error.message };
 }
 }
}

module.exports = BBRSIStrategy;