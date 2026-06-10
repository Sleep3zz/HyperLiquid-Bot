/**
 * Strategy Orchestrator - Phase 3: Regime Observation (per-coin state)
 */
const { BBRSIStrategy } = require("./strategy/BBRSIStrategy");
const RegimeDetector = require("./strategy/RegimeDetector");

class StrategyOrchestrator {
 constructor(wayfinder, logger = console) {
 this.wayfinder = wayfinder;
 this.logger = logger;

 this.bbrsi = new BBRSIStrategy(logger);
 this._grid = null;

 this.regimeDetector = new RegimeDetector(this.bbrsi, wayfinder, logger, "15m");

 this._regimeLog = [];
 this._lastConfirmedRegime = {}; // FIX: per-coin, was a scalar
 this._observers = new Map(); // FIX: per-coin timers (multi-coin safe)

 this.logger.info("[Orchestrator] Phase 3 initialized - regime observation mode");
 }

 get grid() {
 if (!this._grid) {
 const GridStrategy = require("./strategy/GridStrategy");
 this._grid = new GridStrategy(this.logger, this.wayfinder);
 }
 return this._grid;
 }

 async startObservation(coin = "BTC", intervalMs = 900000) {
 if (this._observers.has(coin)) {
 return `Already observing ${coin}`;
 }
 this.logger.info(`[Orchestrator] Observing ${coin} every ${intervalMs / 1000}s`);
 await this.observeRegime(coin);
 const handle = setInterval(() => {
 this.observeRegime(coin).catch((err) =>
 this.logger.error(`[Orchestrator] Observation error (${coin}): ${err.message}`)
 );
 }, intervalMs);
 this._observers.set(coin, handle);
 return `Observing ${coin} regime every ${intervalMs / 1000}s`;
 }

 stopObservation(coin = null) {
 if (coin) {
 const h = this._observers.get(coin);
 if (h) { clearInterval(h); this._observers.delete(coin); }
 return;
 }
 for (const h of this._observers.values()) clearInterval(h);
 this._observers.clear();
 this.logger.info("[Orchestrator] All observation stopped");
 }

 async observeRegime(coin = "BTC") {
 try {
 const confirmed = await this.regimeDetector.getRegime(coin);
 const now = Date.now();

 // FIX: "unknown" is not a real regime; never store it or flip on it.
 const isReal = confirmed !== "hold" && confirmed !== "unknown";
 const prev = this._lastConfirmedRegime[coin] ?? null;
 const flipped = prev !== null && isReal && confirmed !== prev;

 if (isReal) this._lastConfirmedRegime[coin] = confirmed;

 this._regimeLog.push({ ts: now, coin, confirmed, flipped });
 if (this._regimeLog.length > 500) this._regimeLog.shift();

 if (flipped) {
 this.logger.warn(
 `[REGIME-OBSERVE] ${coin} FLIP ${prev} -> ${confirmed} (would switch in live mode)`
 );
 } else {
 this.logger.info(`[REGIME-OBSERVE] ${coin} = ${confirmed}`);
 }
 return confirmed;
 } catch (err) {
 this.logger.error(`[Orchestrator] Regime observation failed (${coin}): ${err.message}`);
 return "unknown";
 }
 }

 // FIX: flipRate now computed PER COIN so cross-coin contamination is impossible.
 regimeThrashStats() {
 const byCoin = {};
 for (const e of this._regimeLog) {
 const c = (byCoin[e.coin] ??= { total: 0, flips: 0, regimes: {} });
 c.total++;
 if (e.flipped) c.flips++;
 if (e.confirmed !== "hold" && e.confirmed !== "unknown") {
 c.regimes[e.confirmed] = (c.regimes[e.confirmed] || 0) + 1;
 }
 }
 for (const c of Object.values(byCoin)) {
 c.flipRate = c.total ? (c.flips / c.total).toFixed(3) : "0";
 }
 return {
 byCoin,
 lastRegime: { ...this._lastConfirmedRegime },
 totalObservations: this._regimeLog.length,
 };
 }

 getRegimeLog() { return [...this._regimeLog]; }

 exportReport() {
 return { phase: 3, mode: "observe-only", timestamp: Date.now(), stats: this.regimeThrashStats() };
 }
}

module.exports = StrategyOrchestrator;
