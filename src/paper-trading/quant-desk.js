const PaperTradingEngine = require('./engine');
const EnhancedBBRSIStrategy = require('../wayfinder/enhanced-strategy');
const DeltaLabClient = require('../wayfinder/deltalab-client');
const winston = require('winston');

/**
 * QuantDeskPipeline - Systematic trading pipeline with ML enhancement
 * 
 * Manages the complete workflow:
 * 1. Market data collection (Kimi)
 * 2. Signal generation with ML optimization (Claude)
 * 3. Risk management (Claude)
 * 4. Trade execution tracking (Kimi)
 * 5. Performance monitoring (Claude)
 */
class QuantDeskPipeline {
    constructor(config = {}) {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: 'quant-desk.log' })
            ]
        });

        // Trading engine
        this.engine = new PaperTradingEngine({
            initialCapital: config.initialCapital || 1000,
            maxPositionSize: config.maxPositionSize || 0.1,
            maxLeverage: config.maxLeverage || 3,
            logger: this.logger
        });

        // Strategy
        this.strategy = new EnhancedBBRSIStrategy(this.logger, {
            useFundingFilter: true,
            fundingLongThreshold: 0.0001,
            fundingShortThreshold: 0.0001,
            useVolatilityFilter: true,
            maxVolatility: 0.03
        });

        // Market data client
        this.deltaLab = new DeltaLabClient({ logger: this.logger });

        // Configuration
        this.symbols = config.symbols || ['BTC', 'ETH'];
        this.timeframes = config.timeframes || ['15m'];
        this.checkInterval = config.checkInterval || 60000; // 1 minute
        this.isRunning = false;

        // Performance tracking
        this.performanceMetrics = {
            signalsGenerated: 0,
            signalsExecuted: 0,
            signalsFiltered: 0,
            avgExecutionTime: 0
        };

        // Model routing assignments
        this.taskAssignments = {
            dataCollection: 'kimi',
            signalGeneration: 'claude',
            riskManagement: 'claude',
            execution: 'kimi',
            monitoring: 'claude'
        };
    }

    /**
     * Collect market data (Kimi task)
     */
    async collectMarketData(symbol) {
        this.logger.info(`[KIMI] Collecting market data for ${symbol}`);
        
        const startTime = Date.now();
        
        // Fetch price and market data
        const [price, fundingRate, orderBook] = await Promise.all([
            this.deltaLab.getPrice(symbol),
            this.deltaLab.getFundingRate(symbol),
            this.deltaLab.getOrderBook(symbol, 5)
        ]);

        // Calculate market metrics
        const bidAskSpread = orderBook 
            ? ((orderBook.asks[0].price - orderBook.bids[0].price) / price) * 100
            : null;

        const executionTime = Date.now() - startTime;

        const marketData = {
            symbol,
            price,
            fundingRate,
            bidAskSpread,
            timestamp: Date.now(),
            executionTime
        };

        this.logger.info(`[KIMI] Data collected for ${symbol}: $${price}, funding: ${(fundingRate * 100).toFixed(4)}%`);
        
        return marketData;
    }

    /**
     * Generate trading signals (Claude task)
     */
    async generateSignals(symbol, marketData) {
        this.logger.info(`[CLAUDE] Analyzing ${symbol} for trading signals`);

        const startTime = Date.now();

        // Generate mock OHLCV data for strategy evaluation
        // In real implementation, this would fetch historical candles
        const mockData = this._generateMockCandles(marketData);

        // Evaluate strategy
        const result = await this.strategy.evaluatePosition(mockData);

        this.performanceMetrics.signalsGenerated++;

        // Prepare signal with analysis
        const signal = {
            symbol,
            signal: result.signal,
            confidence: this._calculateConfidence(result),
            indicators: result.indicators,
            filteredReason: result.filteredReason,
            fundingData: result.fundingData,
            marketData,
            analysis: this._generateAnalysis(result, marketData),
            timestamp: Date.now(),
            executionTime: Date.now() - startTime
        };

        this.logger.info(`[CLAUDE] Signal for ${symbol}: ${signal.signal} (confidence: ${(signal.confidence * 100).toFixed(1)}%)`);

        return signal;
    }

    /**
     * Risk management check (Claude task)
     */
    async assessRisk(signal) {
        this.logger.info(`[CLAUDE] Assessing risk for ${signal.symbol}`);

        const portfolio = this.engine.getPortfolio();
        const riskAssessment = {
            approved: true,
            reasons: [],
            maxPositionSize: 0,
            recommendedLeverage: 1
        };

        // Check portfolio concentration
        if (portfolio.positionCount >= 3) {
            riskAssessment.approved = false;
            riskAssessment.reasons.push('Max positions reached (3)');
        }

        // Check available balance
        if (portfolio.balance < 50) {
            riskAssessment.approved = false;
            riskAssessment.reasons.push('Insufficient balance (< $50)');
        }

        // Check drawdown
        if (portfolio.totalReturn < -10) {
            riskAssessment.approved = false;
            riskAssessment.reasons.push('Max drawdown exceeded (-10%)');
        }

        // Calculate position size based on confidence and risk
        if (riskAssessment.approved) {
            const baseSize = portfolio.balance * 0.1; // 10% of balance
            riskAssessment.maxPositionSize = baseSize * signal.confidence;
            riskAssessment.recommendedLeverage = signal.confidence > 0.8 ? 3 : 
                                                  signal.confidence > 0.6 ? 2 : 1;
        }

        this.logger.info(`[CLAUDE] Risk assessment for ${signal.symbol}: ${riskAssessment.approved ? 'APPROVED' : 'REJECTED'}`);
        
        return { ...signal, riskAssessment };
    }

    /**
     * Execute trade (Kimi task)
     */
    async executeTrade(signal) {
        if (signal.signal === 'NONE' || !signal.riskAssessment.approved) {
            this.logger.info(`[KIMI] Skipping ${signal.symbol}: ${signal.filteredReason || 'Risk rejected'}`);
            this.performanceMetrics.signalsFiltered++;
            return null;
        }

        this.logger.info(`[KIMI] Executing ${signal.signal} for ${signal.symbol}`);

        const startTime = Date.now();

        try {
            const size = signal.riskAssessment.maxPositionSize / signal.marketData.price;
            const leverage = signal.riskAssessment.recommendedLeverage;

            let result;
            if (signal.signal === 'LONG') {
                result = await this.engine.openPosition({
                    symbol: signal.symbol,
                    side: 'LONG',
                    size,
                    leverage,
                    stopLoss: signal.marketData.price * 0.98, // 2% stop
                    takeProfit: signal.marketData.price * 1.03 // 3% target
                });
            } else if (signal.signal === 'SHORT') {
                result = await this.engine.openPosition({
                    symbol: signal.symbol,
                    side: 'SHORT',
                    size,
                    leverage,
                    stopLoss: signal.marketData.price * 1.02,
                    takeProfit: signal.marketData.price * 0.97
                });
            }

            this.performanceMetrics.signalsExecuted++;
            this.performanceMetrics.avgExecutionTime = 
                (this.performanceMetrics.avgExecutionTime + (Date.now() - startTime)) / 2;

            return result;
        } catch (error) {
            this.logger.error(`[KIMI] Execution failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Monitor and report (Claude task)
     */
    async monitorAndReport() {
        this.logger.info('[CLAUDE] Generating monitoring report');

        const portfolio = this.engine.getPortfolio();
        const stats = this.engine.getStats();
        const strategyStats = this.strategy.getSignalStats();

        const report = {
            timestamp: new Date().toISOString(),
            portfolio: {
                totalValue: portfolio.totalValue,
                totalReturn: portfolio.totalReturn,
                balance: portfolio.balance,
                marginUsed: portfolio.marginUsed,
                unrealizedPnl: portfolio.unrealizedPnl,
                positionCount: portfolio.positionCount
            },
            performance: this.performanceMetrics,
            strategy: strategyStats,
            stats: stats,
            positions: portfolio.positions.map(p => ({
                symbol: p.symbol,
                side: p.side,
                size: p.size,
                entryPrice: p.entryPrice,
                currentPrice: p.currentPrice,
                unrealizedPnl: p.unrealizedPnl,
                leverage: p.leverage
            }))
        };

        // Print formatted report
        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║          Quant Desk Performance Report         ║');
        console.log('╚════════════════════════════════════════════════╝');
        console.log(`Account Value:    $${report.portfolio.totalValue.toFixed(2)}`);
        console.log(`Total Return:      ${report.portfolio.totalReturn.toFixed(2)}%`);
        console.log(`Open Positions:    ${report.portfolio.positionCount}`);
        console.log(`Signals Generated: ${report.performance.signalsGenerated}`);
        console.log(`Signals Executed:  ${report.performance.signalsExecuted}`);
        console.log(`Win Rate:          ${report.stats.winRate?.toFixed(1) || 0}%`);
        console.log(`Total PnL:         $${report.stats.totalPnl?.toFixed(2) || 0}`);
        console.log('');

        // Alert on significant events
        if (portfolio.totalReturn > 10) {
            console.log('🎉 Portfolio exceeded +10% return!');
        }
        if (portfolio.totalReturn < -5) {
            console.log('⚠️ Portfolio below -5%, reviewing risk...');
        }

        return report;
    }

    /**
     * Run single trading cycle
     */
    async runCycle() {
        this.logger.info('--- Starting Quant Desk Trading Cycle ---');

        for (const symbol of this.symbols) {
            try {
                // Step 1: Collect market data (Kimi)
                const marketData = await this.collectMarketData(symbol);

                // Step 2: Generate signals (Claude)
                const signal = await this.generateSignals(symbol, marketData);

                // Step 3: Risk assessment (Claude)
                const assessedSignal = await this.assessRisk(signal);

                // Step 4: Execute trade (Kimi)
                await this.executeTrade(assessedSignal);

            } catch (error) {
                this.logger.error(`Error processing ${symbol}: ${error.message}`);
            }
        }

        // Step 5: Update positions
        await this.engine.updatePositions();

        // Step 6: Generate report (Claude)
        await this.monitorAndReport();
    }

    /**
     * Start the pipeline
     */
    async start() {
        if (this.isRunning) {
            this.logger.warn('Pipeline already running');
            return;
        }

        this.isRunning = true;
        this.logger.info('╔════════════════════════════════════════════════╗');
        this.logger.info('║     Quant Desk Pipeline - Paper Trading        ║');
        this.logger.info('║     Initial Capital: $1,000                    ║');
        this.logger.info('║     Model Routing: Active                    ║');
        this.logger.info('╚════════════════════════════════════════════════╝');

        // Print initial portfolio
        this.engine.printPortfolio();

        // Run first cycle immediately
        await this.runCycle();

        // Schedule subsequent cycles
        this.interval = setInterval(async () => {
            if (this.isRunning) {
                await this.runCycle();
            }
        }, this.checkInterval);

        this.logger.info(`Pipeline running. Check interval: ${this.checkInterval}ms`);
    }

    /**
     * Stop the pipeline
     */
    async stop() {
        this.isRunning = false;
        if (this.interval) {
            clearInterval(this.interval);
        }
        
        // Final report
        await this.monitorAndReport();
        
        this.logger.info('Pipeline stopped');
    }

    /**
     * Generate mock candles for strategy evaluation
     */
    _generateMockCandles(marketData) {
        const candles = [];
        let price = marketData.price;
        
        for (let i = 0; i < 100; i++) {
            const change = (Math.random() - 0.5) * 0.01;
            price = price * (1 + change);
            
            candles.push({
                t: Date.now() - (100 - i) * 60000,
                o: price * 0.998,
                h: price * 1.005,
                l: price * 0.995,
                c: price,
                v: Math.random() * 100
            });
        }
        
        return candles;
    }

    /**
     * Calculate signal confidence
     */
    _calculateConfidence(result) {
        let confidence = 0.5;

        if (result.signal === 'NONE') {
            return 0;
        }

        // Base confidence on indicator alignment
        if (result.indicators.rsi < 30 || result.indicators.rsi > 70) {
            confidence += 0.2;
        }
        if (result.indicators.adx > 25) {
            confidence += 0.15;
        }

        // Reduce if filtered
        if (result.filteredReason) {
            confidence -= 0.3;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Generate analysis text
     */
    _generateAnalysis(result, marketData) {
        const parts = [];
        
        if (result.indicators) {
            parts.push(`RSI: ${result.indicators.rsi.toFixed(2)}`);
            parts.push(`ADX: ${result.indicators.adx.toFixed(2)}`);
        }
        
        if (marketData.fundingRate) {
            parts.push(`Funding: ${(marketData.fundingRate * 100).toFixed(4)}%`);
        }

        if (result.filteredReason) {
            parts.push(`Filtered: ${result.filteredReason}`);
        }

        return parts.join(' | ');
    }
}

module.exports = QuantDeskPipeline;
