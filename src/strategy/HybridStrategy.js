const BBRSIStrategy = require("./BBRSIStrategy");
const GridStrategy = require("./GridStrategy");
const RegimeDetector = require("./RegimeDetector");
const FileStateStore = require("./FileStateStore"); // adjust path if needed

class HybridStrategy {
    constructor(logger, wayfinderCmds, baseStatePath = "./state") {
        this.logger = logger || console;
        this.wayfinder = wayfinderCmds;

        if (!this.wayfinder) {
            throw new Error("HybridStrategy requires a WayfinderCommander instance");
        }

        // Per-coin state
        this.coins = new Map(); // coin => { activeStrategy, lastRegimeChange, regimeConfirmation, ... }

        this.regimeDetector = new RegimeDetector(logger);

        // Global config
        this.defaultRegimeCooldownMs = 3 * 60 * 60 * 1000; // 3 hours (can be made asymmetric)
        this.requiredConfirmations = 3; // NEW: confirmation count
        this.minDataBars = 60;
    }

    // ==================== PER-COIN INITIALIZATION ====================
    _getOrCreateCoinState(coin) {
        if (!this.coins.has(coin)) {
            const stateStore = new FileStateStore(`${baseStatePath}/${coin}_hybrid.json`);

            const state = {
                coin,
                bbrsi: new BBRSIStrategy(this.logger, stateStore),
                grid: new GridStrategy(this.logger, this.wayfinder, { coin }),
                activeStrategy: null,
                currentRegime: 'UNKNOWN',
                lastRegimeChange: 0,
                regimeConfirmation: 0,
                lastUpdateTs: 0
            };

            // Give BBRSI access to wayfinder for execution
            state.bbrsi.wayfinder = this.wayfinder;

            this.coins.set(coin, state);
        }
        return this.coins.get(coin);
    }

    // ==================== MAIN UPDATE LOOP ====================
    async update(coin, ohlcv, currentPrice, currentPosition = null) {
        const state = this._getOrCreateCoinState(coin);

        if (!ohlcv || ohlcv.length < this.minDataBars) {
            return { action: 'HOLD', reason: 'Insufficient data', regime: 'UNKNOWN' };
        }

        // 1. Detect regime
        const regime = this.regimeDetector.detect(ohlcv);
        const newRegime = regime.type;

        // 2. Regime change logic with confirmation count
        const now = Date.now();
        let shouldSwitch = false;

        if (newRegime !== state.currentRegime) {
            state.regimeConfirmation++;
            if (state.regimeConfirmation >= this.requiredConfirmations) {
                const timeSinceLastSwitch = now - state.lastRegimeChange;
                if (timeSinceLastSwitch > this.defaultRegimeCooldownMs || state.activeStrategy === null) {
                    shouldSwitch = true;
                }
            }
        } else {
            state.regimeConfirmation = 0;
        }

        if (shouldSwitch) {
            await this._switchStrategy(state, newRegime, currentPrice, currentPosition);
            state.currentRegime = newRegime;
            state.lastRegimeChange = now;
            state.regimeConfirmation = 0;
        }

        // 3. Execute active strategy
        return await this._executeActiveStrategy(state, ohlcv, currentPrice, currentPosition);
    }

    // ==================== STRATEGY SWITCHING ====================
    async _switchStrategy(state, newRegime, currentPrice, currentPosition) {
        const desiredStrategy = this._decideStrategy(newRegime);

        if (state.activeStrategy === desiredStrategy) return;

        this.logger.info(`[Hybrid] Regime change detected: ${state.currentRegime} → ${newRegime} | Switching to ${desiredStrategy}`);

        // === Stop current strategy safely ===
        if (state.activeStrategy === 'GRID' && state.grid.active) {
            this.logger.info(`[Hybrid] Stopping Grid on ${state.coin}...`);
            const stopResult = await state.grid.stopGrid();

            // P0 Fix: Verify stop was successful
            const stillHasPosition = currentPosition && Math.abs(currentPosition.size || 0) > 0.0001;
            if (stillHasPosition || stopResult?.failedIds?.length > 0) {
                this.logger.error(`[Hybrid] WARNING: stopGrid may have failed. Position still open or failed orders.`);
                // Do not proceed with switch
                return;
            }
        }

        // === Start new strategy ===
        if (desiredStrategy === 'GRID') {
            await state.grid.startGrid(state.coin, currentPrice);
            state.activeStrategy = 'GRID';
        } 
        else if (desiredStrategy === 'BBRSI') {
            state.activeStrategy = 'BBRSI';
            // BBRSI is signal-based, no "start" needed
        } 
        else {
            state.activeStrategy = null; // HOLD
        }
    }

