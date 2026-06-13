const HybridStrategy = require('./src/strategy/HybridStrategy');

class HybridPaperTrader {
    constructor(coin = 'BTC-PERP', initialCapital = 1000) {
        this.coin = coin;
        this.logger = console;
        this.initialCapital = initialCapital;

        // TODO: Replace with your actual Wayfinder adapter
        this.wayfinder = {
            async getPrice(symbol) {
                // Placeholder - replace with real implementation
                return 100 + Math.random() * 5;
            }
        };

        // Core Hybrid Strategy
        this.hybrid = new HybridStrategy(
            this.logger,
            this.wayfinder,
            `./state/${coin.toLowerCase().replace('-', '_')}`
        );

        this.checkInterval = 60000; // 1 minute
        this.intervalId = null;
        this.isRunning = false;

        this.logger.info(`[HybridPaperTrader] Initialized for ${coin} with $${initialCapital}`);
    }

    // Simple mock OHLCV generator (replace with real candle data for production)
    generateOHLCV(currentPrice, length = 120) {
        const data = [];
        let price = currentPrice;

        for (let i = 0; i < length; i++) {
            price += (Math.random() - 0.5) * (currentPrice * 0.01);
            data.push({
                t: Date.now() - (length - i) * 60000,
                o: Number(price.toFixed(4)),
                h: Number((price + currentPrice * 0.005).toFixed(4)),
                l: Number((price - currentPrice * 0.005).toFixed(4)),
                c: Number(price.toFixed(4)),
                v: 1000 + Math.floor(Math.random() * 800)
            });
        }
        return data;
    }

    async runCycle() {
        try {
            const currentPrice = await this.wayfinder.getPrice(this.coin);
            if (!currentPrice) return;

            const ohlcv = this.generateOHLCV(currentPrice);

            // TODO: Replace with real position lookup from your engine
            const currentPosition = null; 

            const result = await this.hybrid.update(
                this.coin,
                ohlcv,
                currentPrice,
                currentPosition
            );

            this.logger.info(
                `[${this.coin}] Regime: ${result.regime.padEnd(14)} | ` +
                `Strategy: ${(result.strategy || 'N/A').padEnd(8)} | ` +
                `Action: ${result.action}`
            );

            // === Execute based on Hybrid decision ===
            if (result.action === 'LONG' || result.action === 'SHORT') {
                this.logger.info(`[${this.coin}] → Would open ${result.action} position`);
                // TODO: Call your PaperTradingEngine here
                // await this.engine.openPosition({ symbol: this.coin, side: result.action, ... });
            } 
            else if (result.action?.startsWith('CLOSE')) {
                this.logger.info(`[${this.coin}] → Would close position`);
                // await this.engine.closePosition(this.coin);
            }

        } catch (error) {
            this.logger.error(`[${this.coin}] Cycle error:`, error.message);
        }
    }

    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.logger.info(`[HybridPaperTrader] Starting hybrid trading for ${this.coin}`);

        // Run immediately
        this.runCycle();

        // Recurring loop
        this.intervalId = setInterval(() => {
            if (this.isRunning) this.runCycle();
        }, this.checkInterval);
    }

    stop() {
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.hybrid.shutdown?.();
        this.logger.info(`[HybridPaperTrader] Stopped for ${this.coin}`);
    }
}

// CLI Support (used by multi-paper-trader.js)
if (require.main === module) {
    const args = process.argv.slice(2);
    const coinArg = args.find(arg => arg.startsWith('--coin='));
    const capitalArg = args.find(arg => arg.startsWith('--capital='));

    const coin = coinArg ? coinArg.split('=')[1] : 'BTC-PERP';
    const capital = capitalArg ? parseFloat(capitalArg.split('=')[1]) : 1000;

    const trader = new HybridPaperTrader(coin, capital);
    trader.start();

    process.on('SIGINT', () => {
        trader.stop();
        process.exit(0);
    });
}

module.exports = HybridPaperTrader;
