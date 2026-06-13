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
            gridMaxAllocation: capitalConfig.gridMaxAllocation || 0.6, // 60% max to Grid
            bbrsiMaxAllocation: capitalConfig.bbrsiMaxAllocation || 0.8, // 80% max to BBRSI
            minCapitalPerStrategy: capitalConfig.minCapitalPerStrategy || 500,
            ...capitalConfig
        };

        this.allocatedCapital = {
            GRID: 0,
            BBRSI: 0
        };
    }

    _getMaxCapitalForStrategy(strategy) {
        const total = this.capitalConfig.totalBudget;
        if (strategy === 'GRID') {
            return Math.max(
                this.capitalConfig.minCapitalPerStrategy,
                total * this.capitalConfig.gridMaxAllocation
            );
        }
        if (strategy === 'BBRSI') {
            return Math.max(
                this.capitalConfig.minCapitalPerStrategy,
                total * this.capitalConfig.bbrsiMaxAllocation
            );
        }
        return total * 0.5;
    }

    _updateCapitalAllocation(strategy, amount) {
        this.allocatedCapital[strategy] = amount;
    }

    getCapitalStatus() {
        return {
            totalBudget: this.capitalConfig.totalBudget,
            allocated: { ...this.allocatedCapital },
            available: this.capitalConfig.totalBudget -
                (this.allocatedCapital.GRID + this.allocatedCapital.BBRSI)
        };
    }

    /**
     * Gets or creates per-coin state including strategy instances
     * @param {string} coin - Coin symbol (e.g., 'BTC-PERP')
     * @returns {Object} Coin state object
     */
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

    /**
     * Main update loop - detects regime and manages strategy switching
     * @param {string} coin - Coin symbol
     * @param {Array} ohlcv - OHLCV candle data
     * @param {number} currentPrice - Current market price
     * @param {Object} currentPosition - Current position info (optional)
     * @returns {Object} Action result with regime, strategy, and thresholds
     */
    async update(coin, ohlcv, currentPrice, currentPosition = null) {
        try {
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
        } catch (error) {
            this.logger.error(`[${coin}] Hybrid update failed:`, error.message);
            return { action: 'HOLD', regime: 'UNKNOWN', reason: 'Internal error', error: error.message };
        }
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

    // Claude P1: Don't keep running stale strategy aggressively during cooldown
    _handleStaleStrategy(state, newRegime) {
        if (state.activeStrategy === 'GRID' && newRegime === 'TRENDING') {
            state.pauseAggressiveRisk = true;
            this.logger.warn(`[${state.coin}] Cooldown active — pausing new Grid entries (trend detected)`);
        }
    }

    /**
     * Switches between strategies (GRID ↔ BBRSI) with proper cleanup
     * @param {Object} state - Coin state object
     * @param {string} newRegime - Target regime (TRENDING/RANGING)
     * @param {number} currentPrice - Current market price
     * @param {Object} currentPosition - Current position info
     */
    async _switchStrategy(state, newRegime, currentPrice, currentPosition) {
        const desired = this._decideStrategy(newRegime);

        if (state.activeStrategy === desired) return;

        this.logger.info(`[${state.coin}] Regime: ${state.currentRegime} → ${newRegime} | Switching to ${desired}`);

        if (state.activeStrategy === 'GRID' && state.grid.active) {
            await state.grid.stopGrid();

            // Re-query after stopGrid to verify position is closed
            const afterStop = await this.wayfinder.getPosition(state.coin);
            const stillOpen = afterStop && Math.abs(afterStop.size || 0) > 0.0001;

            if (stillOpen) {
                this.logger.error(`[${state.coin}] stopGrid failed to close position. Aborting switch.`);
                return;
            }
        }

        if (desired === 'GRID') {
            const maxCapital = this._getMaxCapitalForStrategy('GRID');
            this._updateCapitalAllocation('GRID', maxCapital);

            await state.grid.startGrid(state.coin, currentPrice, {
                maxCapital,
                disableInternalLoop: true
            });
            state.activeStrategy = 'GRID';
        } else if (desired === 'BBRSI') {
            const maxCapital = this._getMaxCapitalForStrategy('BBRSI');
            this._updateCapitalAllocation('BBRSI', maxCapital);
            state.activeStrategy = 'BBRSI';
        } else {
            state.activeStrategy = null;
            this._updateCapitalAllocation('GRID', 0);
            this._updateCapitalAllocation('BBRSI', 0);
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
                const signalResult = await this._executeBBSRISignal(state, result, currentPrice, currentPosition);
                return { ...signalResult, thresholds };
            }

            return { action: 'HOLD', regime: state.currentRegime, strategy: 'BBRSI', bbrsiResult: result, thresholds };
        }

        return { action: 'HOLD', regime: state.currentRegime, thresholds };
    }

    async _executeBBSRISignal(state, signalResult, currentPrice, currentPosition) {
        const { signal, positionSize, stopLoss, takeProfit } = signalResult;

        try {
            if (signal === 'LONG' || signal === 'SHORT') {
                const isBuy = signal === 'LONG';

                // Place main order
                await this.wayfinder.placeOrder({
                    coin: state.coin,
                    isBuy,
                    size: positionSize,
                    price: currentPrice
                });

                // Place protective stop-loss if provided
                if (stopLoss && this.wayfinder.placeOrder) {
                    try {
                        await this.wayfinder.placeOrder({
                            coin: state.coin,
                            isBuy: !isBuy, // opposite side
                            size: positionSize,
                            price: stopLoss,
                            reduceOnly: true
                        });
                    } catch (err) {
                        this.logger.warn(`[${state.coin}] Failed to place stop-loss:`, err.message);
                    }
                }

                // Place take-profit if provided
                if (takeProfit && this.wayfinder.placeOrder) {
                    try {
                        await this.wayfinder.placeOrder({
                            coin: state.coin,
                            isBuy: !isBuy,
                            size: positionSize,
                            price: takeProfit,
                            reduceOnly: true
                        });
                    } catch (err) {
                        this.logger.warn(`[${state.coin}] Failed to place take-profit:`, err.message);
                    }
                }

                return { action: signal, regime: state.currentRegime, strategy: 'BBRSI', executed: true };
            }

            if (signal.startsWith('CLOSE')) {
                // Calculate realized PnL before closing (best effort)
                let realizedPnl = 0;
                if (currentPosition && currentPosition.entryPrice) {
                    const entry = currentPosition.entryPrice;
                    const exit = currentPrice;
                    const size = currentPosition.size || 0;
                    realizedPnl = (exit - entry) * size * (currentPosition.side === 'LONG' ? 1 : -1);
                }

                await this.wayfinder.closePosition(state.coin);

                if (typeof state.bbrsi.notifyExit === 'function') {
                    state.bbrsi.notifyExit(Date.now(), realizedPnl);
                }
                return { action: signal, regime: state.currentRegime, strategy: 'BBRSI', executed: true };
            }
        } catch (err) {
            this.logger.error(`[${state.coin}] BBRSI execution error:`, err.message);
        }

        return { action: 'HOLD', regime: state.currentRegime, strategy: 'BBRSI' };
    }

    /**
     * Forces a strategy switch (bypasses cooldown and confirmation)
     * @param {string} coin - Coin symbol
     * @param {string} strategy - Target strategy ('GRID' or 'BBRSI')
     */
    async forceStrategy(coin, strategy) {
        const state = this._getOrCreateCoinState(coin);
        state.lastRegimeChange = 0; // bypass cooldown

        // Get current price if possible
        let price = null;
        try {
            price = await this.wayfinder.getPrice(coin);
        } catch (e) {
            this.logger.warn(`[${coin}] Could not fetch price for forceStrategy`);
        }

        await this._switchStrategy(state, strategy === 'GRID' ? 'RANGING' : 'TRENDING', price, null);
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
