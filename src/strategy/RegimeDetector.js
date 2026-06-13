const config = require('config');
const { calculateADX, calculateATR, calculateBollingerBands } = require('./indicators');

class RegimeDetector {
    constructor(logger, overrides = {}) {
        this.logger = logger || console;

        // Load from central config + allow overrides
        const regimeConfig = config.has('regime') ? config.get('regime') : {};

        this.config = {
            adxTrending: overrides.adxTrending ?? regimeConfig.adx?.trending ?? 27,
            adxRanging: overrides.adxRanging ?? regimeConfig.adx?.ranging ?? 19,
            atrHighVolPercentile: overrides.atrHighVolPercentile ?? regimeConfig.atr?.highVolPercentile ?? 75,
            bbWidthHighVolPercentile: overrides.bbWidthHighVolPercentile ?? regimeConfig.bbWidth?.highVolPercentile ?? 72,
            bbWidthRangingPercentile: overrides.bbWidthRangingPercentile ?? regimeConfig.bbWidth?.rangingPercentile ?? 28,
            lookback: overrides.lookback ?? regimeConfig.detector?.lookback ?? 120,
            requiredPersistence: overrides.requiredPersistence ?? regimeConfig.detector?.requiredPersistence ?? 2,
            historyLength: overrides.historyLength ?? regimeConfig.detector?.historyLength ?? 8,
            minBars: overrides.minBars ?? 60
        };

        this.lastRegime = null;
        this.regimeHistory = [];
        this.persistenceCount = 0;

        // Rolling history for percentile calculation
        this.atrHistory = [];
        this.bbWidthHistory = [];

        // Validate configuration
        this._validateConfig();
    }

    _validateConfig() {
        const cfg = this.config;

        if (cfg.adxTrending <= cfg.adxRanging) {
            throw new Error(`Invalid regime config: adxTrending (${cfg.adxTrending}) must be greater than adxRanging (${cfg.adxRanging})`);
        }

        if (cfg.atrHighVolPercentile < 0 || cfg.atrHighVolPercentile > 100) {
            throw new Error(`atrHighVolPercentile must be between 0 and 100`);
        }

        if (cfg.bbWidthHighVolPercentile < 0 || cfg.bbWidthHighVolPercentile > 100) {
            throw new Error(`bbWidthHighVolPercentile must be between 0 and 100`);
        }

        if (cfg.bbWidthRangingPercentile < 0 || cfg.bbWidthRangingPercentile > 100) {
            throw new Error(`bbWidthRangingPercentile must be between 0 and 100`);
        }

        if (cfg.bbWidthRangingPercentile >= cfg.bbWidthHighVolPercentile) {
            throw new Error(`bbWidthRangingPercentile must be lower than bbWidthHighVolPercentile`);
        }

        if (cfg.lookback < 20) {
            throw new Error(`lookback must be at least 20 for reliable percentile calculation`);
        }

        if (cfg.requiredPersistence < 1) {
            throw new Error(`requiredPersistence must be at least 1`);
        }
    }

    getLastValue(value) {
        if (Array.isArray(value)) return value[value.length - 1];
        return value;
    }

