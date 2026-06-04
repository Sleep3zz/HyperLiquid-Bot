/**
 * WayfinderAdapterFixed - Real-time price feed using Hyperliquid WebSocket
 * 
 * No fallback prices - uses actual market data via WebSocket
 */

const HyperliquidWebSocketPriceFeed = require('../price-feeds/hyperliquid-ws');

class WayfinderAdapterFixed {
    constructor(config = {}) {
        this.logger = config.logger || console;
        this.priceFeed = new HyperliquidWebSocketPriceFeed({ logger: this.logger });
        this.isConnected = false;
        this.connectionRetries = 0;
        this.maxRetries = 5;
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Connect on initialization
        this.connect();
    }

    setupEventHandlers() {
        this.priceFeed.on('connected', () => {
            this.logger.info('[ADAPTER] Hyperliquid WebSocket connected');
            this.isConnected = true;
            this.connectionRetries = 0;
        });
        
        this.priceFeed.on('disconnected', () => {
            this.logger.warn('[ADAPTER] Hyperliquid WebSocket disconnected');
            this.isConnected = false;
        });
        
        this.priceFeed.on('error', (error) => {
            this.logger.error('[ADAPTER] WebSocket error:', error.message);
        });
        
        this.priceFeed.on('price', ({ coin, price }) => {
            this.logger.debug(`[ADAPTER] Price update: ${coin} = $${price}`);
        });
    }

    async connect() {
        try {
            this.priceFeed.connect();
            
            // Wait for connection
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);
                
                this.priceFeed.once('connected', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
            
        } catch (error) {
            this.logger.error('[ADAPTER] Connection failed:', error.message);
            this.connectionRetries++;
            
            if (this.connectionRetries < this.maxRetries) {
                this.logger.info(`[ADAPTER] Retrying connection (${this.connectionRetries}/${this.maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.connect();
            } else {
                throw new Error('Max connection retries reached');
            }
        }
    }

    /**
     * Get real-time price from WebSocket
     */
    async getPrice(symbol) {
        const coin = symbol.replace('-PERP', '');
        
        // Subscribe if not already
        this.priceFeed.subscribe(coin);
        
        // Wait for price with timeout
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds (100ms intervals)
        
        while (attempts < maxAttempts) {
            const price = this.priceFeed.getPrice(coin);
            
            if (price !== null) {
                return price;
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        throw new Error(`Could not get price for ${symbol} - WebSocket data not available`);
    }

    /**
     * Get funding rate (still uses Wayfinder or returns 0)
     */
    async getFundingRate(symbol) {
        // For now, return 0 as funding rates update less frequently
        // Can be enhanced to fetch from API if needed
        return 0;
    }

    /**
     * Get multiple prices
     */
    async getPrices(symbols) {
        const prices = {};
        
        for (const symbol of symbols) {
            try {
                prices[symbol] = await this.getPrice(symbol);
            } catch (error) {
                this.logger.error(`[ADAPTER] Failed to get price for ${symbol}:`, error.message);
                throw error; // Don't use fallbacks
            }
        }
        
        return prices;
    }

    /**
     * Check if connected
     */
    isReady() {
        return this.isConnected;
    }

    /**
     * Disconnect
     */
    disconnect() {
        this.priceFeed.disconnect();
    }
}

module.exports = WayfinderAdapterFixed;
