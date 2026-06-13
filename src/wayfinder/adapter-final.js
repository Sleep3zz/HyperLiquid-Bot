/**
 * WayfinderAdapterFinal - Real-time prices via Hyperliquid REST API
 * 
 * NO FALLBACK PRICES - Uses actual Hyperliquid API
 */

const HyperliquidRESTPriceFeed = require('../price-feeds/hyperliquid-rest');

class WayfinderAdapterFinal {
    constructor(config = {}) {
        this.logger = config.logger || console;
        this.feed = new HyperliquidRESTPriceFeed({ logger: this.logger });
        this.subscribedCoins = new Set();
    }

    /**
     * Get real-time price from Hyperliquid REST API
     */
    async getPrice(symbol) {
        const coin = symbol.replace('-PERP', '');
        
        // Get price from REST API (NO FALLBACKS)
        const price = await this.feed.getPrice(coin);
        
        if (price === null || price === undefined) {
            throw new Error(`Could not get price for ${symbol} from Hyperliquid API`);
        }
        
        return price;
    }

    /**
     * Get funding rate (return 0 as not critical for paper trading)
     */
    async getFundingRate(symbol) {
        // Funding rates change slowly, return 0 for simplicity
        // Can be implemented if needed
        return 0;
    }

    /**
     * Get multiple prices
     */
    async getPrices(symbols) {
        const coins = symbols.map(s => s.replace('-PERP', ''));
        const prices = await this.feed.getPrices(coins);
        
        // Convert back to symbol format
        const result = {};
        for (const [coin, price] of Object.entries(prices)) {
            result[`${coin}-PERP`] = price;
        }
        
        return result;
    }

    /**
     * Start polling for a symbol
     */
    startPolling(symbol, callback) {
        const coin = symbol.replace('-PERP', '');
        this.subscribedCoins.add(coin);
        this.feed.startPolling(coin, (c, price) => {
            if (callback) {
                callback(`${c}-PERP`, price);
            }
        });
    }

    /**
     * Stop polling
     */
    stopPolling(symbol) {
        const coin = symbol.replace('-PERP', '');
        this.subscribedCoins.delete(coin);
        this.feed.stopPolling(coin);
    }

    /**
     * Get candle data for a symbol
     * @param {string} symbol - Symbol like 'BTC-PERP'
     * @param {string} timeframe - Candle timeframe (e.g., '15m')
     * @param {number} limit - Number of candles
     */
    async getCandles(symbol, timeframe = '15m', limit = 150) {
        const coin = symbol.replace('-PERP', '');
        return await this.feed.getCandles(coin, timeframe, limit);
    }

    /**
     * Test connection
     */
    async testConnection() {
        try {
            const price = await this.getPrice('BTC-PERP');
            this.logger.info(`[ADAPTER] Connection test successful. BTC: $${price}`);
            return true;
        } catch (error) {
            this.logger.error(`[ADAPTER] Connection test failed: ${error.message}`);
            return false;
        }
    }
}

module.exports = WayfinderAdapterFinal;
