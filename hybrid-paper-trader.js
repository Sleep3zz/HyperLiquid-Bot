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
            timeframe: options.timeframe || '1m',
            ...options
        };

        this.wayfinder = options.wayfinder;
        if (!this.wayfinder) {
            throw new Error("Wayfinder instance is required");
        }

        // === Data Provider (your existing infrastructure) ===
        this.dataProvider = options.dataProvider || null;

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
        // Priority 1: Use provided data provider
        if (this.dataProvider && typeof this.dataProvider.getCandles === 'function') {
            try {
                const candles = await this.dataProvider.getCandles(
                    symbol,
                    this.config.timeframe,
                    limit
                );
                if (candles && candles.length > 0) {
                    return candles;
                }
            } catch (err) {
                this.logger.warn(`Data provider failed for ${symbol}, falling back to mock: ${err.message}`);
            }
        }

        // Priority 2: Try common project patterns (adjust as needed)
        try {
            // Example: If you have a global data loader or function
            if (global.getHistoricalData) {
                return await global.getHistoricalData(symbol, this.config.timeframe, limit);
            }
        } catch (err) {
            // ignore and fall back
        }

        // Fallback: Mock data (with warning)
        this.logger.warn(`Using mock OHLCV data for ${symbol}. Replace with real data for accurate regime detection.`);
        return this._generateMockOHLCV(await this.wayfinder.getPrice(symbol), limit);
    }

    _generateMockOHLCV(currentPrice, length = 150) {
        const data = [];
        let price = currentPrice;

        for (let i = 0; i < length; i++) {
            price += (Math.random() - 0.5) * (currentPrice * 0.008);
            data.push({
                t: Date.now() - (length - i) * 60000,
                o: Number(price.toFixed(4)),
                h: Number((price + currentPrice * 0.005).toFixed(4)),
                l: Number((price - currentPrice * 0.005).toFixed(4)),
                c: Number(price.toFixed(4)),
                v: 1200 + Math.floor(Math.random() * 500)
            });
        }
        return data;
    }

    async runCycle() {
        try {
            const currentPrice = await this.wayfinder.getPrice(this.coin);
            if (!currentPrice) return;

            const ohlcv = await this.fetchOHLCV(this.coin);
            if (!ohlcv || ohlcv.length === 0) return;

            const currentPosition = this.engine?.getPosition?.(this.coin) || null;

            const result = await this.hybrid.update(this.coin, ohlcv, currentPrice, currentPosition);
            const status = this.hybrid.getStatus(this.coin);

            this.logger.info(
                `[${this.coin}] ${result.regime} | Strategy: ${result.strategy || 'N/A'} | ` +
                `Action: ${result.action} | Paused: ${status?.pauseAggressiveRisk || false}`
            );

            if (result.action && result.action !== 'HOLD' && result.action !== 'NONE') {
                if (status?.pauseAggressiveRisk && result.strategy === 'GRID') {
                    this.logger.warn(`[${this.coin}] Skipping trade - Grid risk paused during cooldown`);
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

        this.logger.info(`[${this.coin}] Executing ${action} via ${strategy} | Size: ${size.toFixed(4)}`);

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
            this.logger.error(`[${this.coin}] Execution error:`, err.message);
        }
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.logger.info(`[HybridPaperTrader] Starting hybrid trader for ${this.coin}`);
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
