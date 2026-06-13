const HybridStrategy = require('./src/strategy/HybridStrategy');
const DataProvider = require('./src/data/data-provider');

class HybridPaperTrader {
    constructor(coin = 'BTC-PERP', options = {}) {
        this.coin = coin;
        this.logger = options.logger || console;
        this.initialCapital = options.initialCapital || 1000;

        this.config = {
            checkInterval: options.checkInterval || 60000,
            maxLeverage: options.maxLeverage || 5,
            riskPerTrade: options.riskPerTrade || 0.02,
            timeframe: options.timeframe || '1m',
            dailyLossLimit: options.dailyLossLimit || 0.05, // 5%
            maxDailySwitches: options.maxDailySwitches || 8,
            autoResumeAfterMinutes: options.autoResumeAfterMinutes || 0, // 0 = disabled
            ...options
        };

        this.wayfinder = options.wayfinder;
        this.dataProvider = options.dataProvider || new DataProvider('./data', this.wayfinder);
        this.engine = options.engine;

        this.hybrid = new HybridStrategy(
            this.logger,
            this.wayfinder,
            `./state/${coin.toLowerCase().replace(/-/g, '_')}`
        );

        // === Circuit Breaker State ===
        this.dailyStartEquity = this.initialCapital;
        this.dailyPnL = 0;
        this.dailySwitches = 0;
        this.lastResetDay = new Date().getUTCDate();
        this.tradingPaused = false;
        this.pauseReason = null;
        this.pauseTimestamp = null;

        this.lastRegime = null;
        this.isRunning = false;
        this.intervalId = null;
    }

    _resetDailyStatsIfNeeded() {
        const currentDay = new Date().getUTCDate();
        if (currentDay !== this.lastResetDay) {
            this.dailyStartEquity = this._getCurrentEquity();
            this.dailyPnL = 0;
            this.dailySwitches = 0;
            this.tradingPaused = false;
            this.pauseReason = null;
            this.lastResetDay = currentDay;
            this.logger.info(`[${this.coin}] Daily stats reset. Starting equity: $${this.dailyStartEquity.toFixed(2)}`);
        }
    }

    _getCurrentEquity() {
        if (this.engine && typeof this.engine.getPortfolio === 'function') {
            const portfolio = this.engine.getPortfolio();
            return portfolio?.equity || this.initialCapital;
        }
        return this.initialCapital;
    }

    _updateDailyPnL() {
        const currentEquity = this._getCurrentEquity();
        this.dailyPnL = currentEquity - this.dailyStartEquity;
    }

    async fetchOHLCV(symbol, limit = 150) {
        return await this.dataProvider.getCandles(symbol, this.config.timeframe, limit);
    }

    async runCycle() {
        this._resetDailyStatsIfNeeded();
        this._updateDailyPnL();

        // Check auto-resume
        if (this.tradingPaused && this.config.autoResumeAfterMinutes > 0) {
            const minutesPaused = (Date.now() - (this.pauseTimestamp || 0)) / (1000 * 60);
            if (minutesPaused >= this.config.autoResumeAfterMinutes) {
                this.resumeTrading("Auto-resume after timeout");
            }
        }

        if (this.tradingPaused) {
            this.logger.warn(`[${this.coin}] Trading PAUSED (${this.pauseReason})`);
            return;
        }

        try {
            const currentPrice = await this.wayfinder.getPrice(this.coin);
            if (!currentPrice) return;

            const ohlcv = await this.fetchOHLCV(this.coin);
            const currentPosition = this.engine?.getPosition?.(this.coin) || null;

            const result = await this.hybrid.update(this.coin, ohlcv, currentPrice, currentPosition);
            const status = this.hybrid.getStatus(this.coin);

            // Track switches
            if (this.lastRegime && this.lastRegime !== result.regime) {
                this.dailySwitches++;
            }
            this.lastRegime = result.regime;

            this.logger.info(
                `[${this.coin}] ${result.regime} | ${result.strategy || 'N/A'} | ${result.action} | ` +
                `Daily PnL: $${this.dailyPnL.toFixed(2)} | Switches: ${this.dailySwitches}`
            );

            // === Circuit Breaker Checks ===
            const lossLimit = this.initialCapital * this.config.dailyLossLimit;

            if (this.dailyPnL <= -lossLimit) {
                this._pauseTrading(`Daily loss limit reached ($${this.dailyPnL.toFixed(2)})`);
                return;
            }

            if (this.dailySwitches >= this.config.maxDailySwitches) {
                this._pauseTrading(`Max daily switches reached (${this.dailySwitches})`);
                return;
            }

            // Execute trade
            if (result.action && result.action !== 'HOLD' && result.action !== 'NONE') {
                if (status?.pauseAggressiveRisk && result.strategy === 'GRID') {
                    this.logger.warn(`[${this.coin}] Skipping execution - Grid risk paused`);
                } else {
                    await this.executeHybridSignal(result, currentPrice);
                }
            }

        } catch (err) {
            this.logger.error(`[${this.coin}] Cycle error:`, err.message);
        }
    }

    _pauseTrading(reason) {
        this.tradingPaused = true;
        this.pauseReason = reason;
        this.pauseTimestamp = Date.now();
        this.logger.error(`[${this.coin}] CIRCUIT BREAKER TRIGGERED: ${reason}`);
    }

    resumeTrading(reason = "Manual resume") {
        if (!this.tradingPaused) return;

        this.tradingPaused = false;
        this.pauseReason = null;
        this.pauseTimestamp = null;
        this.logger.info(`[${this.coin}] Trading RESUMED: ${reason}`);
    }

    async executeHybridSignal(result, currentPrice) {
        const { action, strategy } = result;

        let size = 0.01;
        if (strategy === 'GRID') {
            size = (this.initialCapital * 0.04) / currentPrice;
        } else if (strategy === 'BBRSI') {
            size = (this.initialCapital * this.config.riskPerTrade) / currentPrice;
        }

        try {
            if ((action === 'LONG' || action === 'SHORT') && this.engine?.openPosition) {
                await this.engine.openPosition({
                    symbol: this.coin,
                    side: action,
                    size,
                    leverage: this.config.maxLeverage
                });
            } else if (action.startsWith('CLOSE') && this.engine?.closePosition) {
                await this.engine.closePosition(this.coin);
            }
        } catch (err) {
            this.logger.error(`Execution error:`, err.message);
        }
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Initialize daily equity on start
        this.dailyStartEquity = this._getCurrentEquity();

        this.logger.info(`[HybridPaperTrader] Starting for ${this.coin}`);
        this.runCycle();
        this.intervalId = setInterval(() => this.runCycle(), this.config.checkInterval);
    }

    stop() {
        this.isRunning = false;
        if (this.intervalId) clearInterval(this.intervalId);
        this.hybrid.shutdown?.();
        this.logger.info(`[HybridPaperTrader] Stopped. Final Daily PnL: $${this.dailyPnL.toFixed(2)}`);
    }
}

module.exports = HybridPaperTrader;
