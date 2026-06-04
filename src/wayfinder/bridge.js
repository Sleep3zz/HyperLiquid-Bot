const { execSync } = require('child_process');
const path = require('path');

/**
 * WayfinderBridge - Connects HyperLiquidAlgoBot to Wayfinder SDK
 * 
 * This module provides a clean interface between the bot's trading logic
 * and Wayfinder's execution capabilities for Hyperliquid perp trading.
 */
class WayfinderBridge {
    constructor(config = {}) {
        this.walletLabel = config.walletLabel || process.env.WAYFINDER_WALLET_LABEL || 'main';
        this.sdkPath = config.sdkPath || process.env.WAYFINDER_SDK_PATH || process.cwd();
        this.dryRun = config.dryRun || false;
        this.logger = config.logger || console;
    }

    /**
     * Execute a perp trade via Wayfinder SDK
     * 
     * @param {Object} params - Trade parameters
     * @param {string} params.coin - Trading pair (e.g., 'BTC', 'ETH')
     * @param {boolean} params.isBuy - True for buy/long, false for sell/short
     * @param {number} [params.size] - Position size in coin units
     * @param {number} [params.usdAmount] - Position size in USD (alternative to size)
     * @param {number} [params.leverage] - Leverage (required if using usdAmount)
     * @param {string} [params.orderType='market'] - 'market' or 'limit'
     * @param {number} [params.price] - Limit price (required for limit orders)
     * @param {boolean} [params.reduceOnly=false] - Close position only
     * @returns {Promise<Object>} Trade execution result
     */
    async executePerpTrade({ 
        coin, 
        isBuy, 
        size, 
        usdAmount, 
        leverage, 
        orderType = 'market', 
        price, 
        reduceOnly = false 
    }) {
        const isSpot = false;
        
        // Build command
        let cmdParts = [
            'poetry run wayfinder hyperliquid_execute',
            '--action place_order',
            `--wallet_label ${this.walletLabel}`,
            `--coin ${coin}`,
            `--is_spot ${isSpot}`,
            `--is_buy ${isBuy}`
        ];
        
        // Add sizing
        if (size) {
            cmdParts.push(`--size ${size}`);
        } else if (usdAmount && leverage) {
            cmdParts.push(`--usd_amount ${usdAmount}`);
            cmdParts.push('--usd_amount_kind margin');
            cmdParts.push(`--leverage ${leverage}`);
        } else {
            throw new Error('Must provide either size or usdAmount+leverage');
        }
        
        // Add order type
        if (orderType === 'limit') {
            if (!price) throw new Error('Limit orders require price');
            cmdParts.push('--order_type limit');
            cmdParts.push(`--price ${price}`);
        }
        
        // Add flags
        if (reduceOnly) {
            cmdParts.push('--reduce_only');
        }
        
        const cmd = cmdParts.join(' ');
        
        if (this.dryRun) {
            this.logger.info(`[DRY RUN] ${cmd}`);
            return { status: 'dry_run', command: cmd };
        }
        
        try {
            this.logger.info(`Executing trade: ${JSON.stringify({ coin, isBuy, size, usdAmount, leverage })}`);
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: this.sdkPath,
                timeout: 30000 
            });
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Wayfinder trade execution failed:', error.message);
            throw error;
        }
    }

    /**
     * Get current positions and PnL
     * @returns {Promise<Object>} Position state
     */
    async getPositionState() {
        const cmd = `poetry run wayfinder resource wayfinder://hyperliquid/${this.walletLabel}/state`;
        
        try {
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: this.sdkPath,
                timeout: 10000 
            });
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Failed to get position state:', error.message);
            throw error;
        }
    }

    /**
     * Get real-time funding rates
     * @returns {Promise<Array>} Market data with funding rates
     */
    async getFundingRates() {
        const cmd = 'poetry run wayfinder resource wayfinder://hyperliquid/markets';
        
        try {
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: this.sdkPath,
                timeout: 10000 
            });
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Failed to get funding rates:', error.message);
            throw error;
        }
    }

    /**
     * Place stop-loss or take-profit trigger order
     * 
     * @param {Object} params - Trigger order parameters
     * @param {string} params.coin - Trading pair
     * @param {string} params.tpsl - 'tp' for take-profit, 'sl' for stop-loss
     * @param {number} params.triggerPrice - Price that triggers the order
     * @param {number} params.size - Position size to close
     * @param {boolean} params.isBuy - Direction of closing order
     * @returns {Promise<Object>} Order result
     */
    async placeTriggerOrder({ coin, tpsl, triggerPrice, size, isBuy }) {
        const cmd = [
            'poetry run wayfinder hyperliquid_execute',
            '--action place_trigger_order',
            `--wallet_label ${this.walletLabel}`,
            `--coin ${coin}`,
            `--tpsl ${tpsl}`,
            `--trigger_price ${triggerPrice}`,
            `--size ${size}`,
            `--is_buy ${isBuy}`
        ].join(' ');
        
        if (this.dryRun) {
            this.logger.info(`[DRY RUN] ${cmd}`);
            return { status: 'dry_run', command: cmd };
        }
        
        try {
            this.logger.info(`Placing trigger order: ${JSON.stringify({ coin, tpsl, triggerPrice, size })}`);
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: this.sdkPath,
                timeout: 30000 
            });
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Failed to place trigger order:', error.message);
            throw error;
        }
    }

    /**
     * Cancel an open order
     * @param {string} coin - Trading pair
     * @param {number} orderId - Order ID to cancel
     * @returns {Promise<Object>} Cancel result
     */
    async cancelOrder(coin, orderId) {
        const cmd = [
            'poetry run wayfinder hyperliquid_execute',
            '--action cancel_order',
            `--wallet_label ${this.walletLabel}`,
            `--coin ${coin}`,
            `--order_id ${orderId}`
        ].join(' ');
        
        try {
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: this.sdkPath,
                timeout: 30000 
            });
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Failed to cancel order:', error.message);
            throw error;
        }
    }

    /**
     * Update leverage for a symbol
     * @param {string} coin - Trading pair
     * @param {number} leverage - New leverage value
     * @returns {Promise<Object>} Update result
     */
    async updateLeverage(coin, leverage) {
        const cmd = [
            'poetry run wayfinder hyperliquid_execute',
            '--action update_leverage',
            `--wallet_label ${this.walletLabel}`,
            `--coin ${coin}`,
            `--leverage ${leverage}`
        ].join(' ');
        
        try {
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: this.sdkPath,
                timeout: 30000 
            });
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Failed to update leverage:', error.message);
            throw error;
        }
    }

    /**
     * Get current price for a symbol
     * @param {string} coin - Trading pair
     * @returns {Promise<number>} Current price
     */
    async getCurrentPrice(coin) {
        const cmd = `poetry run wayfinder resource wayfinder://hyperliquid/prices/${coin}`;
        
        try {
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: this.sdkPath,
                timeout: 10000 
            });
            const data = JSON.parse(result);
            return parseFloat(data.price);
        } catch (error) {
            this.logger.error('Failed to get current price:', error.message);
            throw error;
        }
    }
}

module.exports = WayfinderBridge;
