/**
 * BBRSI Strategy Executor - Production Integration Template
 * 
 * This file shows the CORRECT way to integrate BBRSIStrategy with:
 * - Real account equity (not hardcoded)
 * - Proper notifyExit() calls
 * - Dry-run mode
 * - Safety checks
 * 
 * CRITICAL FIXES APPLIED:
 * - Bug #3: currentPnl passed to evaluatePosition
 * - Bug #4: Real equity from getAccountEquity(), refusal on placeholder
 * - Bug #5: notifyExit() called after every fill
 * - Bug #6: DRY_RUN mode gate
 * - Bug #7: Interval from config
 * - Bug #9: Proper coin parsing
 */

const { BBRSIStrategy, FileStateStore } = require('./strategy/BBRSIStrategy');
const config = require('config');

// SAFETY: Force dry-run unless explicitly set to false
const DRY_RUN = process.env.BBRSI_DRY_RUN !== 'false'; // default SAFE

class BBRSIExecutor {
    constructor(wayfinder, logger) {
        this.wayfinder = wayfinder;
        this.logger = logger;
        
        // Load strategy config from same source as strategy
        const trading = config.get('trading');
        
        // Initialize strategy with state persistence
        const stateStore = new FileStateStore('./strategy-state.json');
        this.strategy = new BBRSIStrategy(logger, stateStore);
        
        // Use configured timeframe (Bug #7 fix)
        this.interval = trading.timeframe || '15m';
        this.coin = trading.market || 'BTC';
        
        // Track position state
        this.position = null; // { side, entryPrice, size, entryTime, unrealizedPnl }
    }

    /**
     * Execute one trading cycle
     */
    async execute() {
        try {
            // ───────────────────────────────────────────────
            // Bug #4 FIX: Get REAL account equity, refuse on placeholder
            // ───────────────────────────────────────────────
            const equity = await this.wayfinder.getAccountEquity?.();
            if (!Number.isFinite(equity) || equity <= 0) {
                const msg = 'Cannot run BBRSI: real account equity unavailable. Refusing to size on placeholder.';
                this.logger.error(msg);
                return { error: msg };
            }

            // ───────────────────────────────────────────────
            // Bug #1 FIX: Get candles with correct API shape
            // ───────────────────────────────────────────────
            const candles = await this.wayfinder.getHistoricalCandles(
                this.coin,
                this.interval,
                300 // ~3 days of 15m candles
            );
            
            if (!candles || candles.length < 22) {
                return { error: 'Insufficient candle data' };
            }

            // ───────────────────────────────────────────────
            // Calculate current PnL if in position
            // ───────────────────────────────────────────────
            let currentPnl = 0;
            if (this.position) {
                const currentPrice = await this.wayfinder.getLatestPrice(this.coin);
                if (Number.isFinite(currentPrice)) {
                    if (this.position.side === 'LONG') {
                        currentPnl = ((currentPrice - this.position.entryPrice) / this.position.entryPrice) * 100;
                    } else {
                        currentPnl = ((this.position.entryPrice - currentPrice) / this.position.entryPrice) * 100;
                    }
                    this.position.unrealizedPnl = currentPnl;
                }
            }

            // ───────────────────────────────────────────────
            // Bug #3 FIX: Pass currentPnl to evaluatePosition
            // ───────────────────────────────────────────────
            const result = await this.strategy.evaluatePosition(
                candles,
                this.position?.side ?? null,
                equity,
                this.position?.entryPrice ?? null,
                currentPnl // ← CRITICAL: for daily-loss breaker
            );

            // ───────────────────────────────────────────────
            // Bug #6 FIX: Dry-run mode gate
            // ───────────────────────────────────────────────
            if (DRY_RUN) {
                this.logger.info(`[DRY_RUN] BBRSI signal: ${result.signal}`, {
                    positionSize: result.positionSize,
                    stopLoss: result.stopLoss,
                    takeProfit: result.takeProfit
                });
                return { signal: result.signal, dryRun: true };
            }

            // ───────────────────────────────────────────────
            // Execute signals (LIVE mode)
            // ───────────────────────────────────────────────
            if (result.signal === 'LONG' || result.signal === 'SHORT') {
                return await this.enterPosition(result, equity);
            }
            
            if (result.signal?.startsWith('CLOSE_')) {
                return await this.exitPosition(result);
            }

            return { signal: 'NONE', reason: result.reason };

        } catch (error) {
            this.logger.error('Executor error:', error);
            return { error: error.message };
        }
    }

