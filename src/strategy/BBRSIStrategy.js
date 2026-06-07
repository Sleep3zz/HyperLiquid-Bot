const config = require("config");
const { calculateBollingerBands, calculateADX, calculateRSI } = require("./indicators");

class BBRSIStrategy {
 constructor(logger) {
 this.logger = logger;

 // Trading config
 this.market = config.get("trading.market");
 this.timeframe = config.get("trading.timeframe");
 this.profitTarget = config.get("trading.profitTarget") || 2.0;

 // Risk management (configurable)
 const trading = config.get("trading");
 this.stopLossPercent = trading.stopLossPercent || 1.5; // Hard stop-loss %
 this.riskPerTrade = trading.riskPerTrade || 1.0; // % of account risked per trade
 this.maxLeverage = trading.maxLeverage || 5;

 // Indicator settings
 const indicators = config.get("indicators");
 this.rsiPeriod = indicators.rsi.period || 14;
 this.rsiOverbought = indicators.rsi.overbought || 75;
 this.rsiOversold = indicators.rsi.oversold || 25;
 this.bbPeriod = indicators.bollinger.period || 20;
 this.bbStdDev = indicators.bollinger.stdDev || 2;
 this.adxPeriod = indicators.adx.period || 14;
 this.adxThreshold = indicators.adx.threshold || 25;

 this.logger.info("BBRSI Strategy initialized with full risk management", {
 market: this.market,
 stopLossPercent: this.stopLossPercent,
 riskPerTrade: this.riskPerTrade,
 maxLeverage: this.maxLeverage,
 });
 }

 /**
 * Calculate position size based on risk per trade and stop-loss distance
 */
 calculatePositionSize(accountEquity, entryPrice, stopLossPrice) {
 if (!accountEquity || !entryPrice || !stopLossPrice) return 0;

 const riskAmount = accountEquity * (this.riskPerTrade / 100);
 const stopDistance = Math.abs(entryPrice - stopLossPrice);

 if (stopDistance <= 0) return 0;

 let size = riskAmount / stopDistance;

 // Enforce leverage cap
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

 // Calculate indicators
 const bb = calculateBollingerBands(data, this.bbPeriod, this.bbStdDev);
 const adx = calculateADX(data, this.adxPeriod);
 const rsi = calculateRSI(data, this.rsiPeriod);

 const currentPrice = parseFloat(data[data.length - 1].c);
 const previousPrice = parseFloat(data[data.length - 2].c);

 // Validate indicators
 if (![bb?.upper, bb?.middle, bb?.lower, rsi, adx, currentPrice].every(Number.isFinite)) {
 return { signal: "NONE", reason: "invalid indicator values" };
 }

 const result = {
 signal: "NONE",
 indicators: { bb, rsi, adx, price: currentPrice },
 };

 // === EXIT LOGIC FIRST (if already in position) ===
 if (currentPosition === "LONG") {
 // Check stop-loss / take-profit first
 if (entryPrice && currentPrice <= entryPrice * (1 - this.stopLossPercent / 100)) {
 result.signal = "CLOSE_LONG";
 result.reason = "stop-loss hit";
 this.logger.debug("Stop-loss triggered on LONG");
 return result;
 }
 if (entryPrice && currentPrice >= entryPrice * (1 + this.profitTarget / 100)) {
 result.signal = "CLOSE_LONG";
 result.reason = "take-profit hit";
 this.logger.debug("Take-profit triggered on LONG");
 return result;
 }

 // Indicator exits
 const crossedUnderMiddle = previousPrice >= bb.middle && currentPrice < bb.middle;
 const rsiExit = rsi > 80;
 if (crossedUnderMiddle || rsiExit) {
 result.signal = "CLOSE_LONG";
 this.logger.debug("Exit LONG triggered by indicator");
 return result;
 }
 }

 if (currentPosition === "SHORT") {
 if (entryPrice && currentPrice >= entryPrice * (1 + this.stopLossPercent / 100)) {
 result.signal = "CLOSE_SHORT";
 result.reason = "stop-loss hit";
 this.logger.debug("Stop-loss triggered on SHORT");
 return result;
 }
 if (entryPrice && currentPrice <= entryPrice * (1 - this.profitTarget / 100)) {
 result.signal = "CLOSE_SHORT";
 result.reason = "take-profit hit";
 this.logger.debug("Take-profit triggered on SHORT");
 return result;
 }

 const crossedOverMiddle = previousPrice <= bb.middle && currentPrice > bb.middle;
 const rsiExit = rsi < 20;
 if (crossedOverMiddle || rsiExit) {
 result.signal = "CLOSE_SHORT";
 this.logger.debug("Exit SHORT triggered by indicator");
 return result;
 }
 }

 // === ENTRY LOGIC (only if no position) ===
 if (!currentPosition) {
 const crossedBelowLower = previousPrice >= bb.lower && currentPrice < bb.lower;
 const longConditions = crossedBelowLower && rsi < this.rsiOversold && adx >= this.adxThreshold;

 const crossedAboveUpper = previousPrice <= bb.upper && currentPrice > bb.upper;
 const shortConditions = crossedAboveUpper && rsi > this.rsiOverbought && adx >= this.adxThreshold;

 if (longConditions) {
 result.signal = "LONG";
 result.stopLoss = currentPrice * (1 - this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 + this.profitTarget / 100);

 if (accountEquity) {
 result.positionSize = this.calculatePositionSize(accountEquity, currentPrice, result.stopLoss);
 }

 this.logger.debug("LONG signal generated with risk management");
 } else if (shortConditions) {
 result.signal = "SHORT";
 result.stopLoss = currentPrice * (1 + this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 - this.profitTarget / 100);

 if (accountEquity) {
 result.positionSize = this.calculatePositionSize(accountEquity, currentPrice, result.stopLoss);
 }

 this.logger.debug("SHORT signal generated with risk management");
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