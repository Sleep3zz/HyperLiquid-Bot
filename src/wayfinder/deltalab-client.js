const { execSync } = require('child_process');

/**
 * DeltaLabClient - Interface to Wayfinder Delta Lab for market data
 * 
 * Provides access to:
 * - Historical funding rates
 * - Perp market screening
 * - Historical price data
 * - Market metadata
 */
class DeltaLabClient {
    constructor(config = {}) {
        this.sdkPath = config.sdkPath || process.env.WAYFINDER_SDK_PATH || process.cwd();
        this.logger = config.logger || console;
        this.cache = new Map();
        this.cacheExpiry = config.cacheExpiry || 60000; // 1 minute default
    }

    /**
     * Execute a Wayfinder resource command
     * @private
     */
    _executeResource(uri) {
        const cmd = `poetry run wayfinder resource ${uri}`;
        
        try {
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: this.sdkPath,
                timeout: 30000 
            });
            
            // Handle empty results
            if (!result || result.trim() === '') {
                return null;
            }
            
            const parsed = JSON.parse(result);
            
            // Handle wrapped responses from wayfinder_paths
            if (parsed && parsed.data !== undefined) {
                return parsed.data;
            }
            
            return parsed;
        } catch (error) {
            this.logger.error(`Delta Lab query failed for ${uri}:`, error.message);
            // Return null instead of throwing to allow graceful degradation
            return null;
        }
    }

    /**
     * Get cached data or fetch fresh
     * @private
     */
    _getCached(key, fetchFn) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        
        const data = fetchFn();
        this.cache.set(key, { data, timestamp: Date.now() });
        return data;
    }

    /**
     * Get funding rates for perp markets
     * @param {string} [symbol] - Specific symbol or null for all
     * @returns {Promise<Object|Array>} Funding rate data
     */
    async getFundingRates(symbol = null) {
        const cacheKey = `funding_${symbol || 'all'}`;
        
        return this._getCached(cacheKey, () => {
            const data = this._executeResource('wayfinder://hyperliquid/markets');
            
            // Handle null/undefined response
            if (!data) {
                return [];
            }
            
            // Handle array response
            if (Array.isArray(data)) {
                if (symbol) {
                    const market = data.find(m => m.coin === symbol || m.symbol === symbol);
                    return market || null;
                }
                // Sort by funding rate (highest first)
                return data.sort((a, b) => (b.funding_rate || 0) - (a.funding_rate || 0));
            }
            
            // Handle single object response
            if (symbol && (data.coin === symbol || data.symbol === symbol)) {
                return data;
            }
            
            return [];
        });
    }

    /**
     * Get top funding rate opportunities
     * @param {number} [count=10] - Number of results
     * @param {string} [direction='highest'] - 'highest', 'lowest', 'extreme'
     * @returns {Promise<Array>} Top opportunities
     */
    async getTopFundingOpportunities(count = 10, direction = 'highest') {
        const rates = await this.getFundingRates();
        
        if (direction === 'highest') {
            // Highest positive rates (best for shorting)
            return rates
                .filter(r => r.funding_rate > 0)
                .slice(0, count);
        } else if (direction === 'lowest') {
            // Most negative rates (best for longing)
            return rates
                .filter(r => r.funding_rate < 0)
                .sort((a, b) => a.funding_rate - b.funding_rate)
                .slice(0, count);
        } else if (direction === 'extreme') {
            // Highest absolute rates
            return rates
                .sort((a, b) => Math.abs(b.funding_rate) - Math.abs(a.funding_rate))
                .slice(0, count);
        }
        
        return rates.slice(0, count);
    }

    /**
     * Screen perp markets with filters
     * @param {Object} filters - Screening filters
     * @param {number} [filters.lookbackDays=7] - Historical averaging window
     * @param {number} [filters.minFundingRate] - Minimum funding rate
     * @param {number} [filters.maxFundingRate] - Maximum funding rate
     * @param {string} [filters.basis] - Basis group filter (e.g., 'BTC', 'ETH')
     * @returns {Promise<Array>} Filtered markets
     */
    async screenPerps(filters = {}) {
        const {
            lookbackDays = 7,
            minFundingRate = null,
            maxFundingRate = null,
            basis = null
        } = filters;
        
        let uri = `wayfinder://delta-lab/perps?lookback_days=${lookbackDays}`;
        
        if (basis) {
            uri += `&basis=${basis}`;
        }
        
        const data = this._executeResource(uri);
        
        // Apply additional filters
        let results = data;
        
        if (minFundingRate !== null) {
            results = results.filter(m => m.funding_rate >= minFundingRate);
        }
        
        if (maxFundingRate !== null) {
            results = results.filter(m => m.funding_rate <= maxFundingRate);
        }
        
        return results;
    }

    /**
     * Get historical funding data for analysis
     * @param {string} symbol - Market symbol (e.g., 'BTC-PERP')
     * @param {number} [lookbackDays=30] - Days of history
     * @returns {Promise<Object>} Historical funding data
     */
    async getHistoricalFunding(symbol, lookbackDays = 30) {
        const cacheKey = `hist_funding_${symbol}_${lookbackDays}`;
        
        return this._getCached(cacheKey, () => {
            return this._executeResource(
                `wayfinder://delta-lab/perps/${symbol}/funding?lookback_days=${lookbackDays}`
            );
        });
    }

    /**
     * Calculate funding rate statistics
     * @param {string} symbol - Market symbol
     * @param {number} [lookbackDays=30] - Analysis period
     * @returns {Promise<Object>} Statistics (mean, std, min, max)
     */
    async calculateFundingStats(symbol, lookbackDays = 30) {
        const history = await this.getHistoricalFunding(symbol, lookbackDays);
        
        if (!history || !history.rates || history.rates.length === 0) {
            return null;
        }
        
        const rates = history.rates.map(r => r.rate);
        const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
        const variance = rates.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / rates.length;
        const std = Math.sqrt(variance);
        
        return {
            symbol,
            lookbackDays,
            count: rates.length,
            mean: mean,
            std: std,
            min: Math.min(...rates),
            max: Math.max(...rates),
            current: rates[rates.length - 1],
            zScore: (rates[rates.length - 1] - mean) / std
        };
    }

    /**
     * Find delta-neutral opportunities (basis trading)
     * @param {Object} options - Search options
     * @param {number} [options.lookbackDays=7] - Historical window
     * @param {number} [options.minSpread=0.05] - Minimum APY spread (5%)
     * @returns {Promise<Array>} Delta-neutral opportunities
     */
    async findDeltaNeutralOpportunities(options = {}) {
        const {
            lookbackDays = 7,
            minSpread = 0.05
        } = options;
        
        return this._executeResource(
            `wayfinder://delta-lab/delta-neutral?lookback_days=${lookbackDays}&min_spread=${minSpread}`
        );
    }

    /**
     * Search for assets by symbol
     * @param {string} query - Search query
     * @param {string} [chain='all'] - Chain filter
     * @param {number} [limit=10] - Max results
     * @returns {Promise<Array>} Matching assets
     */
    async searchAssets(query, chain = 'all', limit = 10) {
        return this._executeResource(
            `wayfinder://delta-lab/assets/search/${chain}/${query}/${limit}`
        );
    }

    /**
     * Get basis group for a symbol
     * @param {string} symbol - Asset symbol
     * @returns {Promise<Object>} Basis group info
     */
    async getBasisGroup(symbol) {
        return this._executeResource(`wayfinder://delta-lab/${symbol}/basis`);
    }

    /**
     * Get current mid price for a symbol
     * @param {string} symbol - Asset symbol
     * @returns {Promise<number>} Current price
     */
    async getPrice(symbol) {
        const cacheKey = `price_${symbol}`;
        
        return this._getCached(cacheKey, () => {
            const data = this._executeResource(`wayfinder://hyperliquid/prices/${symbol}`);
            return parseFloat(data.price);
        });
    }

    /**
     * Get order book for a symbol
     * @param {string} symbol - Asset symbol
     * @param {number} [depth=10] - Order book depth
     * @returns {Promise<Object>} Order book data
     */
    async getOrderBook(symbol, depth = 10) {
        return this._executeResource(`wayfinder://hyperliquid/book/${symbol}?depth=${depth}`);
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this.cache.clear();
    }
}

module.exports = DeltaLabClient;
