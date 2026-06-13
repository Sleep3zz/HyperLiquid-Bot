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
            ...options
        };

        this.wayfinder = options.wayfinder;
        this.dataProvider = options.dataProvider || new DataProvider();

        this.hybrid = new HybridStrategy(
            this.logger,
            this.wayfinder,
            `./state/${coin.toLowerCase().replace(/-/g, '_')}`
        );

        this.engine = options.engine;

        // === Safeguards & Logging ===
        this.transitionLog = [];
        this.lastRegime = null;
        this.totalSwitches = 0;

        this.isRunning = false;
        this.intervalId = null;
    }

    async fetchOHLCV(symbol, limit = 150) {
        const candles = await this.dataProvider.getCandles(symbol, this.config.timeframe, limit);
        
        if (candles.length > 0) {
            return candles;
        }

        // Fallback to mock
        this.logger.warn(`Using mock data for ${symbol}`);
        const price = await this.wayfinder.getPrice(symbol);
        return this._generateMockOHLCV(price, limit);
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
            const currentPosition = this.engine?.getPosition?.(this.coin) || null;

            const result = await this.hybrid.update(this.coin, ohlcv, currentPrice, currentPosition);
            const status = this.hybrid.getStatus(this.coin);

            // Track regime transitions + costs
            this._logTransition(result.regime, result.strategy);

            this.logger.info(
                `[${this.coin}] ${result.regime} | ${result.strategy || 'N/A'} | ${result.action} | ` +
                `Paused: ${status?.pauseAggressiveRisk || false} | Switches: ${this.totalSwitches}`
            );

            if (result.action && result.action !== 'HOLD' && result.action !== 'NONE') {
                if (status?.pauseAggressiveRisk && result.strategy === 'GRID') {
                    this.logger.warn(`[${this.coin}] Execution blocked - Grid risk paused`);
                } else {
                    await this.executeHybridSignal(result, currentPrice);
                }
            }

        } catch (err) {
            this.logger.error(`[${this.coin}] Cycle error:`, err.message);
        }
    }

    _logTransition(newRegime, strategy) {
        if (this.lastRegime && this.lastRegime !== newRegime) {
            const transition = {
                from: this.lastRegime,
                to: newRegime,
                strategy,
                timestamp: new Date().toISOString(),
                estimatedCost: this._estimateTransitionCost()
            };

            this.transitionLog.push(transition);
            this.totalSwitches++;

            this.logger.info(
                `[${this.coin}] Regime Transition: ${this.lastRegime} → ${newRegime} ` +
                `(Est. cost: $${transition.estimatedCost.toFixed(2)})`
            );
        }
        this.lastRegime = newRegime;
    }

    _estimateTransitionCost() {
        // Simple estimation: fees + slippage
        const estimatedFees = this.initialCapital * 0.0009; // ~0.09% round trip
        const estimatedSlippage = this.initialCapital * 0.0005;
        return estimatedFees + estimatedSlippage;
    }

    async executeHybridSignal(result, currentPrice) {
        const { action, strategy } = result;

        let size = 0.01;
        if (strategy === 'GRID') {
            size = (this.initialCapital * 0.04) / currentPrice;
        } else if (strategy === 'BBRSI') {
            size = (this.initialCapital * this.config.riskPerTrade) / currentPrice;
        }

        this.logger.info(`[${this.coin}] Executing ${action} via ${strategy}`);

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
            this.logger.error(`Execution failed:`, err.message);
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
        this.logger.info(`[HybridPaperTrader] Stopped. Total switches: ${this.totalSwitches}`);
    }
}

module.exports = HybridPaperTrader;
