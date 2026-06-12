// src/strategy/HybridStrategy.js
const BBRSIStrategy = require('./BBRSIStrategy');
const GridStrategy = require('./GridStrategy');
const RegimeDetector = require('./RegimeDetector');
const { Guardrails } = require('../risk/Guardrails');

class HybridStrategy {
    constructor(logger, wayfinder) {
        this.logger = logger || console;
        this.wayfinder = wayfinder;

        this.regimeDetector = new RegimeDetector(this.logger);
        this.guardrails = new Guardrails();

        // Multi-coin support
        this.coins = new Map(); // coin -> { bbrsi, grid, activeStrategy, currentRegime, lastChange }

        this.regimeChangeCooldownMs = 1000 * 60 * 60 * 3;
    }

    // Initialize a coin
    initCoin(coin) {
        if (this.coins.has(coin)) return;

        this.coins.set(coin, {
            bbrsi: new BBRSIStrategy(this.logger),
            grid: new GridStrategy(this.logger, this.wayfinder),
            activeStrategy: null,
            currentRegime: 'UNKNOWN',
            lastRegimeChange: 0
        });

        this.logger.info(`[HYBRID] Initialized coin: ${coin}`);
    }

    async update(coin, currentPrice, ohlcvData) {
        if (!this.coins.has(coin)) this.initCoin(coin);

        const state = this.coins.get(coin);

        // Guardrails check (portfolio level or per coin)
        const equity = this.wayfinder.getAvailableMargin() || 10000;
        if (!this.guardrails.isSafe(equity)) {
            this.logger.warn(`[HYBRID] Guardrail breached on ${coin}`);
            await state.grid.stopGrid();
            return;
        }

        const regime = this.regimeDetector.detect(ohlcvData);
        const previousRegime = state.currentRegime;
        state.currentRegime = regime.type;

        const desired = this._decideStrategy(regime);

        if (desired !== state.activeStrategy) {
            await this._switchStrategy(coin, state, desired, previousRegime);
        }

        // Execute active strategy
        if (state.activeStrategy === 'BBRSI' || state.activeStrategy === 'BOTH') {
            await state.bbrsi.evaluatePosition(ohlcvData);
        }
        if (state.activeStrategy === 'GRID' || state.activeStrategy === 'BOTH') {
            await state.grid.update(currentPrice);
        }
    }

    _decideStrategy(regime) {
        if (regime.type === 'TRENDING' && regime.adx > 26) return 'BBRSI';
        if (regime.type === 'RANGING') return 'GRID';
        return 'BBRSI';
    }

    async _switchStrategy(coin, state, newStrategy, previousRegime) {
        const now = Date.now();
        if (now - state.lastRegimeChange < this.regimeChangeCooldownMs) return;

        this.logger.warn(`[HYBRID] ${coin}: Switching ${state.activeStrategy} → ${newStrategy} (${previousRegime} → ${state.currentRegime})`);

        if (state.activeStrategy === 'GRID') await state.grid.stopGrid();
        if (newStrategy === 'GRID') await state.grid.startGrid(coin);

        state.activeStrategy = newStrategy;
        state.lastRegimeChange = now;
    }

    getStatus(coin = null) {
        if (coin) {
            const state = this.coins.get(coin);
            return state ? { coin, ...state } : null;
        }
        // Return status for all coins
        const status = {};
        for (const [c, s] of this.coins) {
            status[c] = {
                activeStrategy: s.activeStrategy,
                currentRegime: s.currentRegime
            };
        }
        return status;
    }

    async forceStrategy(coin, strategy) {
        if (!this.coins.has(coin)) this.initCoin(coin);
        const state = this.coins.get(coin);
        await this._switchStrategy(coin, state, strategy, state.currentRegime);
    }
}

module.exports = HybridStrategy;
