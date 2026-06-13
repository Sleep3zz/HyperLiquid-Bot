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
        
        // Rate limiting
        this.lastRequestTime = 0;
        this.minRequestInterval = 100; // 100ms between requests
        this.requestQueue = [];
        this.processingQueue = false;
    }
    
    /**
     * Rate limited request handler
     */
    async _rateLimitedRequest(requestFn) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ fn: requestFn, resolve, reject });
            this._processQueue();
        });
    }
    
    async _processQueue() {
        if (this.processingQueue || this.requestQueue.length === 0) return;
        this.processingQueue = true;
        
        while (this.requestQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            
            if (timeSinceLastRequest < this.minRequestInterval) {
                await new Promise(r => setTimeout(r, this.minRequestInterval - timeSinceLastRequest));
            }
            
            const { fn, resolve, reject } = this.requestQueue.shift();
            this.lastRequestTime = Date.now();
            
            try {
                const result = await fn();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }
        
        this.processingQueue = false;
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
        return await this._rateLimitedRequest(() => this.makeRequest('/info', payload));
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

    /**
     * Get candle data for a coin
     * @param {string} coin - Coin symbol (e.g., 'BTC')
     * @param {string} interval - Candle interval (e.g., '15m', '1h')
     * @param {number} limit - Number of candles to fetch
     */
    async getCandles(coin, interval = '15m', limit = 150) {
        try {
            // Convert interval to Hyperliquid format
            const intervalMap = {
                '1m': '1m',
                '5m': '5m',
                '15m': '15m',
                '30m': '30m',
                '1h': '1h',
                '2h': '2h',
                '4h': '4h',
                '1d': '1d'
            };
            const hlInterval = intervalMap[interval] || '15m';

            // Calculate start time (limit * interval minutes ago)
            const intervalMinutes = this._intervalToMinutes(hlInterval);
            const endTime = Date.now();
            const startTime = endTime - (limit * intervalMinutes * 60 * 1000);

            const payload = {
                type: 'candleSnapshot',
                req: {
                    coin: coin,
                    interval: hlInterval,
                    startTime: startTime,
                    endTime: endTime
                }
            };

            const candles = await this._rateLimitedRequest(() => this.makeRequest('/info', payload));
            
            if (!Array.isArray(candles)) {
                throw new Error('Invalid candle data received');
            }

            // Format candles to standard OHLCV format
            return candles.map(c => ({
                t: c.t,           // timestamp
                o: parseFloat(c.o), // open
                h: parseFloat(c.h), // high
                l: parseFloat(c.l), // low
                c: parseFloat(c.c), // close
                v: parseFloat(c.v)  // volume
            }));
        } catch (error) {
            this.logger.error(`[REST] Error fetching candles for ${coin}:`, error.message);
            throw error;
        }
    }

    /**
     * Convert interval string to minutes
     */
    _intervalToMinutes(interval) {
        const map = {
            '1m': 1,
            '5m': 5,
            '15m': 15,
            '30m': 30,
            '1h': 60,
            '2h': 120,
            '4h': 240,
            '1d': 1440
        };
        return map[interval] || 15;
    }
}

module.exports = HyperliquidRESTPriceFeed;
