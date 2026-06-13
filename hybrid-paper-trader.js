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
            dailyLossLimit: options.dailyLossLimit || 0.05, // 5% daily loss limit
            maxDailySwitches: options.maxDailySwitches || 8, // Max regime switches per day
            ...options
        };

        this.wayfinder = options.wayfinder;
        this.dataProvider = options.dataProvider || new DataProvider('./data', this.wayfinder);

        this.hybrid = new HybridStrategy(
            this.logger,
            this.wayfinder,
            `./state/${coin.toLowerCase().replace(/-/g, '_')}`
        );

        this.engine = options.engine;

        // === Circuit Breakers ===
        this.dailyPnL = 0;
        this.dailySwitches = 0;
        this.lastResetDay = new Date().getUTCDate();
        this.tradingPaused = false;
        this.lastRegime = null;

        this.isRunning = false;
        this.intervalId = null;
    }

    _resetDailyStatsIfNeeded() {
        const currentDay = new Date().getUTCDate();
        if (currentDay !== this.lastResetDay) {
            this.dailyPnL = 0;
            this.dailySwitches = 0;
            this.tradingPaused = false;
            this.lastResetDay = currentDay;
            this.logger.info(`[${this.coin}] Daily stats reset`);
        }
    }

    async fetchOHLCV(symbol, limit = 150) {
        return await this.dataProvider.getCandles(symbol, this.config.timeframe, limit);
    }

    async runCycle() {
        this._resetDailyStatsIfNeeded();

        if (this.tradingPaused) {
            this.logger.warn(`[${this.coin}] Trading paused due to circuit breaker`);
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
            if (result.regime !== this.lastRegime && this.lastRegime !== null) {
                this.dailySwitches++;
            }
            this.lastRegime = result.regime;

            this.logger.info(
                `[${this.coin}] ${result.regime} | ${result.strategy || 'N/A'} | ${result.action} | ` +
                `Switches today: ${this.dailySwitches}/${this.config.maxDailySwitches}`
            );

            // === Circuit Breaker Checks ===
            if (this.dailySwitches >= this.config.maxDailySwitches) {
                this.tradingPaused = true;
                this.logger.error(`[${this.coin}] MAX DAILY SWITCHES REACHED. Trading paused.`);
                return;
            }

            // Check daily loss (basic implementation - improve with engine stats later)
            if (this.dailyPnL <= -this.initialCapital * this.config.dailyLossLimit) {
                this.tradingPaused = true;
                this.logger.error(`[${this.coin}] DAILY LOSS LIMIT REACHED. Trading paused.`);
                return;
            }

            if (result.action && result.action !== 'HOLD' && result.action !== 'NONE') {
                if (status?.pauseAggressiveRisk && result.strategy === 'GRID') {
                    this.logger.warn(`[${this.coin}] Skipping - Grid risk paused`);
                } else {
                    await this.executeHybridSignal(result, currentPrice);
                }
            }

        } catch (err) {
            this.logger.error(`[${this.coin}] Cycle error:`, err.message);
        }
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
        this.logger.info(`[HybridPaperTrader] Starting for ${this.coin}`);
        this.runCycle();
        this.intervalId = setInterval(() => this.runCycle(), this.config.checkInterval);
    }

    stop() {
        this.isRunning = false;
        if (this.intervalId) clearInterval(this.intervalId);
        this.hybrid.shutdown?.();
        this.logger.info(`[HybridPaperTrader] Stopped. Daily switches: ${this.dailySwitches}`);
    }
}

module.exports = HybridPaperTrader;
