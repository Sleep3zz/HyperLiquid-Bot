/**
 * Strategy Orchestrator - Phase 3: Regime Observation
 * 
 * Wires RegimeDetector as read-only logger to observe market regime
 * without trading. Tracks regime flips for thrash analysis.
 * 
 * Phase 3 Goal: Build confidence in regime detection before it controls trades.
 * Run for 2-3 days, then check regimeThrashStats().
 */

const BBRSIStrategy = require("./strategy/BBRSIStrategy");
const GridStrategy = require("./strategy/GridStrategy");
const RegimeDetector = require("./strategy/RegimeDetector");

class StrategyOrchestrator {
    constructor(wayfinder, logger = console) {
        this.wayfinder = wayfinder;
        this.logger = logger;

        // Strategies
        this.bbrsi = new BBRSIStrategy(wayfinder, logger);
        this.grid = new GridStrategy(logger, wayfinder);

        // Phase 3: Regime detection (observe-only)
        this.regimeDetector = new RegimeDetector(this.bbrsi, logger, "15m");
        
        // Observation state
        this._regimeLog = []; // rolling history for thrash analysis
        this._lastConfirmedRegime = null;
        this._observeInterval = null;

        this.logger.info("[Orchestrator] Phase 3 initialized - regime observation mode");
    }

    /**
     * Start Phase 3 observation
     * @param {string} coin - Coin to observe (default: BTC)
     * @param {number} intervalMs - Observation interval (default: 15 min = 900000ms)
     */
    startObservation(coin = "BTC", intervalMs = 900000) {
        this.logger.info(`[Orchestrator] Starting regime observation for ${coin} every ${intervalMs/1000}s`);
        
        // Initial observation
        this.observeRegime(coin);
        
        // Periodic observation
        this._observeInterval = setInterval(() => {
            this.observeRegime(coin);
        }, intervalMs);

        return `Observing ${coin} regime every ${intervalMs/1000}s`;
    }

    stopObservation() {
        if (this._observeInterval) {
            clearInterval(this._observeInterval);
            this._observeInterval = null;
            this.logger.info("[Orchestrator] Observation stopped");
        }
    }

    /**
     * Phase 3: OBSERVE ONLY. Call on each new candle (e.g., every 15m).
     * Logs the regime and tracks flips. Does NOT start/stop the grid.
     */
    async observeRegime(coin = "BTC") {
        try {
            const confirmed = await this.regimeDetector.getRegime(coin);

            const now = Date.now();
            const prev = this._lastConfirmedRegime;
            const flipped = prev !== null && confirmed !== prev && confirmed !== "hold";

            if (confirmed !== "hold") {
                this._lastConfirmedRegime = confirmed;
            }

            this._regimeLog.push({ ts: now, coin, confirmed, flipped });
            if (this._regimeLog.length > 500) this._regimeLog.shift(); // bound memory

            if (flipped) {
                this.logger.warn(
                    `[REGIME-OBSERVE] ${coin} FLIP ${prev} -> ${confirmed} ` +
                    `(would switch strategy in live mode)`
                );
            }

            return confirmed;
        } catch (err) {
            this.logger.error(`[Orchestrator] Regime observation failed: ${err.message}`);
            return "unknown";
        }
    }

    /**
     * Quick thrash report: flips per N observations.
     * @returns {Object} flip stats
     */
    regimeThrashStats() {
        const flips = this._regimeLog.filter(e => e.flipped).length;
        const total = this._regimeLog.length;
        const byRegime = {};
        
        // Count time spent in each regime
        for (const entry of this._regimeLog) {
            if (entry.confirmed !== "hold") {
                byRegime[entry.confirmed] = (byRegime[entry.confirmed] || 0) + 1;
            }
        }

        return {
            flips,
            total,
            flipRate: total ? (flips / total).toFixed(3) : "0",
            byRegime,
            lastRegime: this._lastConfirmedRegime,
            recentLog: this._regimeLog.slice(-10) // last 10 observations
        };
    }

    /**
     * Get full regime log (for analysis)
     */
    getRegimeLog() {
        return [...this._regimeLog];
    }

    /**
     * Export observation report
     */
    exportReport() {
        const stats = this.regimeThrashStats();
        return {
            phase: 3,
            mode: "observe-only",
            timestamp: Date.now(),
            stats,
            fullLog: this._regimeLog
        };
    }
}

module.exports = StrategyOrchestrator;
