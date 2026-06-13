const HybridStrategy = require('./src/strategy/HybridStrategy');

class HybridPaperTrader {
    constructor(coin = 'BTC-PERP', options = {}) {
        this.coin = coin;
        this.logger = options.logger || console;
        this.initialCapital = options.initialCapital || 1000;

        this.config = {
            checkInterval: options.checkInterval || 60000,
            maxLeverage: options.maxLeverage || 5,
            riskPerTrade: options.riskPerTrade || 0.02,
            ...options
        };

        this.wayfinder = options.wayfinder;
        if (!this.wayfinder) {
            throw new Error("Wayfinder instance is required");
        }

        this.hybrid = new HybridStrategy(
            this.logger,
            this.wayfinder,
            `./state/${coin.toLowerCase().replace(/-/g, '_')}`
        );

        this.engine = options.engine;
        this.isRunning = false;
        this.intervalId = null;
    }

    // ==================== REAL OHLCV DATA ====================
    async fetchOHLCV(symbol, limit = 150) {
        // TODO: Replace this with real candle data
        // Example implementations:
        // - Use your existing data downloader
        // - Call this.wayfinder.getCandles(symbol, '1m', limit)
        // - Or integrate with your historical data service

        try {
            // Placeholder - replace with real implementation
            const currentPrice = await this.wayfinder.getPrice(symbol);
            const data = [];
            let price = currentPrice;

            for (let i = 0; i < limit; i++) {
                price += (Math.random() - 0.5) * (currentPrice * 0.008);
                data.push({
                    t: Date.now() - (limit - i) * 60000,
                    o: Number(price.toFixed(4)),
                    h: Number((price + currentPrice * 0.005).toFixed(4)),
                    l: Number((price - currentPrice * 0.005).toFixed(4)),
                    c: Number(price.toFixed(4)),
                    v: 1200 + Math.floor(Math.random() * 500)
                });
            }
            return data;
        } catch (error) {
            this.logger.error(`Failed to fetch OHLCV for ${symbol}:`, error.message);
            return [];
        }
    }

    async runCycle() {
        try {
            const currentPrice = await this.wayfinder.getPrice(this.coin);
            if (!currentPrice) return;

            const ohlcv = await this.fetchOHLCV(this.coin);
            if (ohlcv.length === 0) return;

            const currentPosition = this.engine?.getPosition?.(this.coin) || null;

            const result = await this.hybrid.update(this.coin, ohlcv, currentPrice, currentPosition);

            // Get enhanced status (includes pauseAggressiveRisk)
            const status = this.hybrid.getStatus(this.coin);

            this.logger.info(
                `[${this.coin}] ${result.regime} | ` +
                `Strategy: ${result.strategy || 'N/A'} | ` +
                `Action: ${result.action} | ` +
                `PausedRisk: ${status?.pauseAggressiveRisk || false}`
            );

            // Execute only if not paused
            if (result.action && result.action !== 'HOLD' && result.action !== 'NONE') {
                if (status?.pauseAggressiveRisk && result.strategy === 'GRID') {
                    this.logger.warn(`[${this.coin}] Skipping execution - Grid risk is paused during cooldown`);
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

        // Strategy-aware position sizing
        let size = 0.01;
        if (strategy === 'GRID') {
            size = (this.initialCapital * 0.04) / currentPrice;
        } else if (strategy === 'BBRSI') {
            size = (this.initialCapital * this.config.riskPerTrade) / currentPrice;
        }

        this.logger.info(`[${this.coin}] Executing ${action} via ${strategy} | Size ≈ ${size.toFixed(4)}`);

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
            this.logger.error(`[${this.coin}] Execution failed:`, err.message);
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
        this.logger.info(`[HybridPaperTrader] Stopped for ${this.coin}`);
    }
}

module.exports = HybridPaperTrader;
