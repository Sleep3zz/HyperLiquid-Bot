const BBRSIStrategy = require("./BBRSIStrategy");
const GridStrategy = require("./GridStrategy");
const RegimeDetector = require("./RegimeDetector");

class HybridStrategy {
    constructor(logger, wayfinderCmds, baseStatePath = "./state", regimeConfig = {}, capitalConfig = {}) {
        this.logger = logger || console;
        this.wayfinder = wayfinderCmds;
        this.baseStatePath = baseStatePath;
        this.regimeConfig = regimeConfig;

        if (!this.wayfinder) {
            throw new Error("HybridStrategy requires a Wayfinder instance");
        }

        this.coins = new Map();

        // === Asymmetric Cooldowns (Claude P1) ===
        this.cooldowns = {
            gridToTrend: 15 * 60 * 1000, // 15 minutes - urgent to escape grid
            trendToGrid: 3 * 60 * 60 * 1000 // 3 hours - conservative
        };

        this.requiredConfirmations = 3;
        this.minDataBars = 60;

        // === Global Capital Budget ===
        this.capitalConfig = {
            totalBudget: capitalConfig.totalBudget || 10000,
            gridAllocation: capitalConfig.gridAllocation || 0.6, // 60% max to Grid
            bbrsiAllocation: capitalConfig.bbrsiAllocation || 0.8, // 80% max to BBRSI
            ...capitalConfig
        };

        this.currentAllocatedCapital = {
            GRID: 0,
            BBRSI: 0
        };
    }

    _getOrCreateCoinState(coin) {
        if (!this.coins.has(coin)) {
            const stateFile = `${this.baseStatePath}/${coin}_hybrid.json`;
            let stateStore = null;

            try {
                const FileStateStore = require("./FileStateStore");
                stateStore = new FileStateStore(stateFile);
            } catch (e) {
                this.logger.warn(`FileStateStore not available for ${coin}`);
            }

            const state = {
                coin,
                bbrsi: new BBRSIStrategy(this.logger, stateStore),
                grid: new GridStrategy(this.logger, this.wayfinder, { coin }),
                regimeDetector: new RegimeDetector(this.logger, this.regimeConfig),
                activeStrategy: null,
                currentRegime: 'UNKNOWN',
                lastRegimeChange: 0,
                regimeConfirmation: 0,
                pendingRegime: null,
                pauseAggressiveRisk: false
            };

            state.bbrsi.wayfinder = this.wayfinder;
            this.coins.set(coin, state);
        }
        return this.coins.get(coin);
    }

    async update(coin, ohlcv, currentPrice, currentPosition = null) {
        const state = this._getOrCreateCoinState(coin);

        if (!ohlcv || ohlcv.length < this.minDataBars) {
            return { action: 'HOLD', regime: 'UNKNOWN', reason: 'Insufficient data' };
        }

        const regimeResult = state.regimeDetector.detect(ohlcv);
        const newRegime = regimeResult.type;
        const now = Date.now();

        // Check if we should attempt a switch
        const timeSinceLastSwitch = now - state.lastRegimeChange;
        const cooldown = this._getCooldownDuration(state.currentRegime, newRegime);

        let shouldSwitch = false;

        if (newRegime !== state.currentRegime) {
            state.regimeConfirmation++;

            if (state.regimeConfirmation >= this.requiredConfirmations) {
                if (timeSinceLastSwitch > cooldown || state.activeStrategy === null) {
                    shouldSwitch = true;
                } else {
                    // Still in cooldown → handle stale strategy
                    this._handleStaleStrategy(state, newRegime);
                }
            }
        } else {
            state.regimeConfirmation = 0;
            state.pauseAggressiveRisk = false;
        }

        if (shouldSwitch) {
            await this._switchStrategy(state, newRegime, currentPrice, currentPosition);
            state.currentRegime = newRegime;
            state.lastRegimeChange = now;
            state.regimeConfirmation = 0;
            state.pauseAggressiveRisk = false;
        }

        return await this._executeActiveStrategy(state, ohlcv, currentPrice, currentPosition, regimeResult);
    }

    _getCooldownDuration(fromRegime, toRegime) {
        if (fromRegime === 'RANGING' && toRegime === 'TRENDING') {
            return this.cooldowns.gridToTrend; // Short cooldown
        }
        if (fromRegime === 'TRENDING' && toRegime === 'RANGING') {
            return this.cooldowns.trendToGrid; // Long cooldown
        }
        return this.cooldowns.trendToGrid; // Default to conservative
    }

    _getAvailableCapitalForStrategy(strategy) {
        const total = this.capitalConfig.totalBudget;
        if (strategy === 'GRID') {
            return total * this.capitalConfig.gridAllocation;
        }
        if (strategy === 'BBRSI') {
            return total * this.capitalConfig.bbrsiAllocation;
        }
        return total * 0.5;
    }

