/**
 * PaperTradingWayfinderWrapper - Wraps PaperTradingEngine to match Wayfinder interface
 * 
 * This allows GridStrategy and other strategies to execute paper trades
 * without modifying their code.
 */
class PaperTradingWayfinderWrapper {
    constructor(engine, logger = console) {
        this.engine = engine;
        this.logger = logger;
        this.openOrders = new Map(); // Track paper orders
        this.orderIdCounter = 1;
    }

    /**
     * Place a limit order (paper trade)
     */
    async placeLimitOrder({ coin, side, size, price, reduceOnly = false }) {
        try {
            // Generate order ID
            const orderId = `paper_${this.orderIdCounter++}`;
            
            // Store order
            const order = {
                oid: orderId,
                coin: coin,
                side: side,
                size: parseFloat(size),
                price: parseFloat(price),
                reduceOnly: reduceOnly,
                status: 'open',
                timestamp: Date.now()
            };
            
            this.openOrders.set(orderId, order);
            
            this.logger.info(`[PAPER ORDER] Placed ${side} ${size} ${coin} @ $${price} (ID: ${orderId})`);
            
            // Simulate immediate fill for paper trading
            // In real scenario, we'd check if price hits
            await this._simulateFill(order);
            
            return { success: true, orderId: orderId, status: 'filled' };
        } catch (error) {
            this.logger.error(`[PAPER ORDER] Failed to place order:`, error.message);
            throw error;
        }
    }

    /**
     * Simulate order fill
     */
    async _simulateFill(order) {
        try {
            if (order.reduceOnly) {
                // Close position
                if (this.engine && typeof this.engine.closePosition === 'function') {
                    await this.engine.closePosition(order.coin);
                }
            } else {
                // Open position
                if (this.engine && typeof this.engine.openPosition === 'function') {
                    await this.engine.openPosition({
                        symbol: order.coin,
                        side: order.side,
                        size: order.size,
                        leverage: 1 // Grid uses 1x leverage
                    });
                }
            }
            
            order.status = 'filled';
            order.fillPrice = order.price;
            order.fillTime = Date.now();
            
            this.logger.info(`[PAPER FILL] ${order.side} ${order.size} ${order.coin} @ $${order.price}`);
        } catch (error) {
            this.logger.error(`[PAPER FILL] Failed:`, error.message);
            order.status = 'error';
            order.error = error.message;
        }
    }

    /**
     * Cancel an order
     */
    async cancelOrder(coin, orderId) {
        const order = this.openOrders.get(orderId);
        if (order) {
            order.status = 'cancelled';
            this.openOrders.delete(orderId);
            this.logger.info(`[PAPER ORDER] Cancelled ${orderId}`);
            return { success: true };
        }
        return { success: false, error: 'Order not found' };
    }

    /**
     * Get position size
     */
    async getPositionSize(coin) {
        if (this.engine && typeof this.engine.getPosition === 'function') {
            const position = this.engine.getPosition(coin);
            if (position) {
                return position.side === 'LONG' ? position.size : -position.size;
            }
        }
        return 0;
    }

    /**
     * Get open orders for a coin
     */
    async getOpenOrders(coin) {
        const orders = [];
        for (const [oid, order] of this.openOrders) {
            if (order.coin === coin && order.status === 'open') {
                orders.push(order);
            }
        }
        return orders;
    }

    /**
     * Get all open orders
     */
    async getAllOpenOrders() {
        return Array.from(this.openOrders.values()).filter(o => o.status === 'open');
    }
}

module.exports = PaperTradingWayfinderWrapper;
