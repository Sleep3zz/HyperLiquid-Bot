const config = require("config");
const WayfinderCommander = require('../wayfinder/wayfinder-cmds');

/**
 * GridStrategy - Grid Trading Implementation using Wayfinder SDK
 * 
 * Features:
 * - Places buy/sell orders at regular intervals (grid levels)
 * - Automatically cancels and replaces filled orders
 * - Range-bound protection (stops grid if price moves too far)
 * - Integration with WayfinderCommander for order execution
 * 
 * Sources from Wayfinder SDK:
 * - WayfinderCommander.placeLimitOrder() - src/wayfinder/wayfinder-cmds.js
 * - WayfinderCommander.closePosition() - src/wayfinder/wayfinder-cmds.js
 * - WayfinderCommander.getPrice() - src/wayfinder/wayfinder-cmds.js
 * - WayfinderCommander.getPositionSize() - src/wayfinder/wayfinder-cmds.js
 * - WayfinderCommander.getUnrealizedPnl() - src/wayfinder/wayfinder-cmds.js
 * - WayfinderCommander.getSummary() - src/wayfinder/wayfinder-cmds.js
 */

class GridStrategy {
    constructor(logger, wayfinderCmds = null) {
        this.logger = logger || console;
        
        // Use provided WayfinderCommander or create new one
        this.wayfinder = wayfinderCmds || new WayfinderCommander({
            sdkPath: process.env.WAYFINDER_SDK_PATH,
            walletLabel: process.env.WAYFINDER_WALLET_LABEL || 'main',
            logger: this.logger
        });

        // Grid configuration from config file
        const g = config.get("trading.grid") || {};
        this.gridLevels = Number(g.levels) || 8;
        this.gridSpacingPct = Number(g.spacingPct) || 0.8;
        this.baseAmount = Number(g.baseAmount) || 50;
        this.maxGridCapital = Number(g.maxGridCapital) || 2000;
        this.rangeBoundPct = Number(g.rangeBoundPct) || 5.0;

        // State
        this.active = false;
        this.coin = null;
        this.basePrice = null;
        this.gridOrders = new Map();
        this.filledOrders = [];
        this.totalPnL = 0;
        this.updateInterval = null;
    }

    /**
     * Start grid trading on a coin
     * @param {string} coin - Coin symbol (e.g., "BTC")
     * @returns {string} Status message
     */
    startGrid(coin = "BTC") {
        if (this.active) {
            return `Grid already running on ${this.coin}`;
        }

        // Check capital limits before starting
        const totalCapital = this.gridLevels * 2 * this.baseAmount;
        if (totalCapital > this.maxGridCapital) {
            return `❌ Grid capital $${totalCapital} exceeds max $${this.maxGridCapital}`;
        }

        // Get current price via Wayfinder SDK
        let price;
        try {
            price = this.wayfinder.getPrice(coin);
        } catch (e) {
            return `❌ Error getting price: ${e.message}`;
        }
        
        if (!Number.isFinite(price) || price <= 0) {
            return "❌ No valid price available from Wayfinder";
        }

        this.coin = coin;
        this.basePrice = price;
        this.active = true;
        this.gridOrders.clear();
        this.filledOrders = [];
        this.totalPnL = 0;

        this.logger.info(`[GRID] Starting grid on ${coin} @ $${price.toFixed(2)}`);
        this.logger.info(`[GRID] Levels: ${this.gridLevels}, Spacing: ${this.gridSpacingPct}%, Amount: $${this.baseAmount}`);

        // Place grid orders
        const placed = this._buildGrid();
        
        if (placed.length === 0) {
            this.active = false;
            return "❌ Failed to place any grid orders";
        }

        // Start automatic update loop
        this._startUpdateLoop();

        return `✅ Grid active on ${coin} with ${placed.length} orders`;
    }

