const BBRSIStrategy = require('../strategy/BBRSIStrategy');
const DeltaLabClient = require('./deltalab-client');

/**
 * EnhancedBBRSIStrategy - BBRSI strategy with funding rate awareness
 * 
 * Extends the base BBRSI strategy to incorporate:
 * - Funding rate filtering (avoid expensive directional trades)
 * - Market regime detection
 * - Volatility adjustments
 */
class EnhancedBBRSIStrategy extends BBRSIStrategy {
    constructor(logger, options = {}) {
        super(logger);
        
        this.deltaLab = new DeltaLabClient({ logger });
        
        // Funding rate configuration
        this.useFundingFilter = options.useFundingFilter || false;
        this.fundingLongThreshold = options.fundingLongThreshold || 0.0001;  // 0.01%
        this.fundingShortThreshold = options.fundingShortThreshold || 0.0001;
        this.fundingLookbackDays = options.fundingLookbackDays || 7;
        
        // Volatility configuration
        this.useVolatilityFilter = options.useVolatilityFilter || false;
        this.maxVolatility = options.maxVolatility || 0.05;  // 5% daily
        
        // Market regime
        this.useRegimeDetection = options.useRegimeDetection || false;
        
        // Statistics tracking
        this.signalStats = {
            total: 0,
            passed: 0,
            filteredByFunding: 0,
            filteredByVolatility: 0,
            filteredByRegime: 0
        };
    }

    /**
     * Evaluate position with enhanced filtering
     */
    async evaluatePosition(data) {
        this.signalStats.total++;
        
        // Get base signal from parent strategy
        const result = await super.evaluatePosition(data);
        
        // If no signal, return early
        if (result.signal === 'NONE') {
            return result;
        }
        
        // Apply funding rate filter
        if (this.useFundingFilter && (result.signal === 'LONG' || result.signal === 'SHORT')) {
            const fundingCheck = await this._checkFundingRate(result.signal);
            if (!fundingCheck.passed) {
                result.signal = 'NONE';
                result.filteredReason = fundingCheck.reason;
                result.fundingData = fundingCheck.data;
                this.signalStats.filteredByFunding++;
                this.logger.info(`Signal filtered by funding rate: ${fundingCheck.reason}`, fundingCheck.data);
                return result;
            }
        }
        
        // Apply volatility filter
        if (this.useVolatilityFilter) {
            const volCheck = await this._checkVolatility(data);
            if (!volCheck.passed) {
                result.signal = 'NONE';
                result.filteredReason = volCheck.reason;
                result.volatilityData = volCheck.data;
                this.signalStats.filteredByVolatility++;
                return result;
            }
        }
        
        // Apply regime detection
        if (this.useRegimeDetection) {
            const regimeCheck = await this._checkMarketRegime();
            if (!regimeCheck.passed) {
                result.signal = 'NONE';
                result.filteredReason = regimeCheck.reason;
                result.regimeData = regimeCheck.data;
                this.signalStats.filteredByRegime++;
                return result;
            }
        }
        
        // Signal passed all filters
        this.signalStats.passed++;
        result.filters = {
            funding: this.useFundingFilter,
            volatility: this.useVolatilityFilter,
            regime: this.useRegimeDetection
        };
        
        return result;
    }