    _decideStrategy(regimeType) {
        if (regimeType === 'TRENDING') return 'BBRSI';
        if (regimeType === 'RANGING') return 'GRID';
        // P0 Fix: Safer defaults
        if (regimeType === 'HIGH_VOLATILITY') return 'HOLD'; // or 'GRID' depending on preference
        return 'HOLD'; // UNKNOWN → safe default
    }

    // ==================== EXECUTION ====================
    async _executeActiveStrategy(state, ohlcv, currentPrice, currentPosition) {
        if (!state.activeStrategy) {
            return { action: 'HOLD', regime: state.currentRegime, reason: 'No active strategy' };
        }

        if (state.activeStrategy === 'GRID') {
            // Grid manages itself via internal loop or we can call update
            if (typeof state.grid.update === 'function') {
                await state.grid.update(currentPrice, currentPosition);
            }
            return { action: 'GRID_RUNNING', regime: state.currentRegime, strategy: 'GRID' };
        }

        if (state.activeStrategy === 'BBRSI') {
            // P0 Fix: Correct call signature
            const equity = await this.wayfinder.getAvailableMargin?.() || 0;
            const posInfo = currentPosition || { side: null, entryPrice: null, unrealizedPnlPct: 0 };

            const result = await state.bbrsi.evaluatePosition(
                ohlcv,
                posInfo.side,
                equity,
                posInfo.entryPrice,
                posInfo.unrealizedPnlPct || 0
            );

            // P0 Fix: Actually execute the signal
            if (result && result.signal && result.signal !== 'NONE') {
                return await this._executeBBSRISignal(state, result, currentPrice);
            }

            return { action: 'HOLD', regime: state.currentRegime, strategy: 'BBRSI', bbrsiResult: result };
        }

        return { action: 'HOLD', regime: state.currentRegime };
    }

    async _executeBBSRISignal(state, signalResult, currentPrice) {
        const { signal, positionSize, stopLoss, takeProfit } = signalResult;

        try {
            if (signal === 'LONG' || signal === 'SHORT') {
                const isBuy = signal === 'LONG';
                await this.wayfinder.placeOrder({
                    coin: state.coin,
                    isBuy,
                    size: positionSize,
                    price: currentPrice, // or use limit/market as preferred
                    reduceOnly: false
                });

                this.logger.info(`[Hybrid] BBRSI executed ${signal} on ${state.coin}`);

                return { action: signal, regime: state.currentRegime, strategy: 'BBRSI', executed: true };
            }

            if (signal.startsWith('CLOSE')) {
                await this.wayfinder.closePosition(state.coin);
                if (typeof state.bbrsi.notifyExit === 'function') {
                    state.bbrsi.notifyExit(Date.now());
                }
                return { action: signal, regime: state.currentRegime, strategy: 'BBRSI', executed: true };
            }
        } catch (err) {
            this.logger.error(`[Hybrid] Failed to execute BBRSI signal: ${err.message}`);
        }

        return { action: 'HOLD', regime: state.currentRegime, strategy: 'BBRSI', error: 'Execution failed' };
    }

    // ==================== UTILITIES ====================
    async forceStrategy(coin, strategy) {
        const state = this._getOrCreateCoinState(coin);
        // Force bypasses cooldown
        state.lastRegimeChange = 0;
        await this._switchStrategy(state, strategy === 'GRID' ? 'RANGING' : 'TRENDING', null, null);
        state.activeStrategy = strategy;
    }

    getStatus(coin) {
        const state = this.coins.get(coin);
        if (!state) return null;

        return {
            coin,
            activeStrategy: state.activeStrategy,
            currentRegime: state.currentRegime,
            regimeConfirmation: state.regimeConfirmation,
            gridActive: state.grid?.active || false
        };
    }

    async shutdown() {
        for (const [coin, state] of this.coins) {
            if (state.grid?.active) await state.grid.stopGrid();
            if (typeof state.bbrsi.shutdown === 'function') state.bbrsi.shutdown();
        }
    }
}

module.exports = HybridStrategy;