    /**
     * Build the grid by placing limit orders
     * @returns {Array} Placed order IDs
     * @private
     */
    _buildGrid() {
        const placed = [];
        
        try {
            for (let i = 1; i <= this.gridLevels; i++) {
                // Calculate grid prices
                const buyPrice = this.basePrice * (1 - (i * this.gridSpacingPct / 100));
                const sellPrice = this.basePrice * (1 + (i * this.gridSpacingPct / 100));

                // Place buy order via Wayfinder SDK
                const buy = this.wayfinder.placeLimitOrder({
                    coin: this.coin,
                    isBuy: true,
                    size: this.baseAmount / buyPrice,
                    price: buyPrice
                });
                
                if (buy && buy.orderId) {
                    this.gridOrders.set(buy.orderId, {
                        side: "BUY",
                        price: buyPrice,
                        level: i
                    });
                    placed.push(buy.orderId);
                    this.logger.info(`[GRID] Buy order placed @ $${buyPrice.toFixed(2)} (Level ${i})`);
                }

                // Place sell order via Wayfinder SDK
                const sell = this.wayfinder.placeLimitOrder({
                    coin: this.coin,
                    isBuy: false,
                    size: this.baseAmount / sellPrice,
                    price: sellPrice
                });
                
                if (sell && sell.orderId) {
                    this.gridOrders.set(sell.orderId, {
                        side: "SELL",
                        price: sellPrice,
                        level: i
                    });
                    placed.push(sell.orderId);
                    this.logger.info(`[GRID] Sell order placed @ $${sellPrice.toFixed(2)} (Level ${i})`);
                }
            }
        } catch (e) {
            this.logger.error(`[GRID] Build failed: ${e.message}`);
            this._cancelAllOrders();
            this.active = false;
            return [];
        }

        return placed;
    }

    /**
     * Stop grid trading and clean up
     * @returns {string} Status message
     */
    async stopGrid() {
        if (!this.active) {
            return "Grid not active";
        }

        this.active = false;
        this._stopUpdateLoop();
        const coin = this.coin;

        this.logger.info(`[GRID] Stopping grid on ${coin}...`);

        // Cancel all orders (only successfully-cancelled ones are removed from tracking)
        const cancelResult = await this._cancelAllOrders();

        // Close any open position
        const positionSize = Number(this.wayfinder.getPositionSize(coin)) || 0;
        if (Math.abs(positionSize) > 0) {
            this.logger.info(`[GRID] Closing position: ${positionSize} ${coin}`);
            this.wayfinder.closePosition(coin);
        }

        // Log PnL summary
        this.logger.info(`[GRID] Grid stopped. Total orders filled: ${this.filledOrders.length}`);
        this.logger.info(`[GRID] Estimated PnL: $${this.totalPnL.toFixed(2)}`);

        // DO NOT blindly clear gridOrders — _cancelAllOrders already removed
        // confirmed cancels. Anything still in the Map is a LIVE order.
        if (cancelResult.failed > 0) {
            this.logger.warn(
                `[GRID] ⚠️ ${cancelResult.failed} order(s) still live after stop — manual intervention may be required.`
            );
            return `⚠️ Grid stopped on ${coin}, but ${cancelResult.failed} order(s) failed to cancel: ${cancelResult.failedIds.join(", ")}`;
        }

        return `✅ Grid stopped on ${coin}`;
    }