    /**
     * Check funding rate before taking directional position
     * @private
     */
    async _checkFundingRate(signal) {
        try {
            // Extract base symbol (e.g., "BTC-PERP" -> "BTC")
            const baseSymbol = this.market.replace('-PERP', '');
            
            // Get funding rate statistics
            const stats = await this.deltaLab.calculateFundingStats(
                this.market, 
                this.fundingLookbackDays
            );
            
            if (!stats) {
                return { passed: true, reason: 'no_data' };
            }
            
            const currentRate = stats.current;
            
            // For LONG signals: avoid when funding is very positive (expensive to hold)
            if (signal === 'LONG') {
                if (currentRate > this.fundingLongThreshold) {
                    return {
                        passed: false,
                        reason: 'expensive_funding_long',
                        data: {
                            currentRate,
                            threshold: this.fundingLongThreshold,
                            meanRate: stats.mean,
                            zScore: stats.zScore,
                            interpretation: `Funding rate ${(currentRate * 100).toFixed(4)}% is expensive for longs`
                        }
                    };
                }
            }
            
            // For SHORT signals: avoid when funding is very negative (expensive to hold short)
            if (signal === 'SHORT') {
                if (currentRate < -this.fundingShortThreshold) {
                    return {
                        passed: false,
                        reason: 'expensive_funding_short',
                        data: {
                            currentRate,
                            threshold: -this.fundingShortThreshold,
                            meanRate: stats.mean,
                            zScore: stats.zScore,
                            interpretation: `Funding rate ${(currentRate * 100).toFixed(4)}% is expensive for shorts`
                        }
                    };
                }
            }
            
            // Check if funding rate is extreme (potential reversal signal)
            if (Math.abs(stats.zScore) > 2) {
                this.logger.info(`Extreme funding rate detected (z-score: ${stats.zScore.toFixed(2)})`, {
                    currentRate,
                    meanRate: stats.mean,
                    signal
                });
            }
            
            return {
                passed: true,
                data: {
                    currentRate,
                    meanRate: stats.mean,
                    zScore: stats.zScore
                }
            };
            
        } catch (error) {
            this.logger.error('Error checking funding rate:', error.message);
            // Fail open - allow signal if we can't check funding
            return { passed: true, reason: 'check_failed' };
        }
    }

    /**
     * Check if volatility is within acceptable range
     * @private
     */
    async _checkVolatility(data) {
        try {
            // Calculate realized volatility from recent candles
            const lookback = Math.min(20, data.length - 1);
            const returns = [];
            
            for (let i = data.length - lookback; i < data.length; i++) {
                const prev = parseFloat(data[i - 1].c);
                const curr = parseFloat(data[i].c);
                returns.push((curr - prev) / prev);
            }
            
            // Calculate standard deviation of returns (daily volatility)
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
            const volatility = Math.sqrt(variance);
            
            if (volatility > this.maxVolatility) {
                return {
                    passed: false,
                    reason: 'high_volatility',
                    data: {
                        currentVol: volatility,
                        maxVol: this.maxVolatility,
                        interpretation: `Volatility ${(volatility * 100).toFixed(2)}% exceeds threshold ${(this.maxVolatility * 100).toFixed(2)}%`
                    }
                };
            }
            
            return {
                passed: true,
                data: { volatility }
            };
            
        } catch (error) {
            this.logger.error('Error checking volatility:', error.message);
            return { passed: true, reason: 'check_failed' };
        }
    }

    /**
     * Detect market regime (trending vs ranging)
     * @private
     */
    async _checkMarketRegime() {
        try {
            // Get ADX value from indicators already calculated in parent
            // ADX > 25 typically indicates trending market
            // ADX < 20 typically indicates ranging market
            
            // For now, simplified check - can be enhanced with ML regime detection
            return { passed: true, data: { regime: 'unknown' } };
            
        } catch (error) {
            this.logger.error('Error checking market regime:', error.message);
            return { passed: true, reason: 'check_failed' };
        }
    }

    /**
     * Get signal statistics
     */
    getSignalStats() {
        return {
            ...this.signalStats,
            passRate: this.signalStats.total > 0 
                ? (this.signalStats.passed / this.signalStats.total * 100).toFixed(2) + '%'
                : 'N/A'
        };
    }

    /**
     * Reset signal statistics
     */
    resetStats() {
        this.signalStats = {
            total: 0,
            passed: 0,
            filteredByFunding: 0,
            filteredByVolatility: 0,
            filteredByRegime: 0
        };
    }
}

module.exports = EnhancedBBRSIStrategy;
