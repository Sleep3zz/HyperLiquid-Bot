#!/usr/bin/env node
/**
 * Hybrid Paper Trader - Per-coin regime-aware trading
 * 
 * Uses HybridStrategy to dynamically switch between:
 * - BBRSI for trending markets
 * - Grid for ranging markets
 */

const HybridStrategy = require('./src/strategy/HybridStrategy');
const PaperTradingEngine = require('./src/paper-trading/engine');
const WayfinderAdapterFinal = require('./src/wayfinder/adapter-final');
const winston = require('winston');

class HybridPaperTrader {
    constructor(coin, initialCapital = 1000) {
        this.coin = coin;
        
        // Setup logger
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.colorize(),
                winston.format.printf(({ level, message, timestamp }) => {
                    return `${timestamp} ${level}: ${message}`;
                })
            ),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: `paper-trading-${coin.replace('-PERP', '').toLowerCase()}.log` })
            ]
        });

        // Initialize paper trading engine
        this.engine = new PaperTradingEngine({
            initialCapital,
            maxPositionSize: 0.1,
            maxLeverage: 3,
            logger: this.logger
        });

        // Initialize Wayfinder adapter
        this.wayfinder = new WayfinderAdapterFinal({ logger: this.logger });

        // === Main Hybrid Strategy ===
        this.hybrid = new HybridStrategy(
            this.logger,
            this.wayfinder,
            `./state/${coin.replace('-PERP', '')}` // separate state folder per coin
        );

        this.checkInterval = 60000; // 1 minute
        this.interval = null;
        this.isRunning = false;
    }

    /**
     * Generate mock OHLCV data (replace with real data fetching)
     */
    generateMockOHLCV(currentPrice, length = 100) {
        const data = [];
        let price = currentPrice;
        
        for (let i = 0; i < length; i++) {
            // Random walk with slight mean reversion
            const change = (Math.random() - 0.5) * 0.01;
            price = price * (1 + change);
            
            data.push({
                t: Date.now() - (length - i) * 60000,
                o: price * 0.998,
                h: price * 1.005,
                l: price * 0.995,
                c: price,
                v: Math.random() * 1000
            });
        }
        
        return data;
    }

    /**
     * Execute trading signal from hybrid strategy
     */
    async executeSignal(hybridResult, price) {
        try {
            const portfolio = this.engine.getPortfolio();
            const positionSize = portfolio.balance * 0.1 / price;
            
            // Custom sizing based on strategy type
            let leverage = 2;
            if (hybridResult.strategy === 'GRID') {
                leverage = 1.5; // Lower leverage for grid
            } else if (hybridResult.strategy === 'BBRSI') {
                leverage = 2.5; // Higher leverage for trend following
            }

            const result = await this.engine.openPosition({
                symbol: this.coin,
                side: hybridResult.action,
                size: positionSize,
                leverage,
                stopLoss: hybridResult.action === 'LONG' 
                    ? price * 0.98 
                    : price * 1.02,
                takeProfit: hybridResult.action === 'LONG'
                    ? price * 1.03
                    : price * 0.97
            });

            this.logger.info(`[EXEC] Opened ${hybridResult.action} ${positionSize.toFixed(4)} ${this.coin} @ $${price.toFixed(2)} (${hybridResult.strategy})`);
            
            return result;
        } catch (error) {
            this.logger.error(`[EXEC] Error executing signal:`, error.message);
            return null;
        }
    }

    /**
     * Run single trading cycle
     */
    async runCycle() {
        try {
            const baseCoin = this.coin.replace('-PERP', '');
            const price = await this.wayfinder.getPrice(baseCoin);
            if (!price) {
                this.logger.warn(`[${this.coin}] No price available`);
                return;
            }

            // TODO: Replace with real OHLCV fetching for best results
            const ohlcv = this.generateMockOHLCV(price);

            const currentPosition = this.engine.getPosition(this.coin);

            const result = await this.hybrid.update(
                this.coin,
                ohlcv,
                price,
                currentPosition
            );

            this.logger.info(`[${this.coin}] Regime: ${result.regime} | Strategy: ${result.strategy || 'N/A'} | Action: ${result.action}`);

            // Execute based on hybrid result
            if (result.action === 'LONG' || result.action === 'SHORT') {
                await this.executeSignal(result, price);
            } else if (result.action?.startsWith('CLOSE')) {
                await this.engine.closePosition(this.coin);
                this.logger.info(`[${this.coin}] Closed position`);
            }

            await this.engine.updatePositions();
            this.engine.printPortfolio();

        } catch (err) {
            this.logger.error(`[${this.coin}] Cycle error:`, err.message);
        }
    }

    /**
     * Start the trader
     */
    start() {
        if (this.isRunning) {
            this.logger.warn('Already running');
            return;
        }

        this.isRunning = true;
        
        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║     HYBRID PAPER TRADER - ${this.coin.padEnd(20)} ║`);
        console.log(`║     Initial Capital: $${this.engine.getPortfolio().balance.toFixed(0).padEnd(7)}           ║`);
        console.log(`║     Strategy: Regime-Aware (BBRSI + Grid)                  ║`);
        console.log(`╚════════════════════════════════════════════════════════════╝\n`);

        this.logger.info(`[HybridTrader] Starting hybrid trader for ${this.coin}`);
        
        // Immediate first run
        this.runCycle();
        
        // Schedule cycles
        this.interval = setInterval(() => this.runCycle(), this.checkInterval);
    }

    /**
     * Stop the trader
     */
    stop() {
        this.isRunning = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        
        // Shutdown hybrid strategy (closes any grid positions)
        if (this.hybrid && typeof this.hybrid.shutdown === 'function') {
            this.hybrid.shutdown();
        }

        // Final report
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║              FINAL HYBRID TRADER REPORT                    ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        this.engine.printPortfolio();

        const stats = this.engine.getStats();
        console.log('\nPerformance:');
        console.log(`  Total Trades: ${stats.tradeCount || 0}`);
        console.log(`  Win Rate: ${stats.winRate?.toFixed(1) || 0}%`);
        console.log(`  Total PnL: $${stats.totalPnl?.toFixed(2) || 0}`);

        this.logger.info(`[HybridTrader] Stopped ${this.coin}`);
    }
}

// CLI support (so multi-paper-trader.js can pass --coin and --capital)
if (require.main === module) {
    const args = process.argv.slice(2);
    const coin = args.find(a => a.startsWith('--coin='))?.split('=')[1] || 'BTC-PERP';
    const capital = parseFloat(args.find(a => a.startsWith('--capital='))?.split('=')[1]) || 1000;

    const trader = new HybridPaperTrader(coin, capital);
    trader.start();

    process.on('SIGINT', () => {
        console.log('\n\nStopping...');
        trader.stop();
        process.exit(0);
    });
}

module.exports = HybridPaperTrader;
