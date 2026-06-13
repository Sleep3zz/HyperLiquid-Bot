#!/usr/bin/env node
/**
 * Paper Trading Runner - Using Native Bot Scanner & ML
 * 
 * Uses HyperLiquidAlgoBot's existing:
 * - BBRSIStrategy with ML optimization
 * - Backtester engine
 * - RiskManager
 * - Native indicators and scanners
 */

const PaperTradingEngine = require('./src/paper-trading/engine');
const BBRSIStrategy = require('./src/strategy/BBRSIStrategy');
const HybridStrategy = require('./src/strategy/HybridStrategy');
const RiskManager = require('./src/backtesting/RiskManager');
const MLOptimizer = require('./src/backtesting/ml_optimizer');
const WayfinderAdapterFinal = require('./src/wayfinder/adapter-final');
const winston = require('winston');

// Setup logging
const logger = winston.createLogger({
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
        new winston.transports.File({ filename: 'paper-trading.log' })
    ]
});

class PaperTradingRunner {
    constructor(config = {}) {
        this.logger = logger;
        
        // Initialize paper trading engine
        this.engine = new PaperTradingEngine({
            initialCapital: config.initialCapital || 1000,
            maxPositionSize: config.maxPositionSize || 0.1,
            maxLeverage: config.maxLeverage || 3,
            logger: this.logger
        });

        // === NEW: Use HybridStrategy instead of plain BBRSIStrategy ===
        this.hybrid = new HybridStrategy(
            this.logger,
            this.adapter, // Pass the Wayfinder adapter
            './state' // State storage path
        );

        // Keep old strategy reference if needed for fallback
        this.strategy = new BBRSIStrategy(this.logger);
        
        // Initialize risk manager
        this.riskManager = new RiskManager({
            maxLeverage: 3,
            maxPositionSize: 0.1,
            stopLossPct: 2,
            takeProfitPct: 3,
            logger: this.logger
        });

        // Initialize REST API-based price feed (NO FALLBACKS - real prices only)
        this.adapter = new WayfinderAdapterFinal({ logger: this.logger });

        // Configuration
        this.symbols = config.symbols || ['BTC-PERP', 'ETH-PERP'];
        this.timeframe = config.timeframe || '15m';
        this.checkInterval = config.checkInterval || 60000;
        this.isRunning = false;

        // ML Optimizer
        this.mlOptimizer = null;
        this.useML = config.useML !== false;
    }

    /**
     * Load ML optimized parameters
     */
    async loadMLOptimizedParams() {
        if (!this.useML) return;

        try {
            this.logger.info('[ML] Loading optimized parameters...');
            
            // Check if ML models exist
            const fs = require('fs');
            const path = require('path');
            const modelsDir = path.join(__dirname, 'src/backtesting/ml_models');
            
            if (fs.existsSync(modelsDir)) {
                this.logger.info('[ML] Found ML models directory');
                // Models would be loaded here based on symbol/timeframe
            } else {
                this.logger.info('[ML] No existing models. Run: node src/backtesting/ml_optimize.js --market BTC-PERP');
            }
        } catch (error) {
            this.logger.error('[ML] Error loading ML params:', error.message);
        }
    }

    /**
     * Fetch market data (native implementation with adapter fix)
     */
    async fetchMarketData(symbol) {
        try {
            // Use adapter fix to handle Wayfinder SDK errors
            const baseSymbol = symbol.replace('-PERP', '');
            const price = await this.adapter.getPrice(baseSymbol);
            const fundingRate = await this.adapter.getFundingRate(baseSymbol);

            return {
                symbol,
                price,
                fundingRate,
                timestamp: Date.now()
            };
        } catch (error) {
            this.logger.error(`[SCANNER] Error fetching ${symbol}:`, error.message);
            return null;
        }
    }

    /**
     * Generate mock OHLCV data for strategy
     */
    generateMockData(marketData) {
        const data = [];
        let price = marketData.price;
        
        for (let i = 0; i < 100; i++) {
            const change = (Math.random() - 0.5) * 0.02;
            price = price * (1 + change);
            
            data.push({
                t: Date.now() - (100 - i) * 60000,
                o: price * 0.998,
                h: price * 1.005,
                l: price * 0.995,
                c: price,
                v: Math.random() * 100
            });
        }
        
        return data;
    }

    /**
     * Evaluate strategy signal using HybridStrategy
     */
    async evaluateSignal(symbol, marketData) {
        try {
            const currentPrice = marketData.price;
            
            // Generate mock OHLCV data (improve with real candles later)
            const ohlcv = this.generateMockData(marketData);

            // Get current position from engine
            const currentPosition = this.engine.getPosition(symbol);

            // === NEW: Use HybridStrategy ===
            const hybridResult = await this.hybrid.update(
                symbol,
                ohlcv,
                currentPrice,
                currentPosition
            );

            this.logger.info(`[Hybrid] ${symbol} | Regime: ${hybridResult.regime} | Strategy: ${hybridResult.strategy || 'N/A'} | Action: ${hybridResult.action}`);

            // Map hybrid result back to expected signal format
            let signal = 'NONE';
            if (hybridResult.action === 'LONG' || hybridResult.action === 'BUY') signal = 'LONG';
            if (hybridResult.action === 'SHORT' || hybridResult.action === 'SELL') signal = 'SHORT';
            if (hybridResult.action === 'CLOSE' || hybridResult.action?.startsWith('CLOSE')) signal = 'CLOSE';

            return {
                symbol,
                signal,
                regime: hybridResult.regime,
                activeStrategy: hybridResult.strategy,
                hybridResult,
                price: currentPrice,
                timestamp: Date.now()
            };

        } catch (error) {
            this.logger.error(`[STRATEGY] Error evaluating hybrid signal for ${symbol}:`, error.message);
            return { symbol, signal: 'NONE', error: error.message };
        }
    }

