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

 // HyperLiquid-specific
 this.assetMaxLeverage = Number(trading.assetMaxLeverage) || this.maxLeverage;
 this.takerFeeRate = Number(trading.takerFeeRate) || 0.00045; // per side
 this.liqSafetyBuffer = Number(trading.liqSafetyBuffer) || 0.005; // 0.5% gap

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

 this.logger.info("BBRSI Strategy initialized with HyperLiquid-aware risk", {
 mode: this.mode,
 stopLossPercent: this.stopLossPercent,
 profitTarget: this.profitTarget,
 riskPerTrade: this.riskPerTrade,
 assetMaxLeverage: this.assetMaxLeverage,
 });
 }

 _num(v) {
 if (v == null) return NaN;
 if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
 if (Array.isArray(v)) return this._num(v.at(-1));
 if (typeof v === "object") return this._num(v.adx ?? v.value ?? v.rsi);
 const n = Number(v);
 return Number.isFinite(n) ? n : NaN;
 }

 maintMarginFraction() {
 return 1 / (2 * this.assetMaxLeverage);
 }

 liquidationPrice(side, entryPrice, leverage) {
 if (!Number.isFinite(entryPrice) || !Number.isFinite(leverage) || leverage <= 0) return NaN;
 const m = this.maintMarginFraction();
 if (side === "LONG") return entryPrice * (1 - 1 / leverage + m);
 if (side === "SHORT") return entryPrice * (1 + 1 / leverage - m);
 return NaN;
 }

 calculatePositionSize(accountEquity, entryPrice, stopLossPrice, side = "LONG") {
 if (![accountEquity, entryPrice, stopLossPrice].every(Number.isFinite)) return 0;
 if (accountEquity <= 0 || entryPrice <= 0) return 0;
 if (side !== "LONG" && side !== "SHORT") return 0;

 const riskAmount = accountEquity * (this.riskPerTrade / 100);
 const stopDistance = Math.abs(entryPrice - stopLossPrice);
 if (stopDistance <= 0) return 0;

 let size = riskAmount / stopDistance;
 let notional = size * entryPrice;

 // Cap by max leverage
 const maxNotional = accountEquity * this.maxLeverage;
 if (notional > maxNotional) {
 size = maxNotional / entryPrice;
 notional = size * entryPrice;
 this.logger.warn("Position size capped by maxLeverage");
 }

 // Liquidation safety (side-aware)
 const leverage = notional / accountEquity;
 const liqPrice = this.liquidationPrice(side, entryPrice, leverage);
 const stopPrice = stopLossPrice;

 let safe = true;
 if (Number.isFinite(liqPrice)) {
 const margin = side === "LONG" 
 ? (stopPrice - liqPrice) / entryPrice 
 : (liqPrice - stopPrice) / entryPrice;
 if (margin < this.liqSafetyBuffer) safe = false;
 }

 if (!safe) {
 size *= 0.8; // reduce size until safe
 this.logger.warn("Position size reduced for liquidation safety");
 }

 return size > 0 ? size : 0;
 }

 async evaluatePosition(data, currentPosition = null, accountEquity = null, entryPrice = null) {
 try {
 if (!Array.isArray(data) || data.length < this.bbPeriod + 2) {
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

 if (![bb.upper, bb.middle, bb.lower, rsi, adx, currentPrice, previousPrice, currentHigh, currentLow].every(Number.isFinite)) {
 return { signal: "NONE", reason: "invalid indicator/price values" };
 }

 const result = { signal: "NONE", indicators: { bb, rsi, adx, price: currentPrice } };

 // Exit logic first
 if (currentPosition === "LONG") {
 if (entryPrice && currentLow <= entryPrice * (1 - this.stopLossPercent / 100)) return { ...result, signal: "CLOSE_LONG", reason: "stop-loss hit" };
 if (entryPrice && currentHigh >= entryPrice * (1 + this.profitTarget / 100)) return { ...result, signal: "CLOSE_LONG", reason: "take-profit hit" };
 const crossedUnderMiddle = previousPrice >= bb.middle && currentPrice < bb.middle;
 if (crossedUnderMiddle || rsi >= this.rsiExitLong) return { ...result, signal: "CLOSE_LONG", reason: "indicator exit" };
 return result;
 }

 if (currentPosition === "SHORT") {
 if (entryPrice && currentHigh >= entryPrice * (1 + this.stopLossPercent / 100)) return { ...result, signal: "CLOSE_SHORT", reason: "stop-loss hit" };
 if (entryPrice && currentLow <= entryPrice * (1 - this.profitTarget / 100)) return { ...result, signal: "CLOSE_SHORT", reason: "take-profit hit" };
 const crossedOverMiddle = previousPrice <= bb.middle && currentPrice > bb.middle;
 if (crossedOverMiddle || rsi <= this.rsiExitShort) return { ...result, signal: "CLOSE_SHORT", reason: "indicator exit" };
 return result;
 }

 // Entry logic
 let longConditions = false;
 let shortConditions = false;

 if (this.mode === "breakout") {
 const brokeAboveUpper = previousPrice <= bb.upper && currentPrice > bb.upper;
 const brokeBelowLower = previousPrice >= bb.lower && currentPrice < bb.lower;
 longConditions = brokeAboveUpper && rsi > 50 && adx >= this.adxThreshold;
 shortConditions = brokeBelowLower && rsi < 50 && adx >= this.adxThreshold;
 } else {
 const bouncedUpFromLower = previousPrice <= bb.lower && currentPrice > bb.lower;
 const bouncedDownFromUpper = previousPrice >= bb.upper && currentPrice < bb.upper;
 longConditions = bouncedUpFromLower && rsi < this.rsiOversold && adx < this.adxThreshold;
 shortConditions = bouncedDownFromUpper && rsi > this.rsiOverbought && adx < this.adxThreshold;
 }

 if (longConditions) {
 result.signal = "LONG";
 result.stopLoss = currentPrice * (1 - this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 + this.profitTarget / 100);
 if (accountEquity) result.positionSize = this.calculatePositionSize(accountEquity, currentPrice, result.stopLoss, "LONG");
 this.logger.debug("LONG signal generated");
 } else if (shortConditions) {
 result.signal = "SHORT";
 result.stopLoss = currentPrice * (1 + this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 - this.profitTarget / 100);
 if (accountEquity) result.positionSize = this.calculatePositionSize(accountEquity, currentPrice, result.stopLoss, "SHORT");
 this.logger.debug("SHORT signal generated");
 }

 return result;
 } catch (error) {
 this.logger.error("Error in evaluatePosition", { error: error.message });
 return { signal: "NONE", error: error.message };
 }
 }
}

module.exports = BBRSIStrategy;