    // Calculate percentile (e.g. 75th percentile)
    getPercentile(arr, percentile) {
        if (!arr || arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    }

    detect(ohlcv) {
        if (!ohlcv || ohlcv.length < this.config.minBars) {
            return { type: 'UNKNOWN', confidence: 0, reason: 'Insufficient data' };
        }

        const closes = ohlcv.map(c => c.c);
        const highs = ohlcv.map(c => c.h);
        const lows = ohlcv.map(c => c.l);
        const lastClose = closes[closes.length - 1];

        let adxRaw, atrRaw, bbRaw;
        try {
            adxRaw = calculateADX(highs, lows, closes, 14);
            atrRaw = calculateATR(highs, lows, closes, 14);
            bbRaw = calculateBollingerBands(closes, 20, 2);
        } catch (e) {
            return { type: 'UNKNOWN', confidence: 0, reason: 'Indicator calculation failed' };
        }

        const currentAdx = this.getLastValue(adxRaw);
        const currentAtr = this.getLastValue(atrRaw);
        const currentAtrPct = (currentAtr / lastClose) * 100;

        // BB Width
        let bbWidth = 0;
        if (bbRaw && typeof bbRaw === 'object') {
            const upper = this.getLastValue(bbRaw.upper ?? bbRaw);
            const lower = this.getLastValue(bbRaw.lower ?? bbRaw);
            const middle = this.getLastValue(bbRaw.middle ?? bbRaw);
            if (middle > 0) bbWidth = ((upper - lower) / middle) * 100;
        }

        // NaN guard
        if (!Number.isFinite(currentAdx) || !Number.isFinite(currentAtrPct) || !Number.isFinite(bbWidth)) {
            return { type: 'UNKNOWN', confidence: 0, reason: 'Invalid indicator values' };
        }

        // === Update rolling histories ===
        this.atrHistory.push(currentAtrPct);
        this.bbWidthHistory.push(bbWidth);

        if (this.atrHistory.length > this.config.lookback) this.atrHistory.shift();
        if (this.bbWidthHistory.length > this.config.lookback) this.bbWidthHistory.shift();

        // === Dynamic thresholds using percentiles ===
        const atrHighVolThreshold = this.getPercentile(this.atrHistory, this.config.atrHighVolPercentile) || 3.5;
        const bbHighVolThreshold = this.getPercentile(this.bbWidthHistory, this.config.bbWidthHighVolPercentile) || 5.5;
        const bbRangingThreshold = this.getPercentile(this.bbWidthHistory, this.config.bbWidthRangingPercentile) || 2.8;

        // === Regime Decision ===
        let regime = 'RANGING';
        let confidence = 55;

        if (currentAdx > this.config.adxTrending) {
            regime = 'TRENDING';
            confidence = 85;
        } 
        else if (currentAdx < this.config.adxRanging && bbWidth < bbRangingThreshold) {
            regime = 'RANGING';
            confidence = 80;
        } 
        else if (currentAtrPct > atrHighVolThreshold || bbWidth > bbHighVolThreshold) {
            regime = 'HIGH_VOLATILITY';
            confidence = 70;
        } 
        else if (currentAdx >= this.config.adxRanging && currentAdx <= this.config.adxTrending) {
            regime = 'TRANSITIONING';
            confidence = 50;
        }

        // === Hysteresis + Persistence ===
        if (this.lastRegime && this.lastRegime.type === regime) {
            this.persistenceCount++;
            confidence = Math.min(95, confidence + Math.min(this.persistenceCount * 5, 20));
        } else {
            this.persistenceCount = 0;
        }

        let finalRegime = regime;
        if (this.lastRegime && this.persistenceCount < this.config.requiredPersistence) {
            finalRegime = this.lastRegime.type;
        }

        // History smoothing
        this.regimeHistory.push(finalRegime);
        if (this.regimeHistory.length > this.config.historyLength) this.regimeHistory.shift();

        if (this.regimeHistory.length >= 4) {
            const counts = {};
            this.regimeHistory.forEach(r => counts[r] = (counts[r] || 0) + 1);
            const mostCommon = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
            if (counts[mostCommon] >= Math.floor(this.regimeHistory.length * 0.6)) {
                finalRegime = mostCommon;
            }
        }

        const result = {
            type: finalRegime,
            adx: currentAdx,
            atrPct: currentAtrPct,
            bbWidth: bbWidth,
            confidence,
            persistence: this.persistenceCount,
            thresholds: {
                atrHighVol: atrHighVolThreshold,
                bbHighVol: bbHighVolThreshold,
                bbRanging: bbRangingThreshold
            },
            timestamp: Date.now()
        };

        this.lastRegime = result;
        return result;
    }

    reset() {
        this.lastRegime = null;
        this.regimeHistory = [];
        this.persistenceCount = 0;
        this.atrHistory = [];
        this.bbWidthHistory = [];
    }
}

module.exports = RegimeDetector;
