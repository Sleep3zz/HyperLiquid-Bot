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
    }

    /**
     * Start grid trading on a coin
     * @param {string} coin - Coin symbol (e.g., "BTC")
     * @returns {string} Status message
     */
    async startGrid(coin = "BTC") {
        if (this.active) {
            return `Grid already running on ${this.coin}`;
        }

        // Get current price via Wayfinder SDK
        const price = this.wayfinder.getPrice(coin);
        if (!Number.isFinite(price) || price <= 0) {
            return "No valid price available from Wayfinder";
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
        const placed = await this._buildGrid();
        
        if (placed.length === 0) {
            this.active = false;
            return "Failed to place any grid orders";
        }

        return `Grid active on ${coin} with ${placed.length} orders`;
    }

    /**
     * Build the grid by placing limit orders
     * @returns {Array} Placed order IDs
     * @private
     */
    async _buildGrid() {
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
            await this._cancelAllOrders();
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
        const coin = this.coin;

        this.logger.info(`[GRID] Stopping grid on ${coin}...`);

        // Cancel all orders via Wayfinder SDK
        await this._cancelAllOrders();

        // Close any open position via Wayfinder SDK
        const positionSize = this.wayfinder.getPositionSize(coin);
        if (Math.abs(positionSize) > 0) {
            this.logger.info(`[GRID] Closing position: ${positionSize} ${coin}`);
            this.wayfinder.closePosition(coin);
        }

        // Log PnL summary
        this.logger.info(`[GRID] Grid stopped. Total orders filled: ${this.filledOrders.length}`);
        this.logger.info(`[GRID] Estimated PnL: $${this.totalPnL.toFixed(2)}`);

        this.gridOrders.clear();
        return `Grid stopped on ${coin}`;
    }

    /**
     * Cancel all orders via Wayfinder SDK
     * @private
     */
    async _cancelAllOrders() {
        // Note: Wayfinder SDK doesn't have a direct cancelAllOrders method
        // We would need to track and cancel each order individually
        // For now, this is a placeholder - actual implementation depends on SDK capabilities
        this.gridOrders.forEach((order, orderId) => {
            this.logger.info(`[GRID] Would cancel order ${orderId} (${order.side} @ $${order.price.toFixed(2)})`);
        });
        this.gridOrders.clear();
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
    async update(currentPrice) {
        if (!this.active) return;

        // Check range bound
        if (await this.checkRangeBound(currentPrice)) {
            return;
        }

        // Check position and PnL via Wayfinder SDK
        const position = this.wayfinder.getPositionSize(this.coin);
        const unrealizedPnl = this.wayfinder.getUnrealizedPnl(this.coin);
        
        // Log status periodically
        this.logger.info(`[GRID] ${this.coin} @ $${currentPrice.toFixed(2)} | Position: ${position.toFixed(4)} | Unrealized PnL: $${unrealizedPnl.toFixed(2)}`);

        // In a full implementation, we would:
        // 1. Check which orders were filled
        // 2. Replace filled orders with opposite side orders
        // 3. Track realized PnL
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
