const config = require("config");
const { calculateBollingerBands, calculateADX, calculateRSI } = require("./indicators");

class BBRSIStrategy {
 constructor(logger) {
 this.logger = logger || { info() {}, error() {}, warn() {} };

 const trading = config.get("trading");
 const indicators = config.get("indicators");

 // Trading parameters
 this.market = trading.market;
 this.timeframe = trading.timeframe;
 this.profitTarget = Number(trading.profitTarget) || 2.0;
 this.stopLossPercent = Number(trading.stopLossPercent) || 1.5;
 this.riskPerTrade = Number(trading.riskPerTrade) || 1.0;
 this.maxLeverage = Number(trading.maxLeverage) || 5;
 this.assetMaxLeverage = Number(trading.assetMaxLeverage) || this.maxLeverage;
 this.takerFeeRate = Number(trading.takerFeeRate) || 0.00045;
 this.liqSafetyBuffer = Number(trading.liqSafetyBuffer) || 0.005;
 this.mode = (trading.mode || "reversion").toLowerCase();

 // Trailing stop
 this.trailingStopPercent = Number(trading.trailingStopPercent) || 0.8;

 // Daily loss limit
 this.dailyLossLimitPercent = Number(trading.dailyLossLimitPercent) || 3.0;

 // Indicators
 this.rsiPeriod = Number(indicators.rsi.period) || 14;
 this.rsiOverbought = Number(indicators.rsi.overbought) || 75;
 this.rsiOversold = Number(indicators.rsi.oversold) || 25;
 this.bbPeriod = Number(indicators.bollinger.period) || 20;
 this.bbStdDev = Number(indicators.bollinger.stdDev) || 2;
 this.adxPeriod = Number(indicators.adx.period) || 14;
 this.adxThreshold = Number(indicators.adx.threshold) || 25;

 // Cooldown (timestamp-based)
 this.cooldownPeriodMs = (Number(trading.cooldownPeriod) || 1) * 60 * 1000;
 this.lastExitTs = -Infinity;

 // Daily loss tracking
 this.dailyLossStartTs = -Infinity;
 this.dailyRealizedPnl = 0;

 // Trailing stop state
 this.trailHighWater = null;

 this._validateConfig();
 this.logger.info("BBRSIStrategy initialized", { mode: this.mode });
 }

 _validateConfig() {
 if (this.stopLossPercent <= 0 || this.profitTarget <= 0) throw new Error("stopLossPercent and profitTarget must be positive");
 if (this.riskPerTrade <= 0 || this.riskPerTrade > 100) throw new Error("riskPerTrade must be between 0 and 100");
 if (this.maxLeverage <= 0 || this.assetMaxLeverage <= 0) throw new Error("leverage values must be positive");
 if (this.mode !== "reversion" && this.mode !== "breakout") throw new Error(`unknown mode: ${this.mode}`);
 if (this.rsiOversold >= this.rsiOverbought) throw new Error("rsiOversold must be less than rsiOverbought");
 }

 _num(v) {
 if (Array.isArray(v)) return this._num(v[v.length - 1]);
 if (v && typeof v === "object") {
 const candidate = v.value ?? v.adx ?? v.rsi ?? v.upper ?? v.middle ?? v.lower;
 return this._num(candidate);
 }
 const n = Number(v);
 return Number.isFinite(n) ? n : NaN;
 }

 setCurrentTimestamp(ts) {
 this.currentTs = Number.isFinite(ts) ? ts : Date.now();
 }

 // ── Cooldown (strict < boundary) ──
 inCooldown() {
 if (this.cooldownPeriodMs <= 0) return false;
 return (this.currentTs - this.lastExitTs) < this.cooldownPeriodMs;
 }

 // ── Single source of truth for exits ──
 notifyExit(exitTs = null, realizedPnl = 0) {
 const ts = Number.isFinite(exitTs) ? exitTs : this.currentTs;

 this.lastExitTs = ts;

 if (this.dailyLossStartTs === -Infinity || this.dailyLossStartTs == null) {
 this.dailyLossStartTs = ts;
 }

 this.dailyRealizedPnl += realizedPnl;
 this.trailHighWater = null;

 this.logger.info(`Exit confirmed @${ts}: realized=${realizedPnl.toFixed(2)}%, dayPnL=${this.dailyRealizedPnl.toFixed(2)}%`);
 }