    /**
     * Cancel all tracked grid orders via Wayfinder SDK.
     * Synchronous SDK calls (execSync) — kept async for caller compatibility.
     * Orders are only removed from tracking once cancel is confirmed, so
     * failures remain visible and can be retried/escalated.
     * @private
     * @returns {{cancelled: number, failed: number, failedIds: string[]}}
     */
    async _cancelAllOrders() {
        let cancelled = 0;
        const failedIds = [];

        // Snapshot entries first so we can mutate the Map safely while iterating.
        const entries = [...this.gridOrders.entries()];

        for (const [orderId, order] of entries) {
            try {
                const res = this.wayfinder.cancelOrder(this.coin, orderId);

                // _exec returns null on failure; a truthy result means the CLI succeeded.
                if (res) {
                    this.gridOrders.delete(orderId);
                    cancelled++;
                    this.logger.info(
                        `[GRID] Cancelled ${orderId} (${order.side} @ $${order.price.toFixed(2)})`
                    );
                } else {
                    failedIds.push(orderId);
                    this.logger.error(
                        `[GRID] Cancel returned no result for ${orderId} (${order.side} @ $${order.price.toFixed(2)})`
                    );
                }
            } catch (e) {
                failedIds.push(orderId);
                this.logger.error(`[GRID] Failed to cancel ${orderId}: ${e.message}`);
            }
        }

        if (failedIds.length > 0) {
            this.logger.warn(
                `[GRID] ${failedIds.length} order(s) could NOT be cancelled and remain LIVE: ${failedIds.join(", ")}`
            );
        } else {
            this.logger.info(`[GRID] All ${cancelled} order(s) cancelled successfully`);
        }

        return { cancelled, failed: failedIds.length, failedIds };
    }

    /**
     * Check if price is still within range bounds
     * @param {number} currentPrice - Current market price
     * @returns {boolean} True if range was breached
     */
    async checkRangeBound(currentPrice) {
        if (!this.active || !this.basePrice) return false;
        
        const movePct = Math.abs((currentPrice - this.basePrice) / this.basePrice) * 100;
        
        if (movePct >= this.rangeBoundPct) {
            this.logger.warn(`[GRID] Range bound breached! Price moved ${movePct.toFixed(2)}% (limit: ${this.rangeBoundPct}%)`);
            await this.stopGrid();
            return true;
        }
        
        return false;
    }

    /**
     * Update grid status - call periodically to check fills and rebalance
     * @param {number} currentPrice - Current market price
     */
    update(currentPrice) {
        if (!this.active) return;

        // Check range bound
        this.checkRangeBound(currentPrice);

        // Safely get position and PnL with fallbacks
        const position = Number(this.wayfinder.getPositionSize(this.coin)) || 0;
        const unrealizedPnl = Number(this.wayfinder.getUnrealizedPnl(this.coin)) || 0;
        
        // Log status periodically
        this.logger.info(`[GRID] ${this.coin} @ $${currentPrice.toFixed(2)} | Position: ${position.toFixed(4)} | Unrealized PnL: $${unrealizedPnl.toFixed(2)}`);

        // In a full implementation, we would:
        // 1. Check which orders were filled via getOrderHistory or WebSocket
        // 2. Replace filled orders with opposite side orders
        // 3. Track realized PnL
        // 4. Update this.filledOrders and this.totalPnL
    }

    /**
     * Start automatic update loop
     * @private
     */
    _startUpdateLoop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        
        // Update every 30 seconds
        this.updateInterval = setInterval(() => {
            try {
                const price = this.wayfinder.getPrice(this.coin);
                if (Number.isFinite(price)) {
                    this.update(price);
                }
            } catch (e) {
                this.logger.error(`[GRID] Update loop error: ${e.message}`);
            }
        }, 30000);
        
        this.logger.info(`[GRID] Auto-update started (30s interval)`);
    }

    /**
     * Stop automatic update loop
     * @private
     */
    _stopUpdateLoop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            this.logger.info(`[GRID] Auto-update stopped`);
        }
    }

    /**
     * Get grid status summary
     * @returns {Object} Grid status
     */
    getStatus() {
        return {
            active: this.active,
            coin: this.coin,
            basePrice: this.basePrice,
            gridLevels: this.gridLevels,
            spacingPct: this.gridSpacingPct,
            openOrders: this.gridOrders.size,
            filledOrders: this.filledOrders.length,
            totalPnL: this.totalPnL
        };
    }
}

module.exports = GridStrategy;
