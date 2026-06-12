const { calculateADX, calculateATR, calculateBollingerBands } = require('./indicators');

class RegimeDetector {
    constructor(logger, config = {}) {
        this.logger = logger || console;

        // Configurable thresholds (can be overridden)
        this.config = {
            adxTrending: config.adxTrending ?? 28,
            adxRanging: config.adxRanging ?? 18,
            atrHighVolPct: config.atrHighVolPct ?? 3.8,
            bbWidthHighVol: config.bbWidthHighVol ?? 6.0,
            bbWidthRanging: config.bbWidthRanging ?? 3.5,
            minBars: config.minBars ?? 50,
            historyLength: config.historyLength ?? 8,
            ...config
        };

        this.lastRegime = null;
        this.regimeHistory = [];
        this.persistenceCount = 0; // Real hysteresis counter
        this.requiredPersistence = 2; // Need N consecutive same readings
    }

    // Helper to safely get the last value whether it's an array or scalar
    getLastValue(value) {
        if (Array.isArray(value)) {
            return value[value.length - 1];
        }
        return value;
    }

    detect(ohlcv) {
        if (!ohlcv || ohlcv.length < this.config.minBars) {
            return { type: 'UNKNOWN', confidence: 0, reason: 'Insufficient data' };
        }

        const closes = ohlcv.map(c => c.c);
        const highs = ohlcv.map(c => c.h);
        const lows = ohlcv.map(c => c.l);
        const lastClose = closes[closes.length - 1];

        // === Calculate indicators with defensive extraction ===
        let adxRaw, atrRaw, bbRaw;
        try {
            // ADX expects array of objects with h/l/c properties
            adxRaw = calculateADX(ohlcv, 14);
            atrRaw = calculateATR(highs, lows, closes, 14);
            bbRaw = calculateBollingerBands(ohlcv, 20, 2);
        } catch (e) {
            this.logger?.warn?.(`[RegimeDetector] Indicator calculation failed: ${e.message}`);
            return { type: 'UNKNOWN', confidence: 0, reason: 'Indicator error' };
        }

        const currentAdx = this.getLastValue(adxRaw);
        const currentAtr = this.getLastValue(atrRaw);
        const currentAtrPct = (currentAtr / lastClose) * 100;

        // Handle both possible BB return shapes
        let bbWidth = 0;
        if (bbRaw && typeof bbRaw === 'object') {
            const upper = this.getLastValue(bbRaw.upper ?? bbRaw);
            const lower = this.getLastValue(bbRaw.lower ?? bbRaw);
            const middle = this.getLastValue(bbRaw.middle ?? bbRaw);
            if (middle > 0) {
                bbWidth = ((upper - lower) / middle) * 100;
            }
        }

        // === NaN / Invalid guards ===
        if (!Number.isFinite(currentAdx) || !Number.isFinite(currentAtrPct) || !Number.isFinite(bbWidth)) {
            return { type: 'UNKNOWN', confidence: 0, reason: 'Invalid indicator values' };
        }

        // === Regime Logic with Dead Zone ===
        let regime = 'RANGING';
        let confidence = 55;

        if (currentAdx > this.config.adxTrending) {
            regime = 'TRENDING';
            confidence = 85;
        } 
        else if (currentAdx < this.config.adxRanging && bbWidth < this.config.bbWidthRanging) {
            regime = 'RANGING';
            confidence = 80;
        } 
        else if (currentAtrPct > this.config.atrHighVolPct || bbWidth > this.config.bbWidthHighVol) {
            regime = 'HIGH_VOLATILITY';
            confidence = 70;
        } 
        else if (currentAdx >= this.config.adxRanging && currentAdx <= this.config.adxTrending) {
            // ADX dead zone
            regime = 'TRANSITIONING';
            confidence = 50;
        }

        // === Real Hysteresis (persistence) ===
        if (this.lastRegime && this.lastRegime.type === regime) {
            this.persistenceCount++;
            confidence = Math.min(95, confidence + Math.min(this.persistenceCount * 5, 20));
        } else {
            this.persistenceCount = 0;
        }

        // Only change regime after enough persistence
        let finalRegime = regime;
        if (this.lastRegime && this.persistenceCount < this.requiredPersistence) {
            finalRegime = this.lastRegime.type;
        }

        // === Light smoothing using history ===
        this.regimeHistory.push(finalRegime);
        if (this.regimeHistory.length > this.config.historyLength) {
            this.regimeHistory.shift();
        }

        // Optional: majority vote from recent history for extra stability
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
            timestamp: Date.now()
        };

        this.lastRegime = result;
        return result;
    }

    reset() {
        this.lastRegime = null;
        this.regimeHistory = [];
        this.persistenceCount = 0;
    }
}

module.exports = RegimeDetector;