 registerExit(realizedPnl = 0) {
 return this.notifyExit(this.currentTs, realizedPnl);
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

 calculatePositionSize(side, accountEquity, entryPrice, stopLossPrice) {
 if (side !== "LONG" && side !== "SHORT") return 0;
 if (![accountEquity, entryPrice, stopLossPrice].every(Number.isFinite)) return 0;
 if (accountEquity <= 0 || entryPrice <= 0 || stopLossPrice <= 0) return 0;

 if (side === "LONG" && stopLossPrice >= entryPrice) return 0;
 if (side === "SHORT" && stopLossPrice <= entryPrice) return 0;

 const stopDistance = Math.abs(entryPrice - stopLossPrice);
 if (stopDistance <= 0) return 0;

 let size = (accountEquity * (this.riskPerTrade / 100)) / stopDistance;

 const effectiveMaxLev = Math.min(this.maxLeverage, this.assetMaxLeverage);
 const maxNotional = accountEquity * effectiveMaxLev;
 if (size * entryPrice > maxNotional) size = maxNotional / entryPrice;

 let attempts = 0;
 let satisfied = false;
 while (attempts < 50) {
 const notional = size * entryPrice;
 const leverage = notional / accountEquity;
 if (leverage <= 1) { satisfied = true; break; }

 const liqPrice = this.liquidationPrice(side, entryPrice, leverage);
 if (!Number.isFinite(liqPrice)) { satisfied = true; break; }

 const safeMargin = side === "LONG"
 ? (stopLossPrice - liqPrice) / entryPrice
 : (liqPrice - stopLossPrice) / entryPrice;

 if (Number.isFinite(safeMargin) && safeMargin >= this.liqSafetyBuffer) {
 satisfied = true;
 break;
 }

 size *= 0.8;
 attempts++;
 }

 if (!satisfied) {
 this.logger.warn("Position rejected: could not satisfy liquidation safety buffer");
 return 0;
 }

 const sizeDecimals = 4;
 size = Math.floor(size * 10 ** sizeDecimals) / 10 ** sizeDecimals;

 return size > 0 ? size : 0;
 }

 checkTrailingStop(currentPosition, entryPrice, currentPrice, baseResult) {
 if (currentPosition !== "LONG" && currentPosition !== "SHORT") return null;
 if (this.trailHighWater === null) this.trailHighWater = currentPrice;

 if (currentPosition === "LONG") {
 this.trailHighWater = Math.max(this.trailHighWater, currentPrice);
 const stop = this.trailHighWater * (1 - this.trailingStopPercent / 100);
 if (currentPrice <= stop) return { ...baseResult, signal: "CLOSE_LONG", reason: "trailing-stop" };
 } else {
 this.trailHighWater = Math.min(this.trailHighWater, currentPrice);
 const stop = this.trailHighWater * (1 + this.trailingStopPercent / 100);
 if (currentPrice >= stop) return { ...baseResult, signal: "CLOSE_SHORT", reason: "trailing-stop" };
 }
 return null;
 }

 // ── Daily loss limit (REALIZED + current snapshot) ──
 checkDailyLossLimit(currentPnl, nowTs) {
 if (this.dailyLossStartTs === -Infinity) this.dailyLossStartTs = nowTs;

 const msPerDay = 24 * 60 * 60 * 1000;
 if (nowTs - this.dailyLossStartTs >= msPerDay) {
 this.dailyRealizedPnl = 0;
 this.dailyLossStartTs = nowTs;
 }

 const totalDayPnl = this.dailyRealizedPnl + currentPnl;

 if (totalDayPnl <= -this.dailyLossLimitPercent) {
 this.logger.warn(`Daily loss limit hit: ${totalDayPnl.toFixed(2)}%`);
 return true;
 }
 return false;
 }

 evaluateExit(currentPosition, entryPrice, currentHigh, currentLow, baseResult) {
 if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;

 if (currentPosition === "LONG") {
 if (currentLow <= entryPrice * (1 - this.stopLossPercent / 100))
 return { ...baseResult, signal: "CLOSE_LONG", reason: "stop-loss" };
 if (currentHigh >= entryPrice * (1 + this.profitTarget / 100))
 return { ...baseResult, signal: "CLOSE_LONG", reason: "take-profit" };
 }
 if (currentPosition === "SHORT") {
 if (currentHigh >= entryPrice * (1 + this.stopLossPercent / 100))
 return { ...baseResult, signal: "CLOSE_SHORT", reason: "stop-loss" };
 if (currentLow <= entryPrice * (1 - this.profitTarget / 100))
 return { ...baseResult, signal: "CLOSE_SHORT", reason: "take-profit" };
 }
 return null;
 }

 // ── Main entry point ──
 async evaluatePosition(data, currentPosition = null, accountEquity = null, entryPrice = null, currentPnl = 0) {
 const last = data[data.length - 1];
 const barTs = Number(last.t ?? last.T ?? last.openTime ?? Date.now());

 this.setCurrentTimestamp(barTs);

 // Daily loss limit check
 if (this.checkDailyLossLimit(currentPnl, barTs))
 return { signal: "NONE", reason: "daily loss limit reached" };

 // Indicators
 const bbRaw = calculateBollingerBands(data, this.bbPeriod, this.bbStdDev);
 const adx = this._num(calculateADX(data, this.adxPeriod));
 const rsiSeries = calculateRSI(data, this.rsiPeriod);
 const rsi = this._num(rsiSeries);
 const prevRsi = this._num(rsiSeries.length >= 2 ? rsiSeries[rsiSeries.length - 2] : NaN);

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

 if (![bb.upper, bb.middle, bb.lower, rsi, adx, currentPrice, previousPrice, currentHigh, currentLow].every(Number.isFinite))
 return { signal: "NONE", reason: "invalid indicator/price values" };

 // ── Position management (exits) ──
 if (currentPosition === "LONG" || currentPosition === "SHORT") {
 const trailingExit = this.checkTrailingStop(currentPosition, entryPrice, currentPrice, { signal: "NONE" });
 if (trailingExit) return trailingExit;

 const exit = this.evaluateExit(currentPosition, entryPrice, currentHigh, currentLow, { signal: "NONE" });
 if (exit) return exit;

 return { signal: "NONE", reason: "holding position" };
 }

 // ── Entry logic ──
 if (this.inCooldown())
 return { signal: "NONE", reason: "cooldown active" };

 if (!Number.isFinite(accountEquity) || accountEquity <= 0)
 return { signal: "NONE", reason: "missing accountEquity" };

 let longConditions = false;
 let shortConditions = false;

 if (this.mode === "breakout") {
 const brokeAbove = previousPrice <= bb.upper && currentPrice > bb.upper;
 const brokeBelow = previousPrice >= bb.lower && currentPrice < bb.lower;
 longConditions = brokeAbove && rsi > 50 && adx >= this.adxThreshold;
 shortConditions = brokeBelow && rsi < 50 && adx >= this.adxThreshold;
 } else {
 const bouncedUpFromLower = previousPrice <= bb.lower && currentPrice > bb.lower;
 const bouncedDownFromUpper = previousPrice >= bb.upper && currentPrice < bb.upper;

 longConditions = bouncedUpFromLower && Number.isFinite(prevRsi) && prevRsi <= this.rsiOversold && adx < this.adxThreshold;
 shortConditions = bouncedDownFromUpper && Number.isFinite(prevRsi) && prevRsi >= this.rsiOverbought && adx < this.adxThreshold;
 }

 const result = { signal: "NONE", indicators: { bb, rsi, adx, price: currentPrice } };

 if (longConditions) {
 result.signal = "LONG";
 result.stopLoss = currentPrice * (1 - this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 + this.profitTarget / 100);
 result.positionSize = this.calculatePositionSize("LONG", accountEquity, currentPrice, result.stopLoss);
 if (result.positionSize <= 0) return { ...result, signal: "NONE", reason: "position size zero" };
 } else if (shortConditions) {
 result.signal = "SHORT";
 result.stopLoss = currentPrice * (1 + this.stopLossPercent / 100);
 result.takeProfit = currentPrice * (1 - this.profitTarget / 100);
 result.positionSize = this.calculatePositionSize("SHORT", accountEquity, currentPrice, result.stopLoss);
 if (result.positionSize <= 0) return { ...result, signal: "NONE", reason: "position size zero" };
 }

 return result;
 }
}

module.exports = BBRSIStrategy;