    /**
     * Risk check
     */
    checkRisk(signal, portfolio) {
        try {
            const riskCheck = {
                approved: true,
                reasons: []
            };

            // Check max positions
            if (portfolio.positionCount >= 3) {
                riskCheck.approved = false;
                riskCheck.reasons.push('Max positions (3) reached');
            }

            // Check balance
            if (portfolio.balance < 50) {
                riskCheck.approved = false;
                riskCheck.reasons.push('Insufficient balance');
            }

            // Check drawdown
            if (portfolio.totalReturn < -10) {
                riskCheck.approved = false;
                riskCheck.reasons.push('Max drawdown (-10%) exceeded');
            }

            return { ...signal, riskCheck };
        } catch (error) {
            this.logger.error('[RISK] Error in risk check:', error.message);
            return { ...signal, riskCheck: { approved: false, reasons: ['Risk check error'] } };
        }
    }

    /**
     * Execute trade
     */
    async executeTrade(signal, marketData) {
        if (signal.signal === 'NONE' || !signal.riskCheck.approved) {
            if (signal.riskCheck?.reasons?.length > 0) {
                this.logger.info(`[EXEC] Skipped ${signal.symbol}: ${signal.riskCheck.reasons.join(', ')}`);
            }
            return null;
        }

        try {
            const portfolio = this.engine.getPortfolio();
            const positionSize = portfolio.balance * 0.1 / marketData.price;
            
            let result;
            if (signal.signal === 'LONG') {
                result = await this.engine.openPosition({
                    symbol: signal.symbol,
                    side: 'LONG',
                    size: positionSize,
                    leverage: 2,
                    stopLoss: marketData.price * 0.98,
                    takeProfit: marketData.price * 1.03
                });
                this.logger.info(`[EXEC] Opened LONG ${positionSize.toFixed(4)} ${signal.symbol} @ $${marketData.price}`);
            } else if (signal.signal === 'SHORT') {
                result = await this.engine.openPosition({
                    symbol: signal.symbol,
                    side: 'SHORT',
                    size: positionSize,
                    leverage: 2,
                    stopLoss: marketData.price * 1.02,
                    takeProfit: marketData.price * 0.97
                });
                this.logger.info(`[EXEC] Opened SHORT ${positionSize.toFixed(4)} ${signal.symbol} @ $${marketData.price}`);
            }

            return result;
        } catch (error) {
            this.logger.error(`[EXEC] Error executing trade:`, error.message);
            return null;
        }
    }

    /**
     * Run single trading cycle
     */
    async runCycle() {
        this.logger.info('--- Paper Trading Cycle ---');

        for (const symbol of this.symbols) {
            try {
                // Step 1: Fetch market data
                const marketData = await this.fetchMarketData(symbol);
                if (!marketData) continue;

                // Step 2: Evaluate strategy signal
                const signal = await this.evaluateSignal(symbol, marketData);

                // Step 3: Risk check
                const portfolio = this.engine.getPortfolio();
                const riskCheckedSignal = this.checkRisk(signal, portfolio);

                // Step 4: Execute trade
                await this.executeTrade(riskCheckedSignal, marketData);

            } catch (error) {
                this.logger.error(`Error processing ${symbol}:`, error.message);
            }
        }

        // Update positions
        await this.engine.updatePositions();
        
        // Print summary
        this.engine.printPortfolio();
    }

    /**
     * Start paper trading
     */
    async start() {
        if (this.isRunning) {
            this.logger.warn('Already running');
            return;
        }

        this.isRunning = true;
        
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║     HYPERLIQUID ALGO BOT - PAPER TRADING                   ║');
        console.log('║     Initial Capital: $1,000                                ║');
        console.log('║     Strategy: BBRSI with Native ML                         ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        // Load ML params
        await this.loadMLOptimizedParams();

        // Print initial portfolio
        this.engine.printPortfolio();

        // Run first cycle
        await this.runCycle();

        // Schedule cycles
        this.interval = setInterval(async () => {
            if (this.isRunning) {
                await this.runCycle();
            }
        }, this.checkInterval);

        this.logger.info(`Paper trading started. Interval: ${this.checkInterval}ms`);
    }

    /**
     * Stop paper trading
     */
    async stop() {
        this.isRunning = false;
        if (this.interval) {
            clearInterval(this.interval);
        }

        // Final report
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║              FINAL PAPER TRADING REPORT                    ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        this.engine.printPortfolio();

        const stats = this.engine.getStats();
        console.log('\nPerformance:');
        console.log(`  Total Trades: ${stats.tradeCount || 0}`);
        console.log(`  Win Rate: ${stats.winRate?.toFixed(1) || 0}%`);
        console.log(`  Total PnL: $${stats.totalPnl?.toFixed(2) || 0}`);

        this.logger.info('Paper trading stopped');
    }
}

// Main
async function main() {
    const runner = new PaperTradingRunner({
        initialCapital: 1000,
        symbols: ['BTC-PERP', 'ETH-PERP'],
        checkInterval: 60000,
        useML: true
    });

    await runner.start();

    console.log('\n📊 Paper Trading Active');
    console.log('   Press Ctrl+C to stop\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n\nStopping...');
        await runner.stop();
        process.exit(0);
    });
}

main().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
});
