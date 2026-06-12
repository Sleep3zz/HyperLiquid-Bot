const { BBRSIStrategy } = require("./BBRSIStrategy");
const GridStrategy = require("./GridStrategy");
const RegimeDetector = require("./RegimeDetector");

class HybridStrategy {
    constructor(logger, wayfinderCmds, baseStatePath = "./state") {
        this.logger = logger || console;
        this.wayfinder = wayfinderCmds;
        this.baseStatePath = baseStatePath; // ← Fixed: now stored as instance variable

        if (!this.wayfinder) {
            throw new Error("HybridStrategy requires a WayfinderCommander instance");
        }

        this.coins = new Map();
        this.regimeDetector = new RegimeDetector(logger);

        this.defaultRegimeCooldownMs = 3 * 60 * 60 * 1000;
        this.requiredConfirmations = 3;
        this.minDataBars = 60;
    }

    _getOrCreateCoinState(coin) {
        if (!this.coins.has(coin)) {
            // Use this.baseStatePath instead of the local variable
            const stateFile = `${this.baseStatePath}/${coin}_hybrid.json`;
            let stateStore = null;

            try {
                const FileStateStore = require("./FileStateStore");
                stateStore = new FileStateStore(stateFile);
            } catch (e) {
                // Fallback if FileStateStore doesn't exist yet
                this.logger.warn("FileStateStore not found, running without persistence");
            }

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

            state.bbrsi.wayfinder = this.wayfinder;
            this.coins.set(coin, state);
        }
        return this.coins.get(coin);
    }

    async update(coin, ohlcv, currentPrice, currentPosition = null) {
        const state = this._getOrCreateCoinState(coin);

        if (!ohlcv || ohlcv.length < this.minDataBars) {
            return { action: 'HOLD', reason: 'Insufficient data', regime: 'UNKNOWN' };
        }

        const regime = this.regimeDetector.detect(ohlcv);
        const newRegime = regime.type;
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

        return await this._executeActiveStrategy(state, ohlcv, currentPrice, currentPosition);
    }

    async _switchStrategy(state, newRegime, currentPrice, currentPosition) {
        const desiredStrategy = this._decideStrategy(newRegime);

        if (state.activeStrategy === desiredStrategy) return;

        this.logger.info(`[Hybrid] Regime: ${state.currentRegime} → ${newRegime} | Switching to ${desiredStrategy}`);

        if (state.activeStrategy === 'GRID' && state.grid.active) {
            this.logger.info(`[Hybrid] Stopping Grid on ${state.coin}...`);
            const stopResult = await state.grid.stopGrid();

            const stillHasPosition = currentPosition && Math.abs(currentPosition.size || 0) > 0.0001;
            if (stillHasPosition || (stopResult && stopResult.failedIds && stopResult.failedIds.length > 0)) {
                this.logger.error(`[Hybrid] stopGrid may have failed. Aborting switch.`);
                return;
            }
        }

        if (desiredStrategy === 'GRID') {
            await state.grid.startGrid(state.coin, currentPrice);
            state.activeStrategy = 'GRID';
        } else if (desiredStrategy === 'BBRSI') {
            state.activeStrategy = 'BBRSI';
        } else {
            state.activeStrategy = null;
        }
    }

    _decideStrategy(regimeType) {
        if (regimeType === 'TRENDING') return 'BBRSI';
        if (regimeType === 'RANGING') return 'GRID';
        return 'HOLD';
    }

    async _executeActiveStrategy(state, ohlcv, currentPrice, currentPosition) {
        if (!state.activeStrategy) {
            return { action: 'HOLD', regime: state.currentRegime, reason: 'No active strategy' };
        }

        if (state.activeStrategy === 'GRID') {
            if (typeof state.grid.update === 'function') {
                await state.grid.update(currentPrice, currentPosition);
            }
            return { action: 'GRID_RUNNING', regime: state.currentRegime, strategy: 'GRID' };
        }

        if (state.activeStrategy === 'BBRSI') {
            const equity = await this.wayfinder.getAvailableMargin?.() || 0;
            const posInfo = currentPosition || { side: null, entryPrice: null, unrealizedPnlPct: 0 };

            const result = await state.bbrsi.evaluatePosition(
                ohlcv,
                posInfo.side,
                equity,
                posInfo.entryPrice,
                posInfo.unrealizedPnlPct || 0
            );

            if (result && result.signal && result.signal !== 'NONE') {
                return await this._executeBBSRISignal(state, result, currentPrice);
            }

            return { action: 'HOLD', regime: state.currentRegime, strategy: 'BBRSI', bbrsiResult: result };
        }

        return { action: 'HOLD', regime: state.currentRegime };
    }

    async _executeBBSRISignal(state, signalResult, currentPrice) {
        const { signal, positionSize } = signalResult;

        try {
            if (signal === 'LONG' || signal === 'SHORT') {
                const isBuy = signal === 'LONG';
                await this.wayfinder.placeOrder({
                    coin: state.coin,
                    isBuy,
                    size: positionSize,
                    price: currentPrice
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
            this.logger.error(`[Hybrid] BBRSI execution failed: ${err.message}`);
        }

        return { action: 'HOLD', regime: state.currentRegime, strategy: 'BBRSI' };
    }

    async forceStrategy(coin, strategy) {
        const state = this._getOrCreateCoinState(coin);
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
        for (const [, state] of this.coins) {
            if (state.grid?.active) await state.grid.stopGrid();
            if (typeof state.bbrsi.shutdown === 'function') state.bbrsi.shutdown();
        }
    }
}

module.exports = HybridStrategy;
