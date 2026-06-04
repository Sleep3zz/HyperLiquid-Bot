/**
 * HyperliquidRESTPriceFeed - Real-time prices via REST API polling
 * 
 * Uses Hyperliquid REST API instead of WebSocket
 * More reliable in environments with WebSocket issues
 */

const https = require('https');

class HyperliquidRESTPriceFeed {
    constructor(config = {}) {
        this.apiHost = 'api.hyperliquid.xyz';
        this.logger = config.logger || console;
        this.cache = new Map();
        this.cacheExpiry = 5000; // 5 seconds
        this.updateInterval = config.updateInterval || 10000; // 10 seconds
        this.intervals = new Map();
    }

    /**
     * Make HTTPS request to Hyperliquid
     */
    async makeRequest(endpoint, payload) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(payload);
            
            const options = {
                hostname: this.apiHost,
                path: endpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                },
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        resolve(parsed);
                    } catch (error) {
                        reject(new Error(`Parse error: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Get all mid prices
     */
    async getAllMids() {
        const payload = { type: 'allMids' };
        return await this.makeRequest('/info', payload);
    }

    /**
     * Get price for a specific coin
     */
    async getPrice(coin) {
        try {
            // Check cache first
            const cached = this.cache.get(coin);
            if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
                return cached.price;
            }

            // Fetch fresh data
            const mids = await this.getAllMids();
            
            if (mids && mids[coin]) {
                const price = parseFloat(mids[coin]);
                this.cache.set(coin, { price, timestamp: Date.now() });
                return price;
            }

            throw new Error(`Price not found for ${coin}`);
        } catch (error) {
            this.logger.error(`[REST] Error fetching ${coin}:`, error.message);
            throw error;
        }
    }

    /**
     * Get prices for multiple coins
     */
    async getPrices(coins) {
        const mids = await this.getAllMids();
        const prices = {};
        
        for (const coin of coins) {
            if (mids && mids[coin]) {
                prices[coin] = parseFloat(mids[coin]);
                this.cache.set(coin, { price: prices[coin], timestamp: Date.now() });
            } else {
                throw new Error(`Price not found for ${coin}`);
            }
        }
        
        return prices;
    }

    /**
     * Start polling for a coin
     */
    startPolling(coin, callback) {
        if (this.intervals.has(coin)) {
            return; // Already polling
        }

        this.logger.info(`[REST] Starting price polling for ${coin}`);
        
        const interval = setInterval(async () => {
            try {
                const price = await this.getPrice(coin);
                if (callback) {
                    callback(coin, price);
                }
            } catch (error) {
                this.logger.error(`[REST] Polling error for ${coin}:`, error.message);
            }
        }, this.updateInterval);

        this.intervals.set(coin, interval);
    }

    /**
     * Stop polling for a coin
     */
    stopPolling(coin) {
        const interval = this.intervals.get(coin);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(coin);
            this.logger.info(`[REST] Stopped price polling for ${coin}`);
        }
    }

    /**
     * Stop all polling
     */
    stopAll() {
        for (const [coin, interval] of this.intervals) {
            clearInterval(interval);
        }
        this.intervals.clear();
    }
}

module.exports = HyperliquidRESTPriceFeed;
