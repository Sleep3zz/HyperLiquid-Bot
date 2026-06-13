const HybridStrategy = require('./src/strategy/HybridStrategy');

class HybridPaperTrader {
    constructor(coin = 'BTC-PERP', options = {}) {
        this.coin = coin;
        this.logger = options.logger || console;
        this.initialCapital = options.initialCapital || 1000;

        // Per-coin config (you can expand this in config files)
        this.config = {
            checkInterval: options.checkInterval || 60000,
            maxLeverage: options.maxLeverage || 5,
            riskPerTrade: options.riskPerTrade || 0.02, // 2%
            ...options
        };

        this.wayfinder = options.wayfinder; // Must be passed in

        this.hybrid = new HybridStrategy(
            this.logger,
            this.wayfinder,
            `./state/${coin.toLowerCase().replace(/-/g, '_')}`
        );

        this.engine = options.engine; // Your PaperTradingEngine
        this.isRunning = false;
        this.intervalId = null;
    }

    // === Real OHLCV fetching (replace this implementation) ===
    async fetchOHLCV(symbol, limit = 150) {
        // TODO: Replace with real candle data from your data source or exchange
        // Example: return await this.wayfinder.getCandles(symbol, '1m', limit);
        
        // Temporary mock for now
        const price = await this.wayfinder.getPrice(symbol);
        const data = [];
        let p = price;
        for (let i = 0; i < limit; i++) {
            p += (Math.random() - 0.5) * (price * 0.008);
            data.push({
                t: Date.now() - (limit - i) * 60000,
                o: Number(p.toFixed(4)),
                h: Number((p + price * 0.005).toFixed(4)),
                l: Number((p - price * 0.005).toFixed(4)),
                c: Number(p.toFixed(4)),
                v: 1200
            });
        }
        return data;
    }

    async runCycle() {
        try {
            const currentPrice = await this.wayfinder.getPrice(this.coin);
            if (!currentPrice) return;

            const ohlcv = await this.fetchOHLCV(this.coin);
            const currentPosition = this.engine?.getPosition?.(this.coin) || null;

            const result = await this.hybrid.update(this.coin, ohlcv, currentPrice, currentPosition);

            this.logger.info(
                `[${this.coin}] ${result.regime} | ${result.strategy || 'N/A'} | ${result.action}`
            );

            if (result.action && result.action !== 'HOLD' && result.action !== 'NONE') {
                await this.executeHybridSignal(result, currentPrice, currentPosition);
            }

        } catch (err) {
            this.logger.error(`[${this.coin}] Error in cycle:`, err.message);
        }
    }

    async executeHybridSignal(result, currentPrice, currentPosition) {
        const { action, strategy } = result;

        // Strategy-aware position sizing
        let size = 0.01; // default
        if (strategy === 'GRID') {
            size = this.initialCapital * 0.05 / currentPrice; // smaller size for grid
        } else if (strategy === 'BBRSI') {
            size = this.initialCapital * this.config.riskPerTrade / currentPrice;
        }

        this.logger.info(`[${this.coin}] Executing ${action} via ${strategy} | Size: ${size.toFixed(4)}`);

        try {
            if (action === 'LONG' || action === 'SHORT') {
                await this.engine?.openPosition?.({
                    symbol: this.coin,
                    side: action,
                    size,
                    leverage: this.config.maxLeverage
                });
            } else if (action.startsWith('CLOSE')) {
                await this.engine?.closePosition?.(this.coin);
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