    /**
     * Enter a new position
     */
    async enterPosition(signal, equity) {
        // Close existing position if any
        if (this.position) {
            await this.closePosition('reversal');
        }

        const side = signal.signal; // LONG or SHORT
        const size = signal.positionSize;
        
        if (!size || size <= 0) {
            return { error: 'Invalid position size' };
        }

        // Place order via Wayfinder
        const order = await this.wayfinder.placeOrder({
            coin: this.coin,
            side: side === 'LONG' ? 'BUY' : 'SELL',
            size: size,
            type: 'MARKET'
        });

        if (!order || order.status !== 'filled') {
            return { error: 'Order failed or not filled' };
        }

        // Record position
        this.position = {
            side,
            entryPrice: order.fillPrice,
            size: order.filledSize,
            entryTime: Date.now(),
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit
        };

        this.logger.info(`Entered ${side} position`, this.position);
        return { signal: side, position: this.position };
    }

    /**
     * Exit current position
     */
    async exitPosition(signal) {
        if (!this.position) {
            return { error: 'No position to close' };
        }

        const closeSide = this.position.side === 'LONG' ? 'SELL' : 'BUY';
        
        // Place close order
        const order = await this.wayfinder.placeOrder({
            coin: this.coin,
            side: closeSide,
            size: this.position.size,
            type: 'MARKET'
        });

        if (!order || order.status !== 'filled') {
            this.logger.warn(`Close order not filled: ${signal.reason}`);
            // Still proceed to update strategy state
        }

        // Calculate realized PnL
        const exitPrice = order?.fillPrice || await this.wayfinder.getLatestPrice(this.coin);
        let realizedPnl = 0;
        
        if (this.position.side === 'LONG') {
            realizedPnl = ((exitPrice - this.position.entryPrice) / this.position.entryPrice) * 100;
        } else {
            realizedPnl = ((this.position.entryPrice - exitPrice) / exitPrice) * 100;
        }

        // ───────────────────────────────────────────────
        // Bug #5 FIX: MUST call notifyExit after fill
        // This updates dailyRealizedPnl and clears force-close latch
        // ───────────────────────────────────────────────
        const ts = order?.fillTime || Date.now();
        this.strategy.notifyExit(
            ts,
            realizedPnl,
            {
                side: this.position.side,
                entryPrice: this.position.entryPrice,
                exitPrice
            }
        );

        this.logger.info(`Exited position: ${signal.reason}`, {
            side: this.position.side,
            entryPrice: this.position.entryPrice,
            exitPrice,
            realizedPnl: `${realizedPnl.toFixed(2)}%`
        });

        const closedPosition = { ...this.position, exitPrice, realizedPnl };
        this.position = null;

        return { 
            signal: signal.signal, 
            reason: signal.reason,
            realizedPnl,
            position: closedPosition
        };
    }

    /**
     * Close position helper
     */
    async closePosition(reason) {
        return this.exitPosition({ 
            signal: this.position?.side === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT',
            reason 
        });
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        this.strategy.shutdown();
        if (this.position) {
            this.logger.warn('Position still open at shutdown:', this.position);
        }
    }
}

module.exports = { BBRSIExecutor, DRY_RUN };

/**
 * USAGE EXAMPLE:
 * 
 * # Dry-run mode (safe, default)
 * BBRSI_DRY_RUN=true node executor.js
 * 
 * # Live trading (only when ready)
 * BBRSI_DRY_RUN=false node executor.js
 * 
 * REQUIRED ENV:
 * - HYPERLIQUID_API_KEY
 * - HYPERLIQUID_API_SECRET
 * - WALLET_ADDRESS (for equity check)
 */