    // Claude P1: Don't keep running stale strategy aggressively during cooldown
    _handleStaleStrategy(state, newRegime) {
        if (state.activeStrategy === 'GRID' && newRegime === 'TRENDING') {
            state.pauseAggressiveRisk = true;
            this.logger.warn(`[${state.coin}] Cooldown active — pausing new Grid entries (trend detected)`);
        }
    }

    async _switchStrategy(state, newRegime, currentPrice, currentPosition) {
        const desired = this._decideStrategy(newRegime);

        if (state.activeStrategy === desired) return;

        this.logger.info(`[${state.coin}] Regime change: ${state.currentRegime} → ${newRegime} | Switching to ${desired}`);

        // Stop current strategy safely
        if (state.activeStrategy === 'GRID' && state.grid.active) {
            const stopResult = await state.grid.stopGrid();

            const stillOpen = currentPosition && Math.abs(currentPosition.size || 0) > 0.0001;
            if (stillOpen) {
                this.logger.error(`[${state.coin}] stopGrid may have failed. Not switching yet.`);
                return;
            }
        }

        // Start new strategy
        if (desired === 'GRID') {
            // Prevent Grid from starting its own internal loop (single heartbeat from HybridStrategy)
            state.grid._startUpdateLoop = () => {};

            const maxCapital = this._getAvailableCapitalForStrategy('GRID');
            await state.grid.startGrid(state.coin, currentPrice, { maxCapital });
            state.activeStrategy = 'GRID';
            this.currentAllocatedCapital.GRID = maxCapital;
        } else if (desired === 'BBRSI') {
            state.activeStrategy = 'BBRSI';
            this.currentAllocatedCapital.BBRSI = this._getAvailableCapitalForStrategy('BBRSI');
        } else {
            state.activeStrategy = null;
            this.currentAllocatedCapital.GRID = 0;
            this.currentAllocatedCapital.BBRSI = 0;
        }
    }

    _decideStrategy(regime) {
        if (regime === 'TRENDING') return 'BBRSI';
        if (regime === 'RANGING') return 'GRID';
        return 'HOLD'; // UNKNOWN or HIGH_VOLATILITY
    }

    async _executeActiveStrategy(state, ohlcv, currentPrice, currentPosition, regimeResult) {
        const thresholds = regimeResult?.thresholds || null;

        if (!state.activeStrategy) {
            return { action: 'HOLD', regime: state.currentRegime, thresholds };
        }

        if (state.activeStrategy === 'GRID') {
            if (state.pauseAggressiveRisk) {
                return { action: 'HOLD', regime: state.currentRegime, reason: 'Cooldown - Grid risk paused', thresholds };
            }
            if (typeof state.grid.update === 'function') {
                await state.grid.update(currentPrice, currentPosition);
            }
            return { action: 'GRID_RUNNING', regime: state.currentRegime, strategy: 'GRID', thresholds };
        }

        if (state.activeStrategy === 'BBRSI') {
            const equity = await this.wayfinder.getAvailableMargin?.() || 0;
            const posInfo = currentPosition || { side: null, entryPrice: null, unrealizedPnlPct: 0 };

            const result = await state.bbrsi.evaluatePosition(
                ohlcv, posInfo.side, equity, posInfo.entryPrice, posInfo.unrealizedPnlPct || 0
            );

            if (result?.signal && result.signal !== 'NONE') {
                const signalResult = await this._executeBBSRISignal(state, result, currentPrice);
                return { ...signalResult, thresholds };
            }

            return { action: 'HOLD', regime: state.currentRegime, strategy: 'BBRSI', bbrsiResult: result, thresholds };
        }

        return { action: 'HOLD', regime: state.currentRegime, thresholds };
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
            this.logger.error(`[${state.coin}] BBRSI execution error:`, err.message);
        }

        return { action: 'HOLD', regime: state.currentRegime, strategy: 'BBRSI' };
    }

    async forceStrategy(coin, strategy) {
        const state = this._getOrCreateCoinState(coin);
        state.lastRegimeChange = 0;
        await this._switchStrategy(state, strategy === 'GRID' ? 'RANGING' : 'TRENDING', null, null);
    }

    getStatus(coin) {
        const state = this.coins.get(coin);
        if (!state) return null;

        return {
            coin,
            activeStrategy: state.activeStrategy,
            currentRegime: state.currentRegime,
            pauseAggressiveRisk: state.pauseAggressiveRisk,
            regimeConfirmation: state.regimeConfirmation
        };
    }

    async shutdown() {
        for (const [, state] of this.coins) {
            if (state.grid?.active) await state.grid.stopGrid();
            if (typeof state.bbrsi.shutdown === 'function') await state.bbrsi.shutdown();
        }
    }
}

module.exports = HybridStrategy;
