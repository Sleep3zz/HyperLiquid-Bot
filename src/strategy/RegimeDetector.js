const { calculateADX, calculateATR, calculateBollingerBands } = require('./indicators'); // adjust path if needed

class RegimeDetector {
    constructor(logger) {
        this.logger = logger || console;
        this.lastRegime = null;
        this.regimeHistory = [];
        this.hysteresis = 2; // Prevents rapid flipping
    }

    detect(ohlcv) {
        if (!ohlcv || ohlcv.length < 50) {
            return { type: 'UNKNOWN', confidence: 0 };
        }

        const closes = ohlcv.map(c => c.c);
        const highs = ohlcv.map(c => c.h);
        const lows = ohlcv.map(c => c.l);

        // Calculate indicators - use proper API
        const currentAdx = calculateADX(ohlcv, 14);
        const currentAtr = calculateATR(highs, lows, closes, 14);
        const bb = calculateBollingerBands(ohlcv, 20, 2);

        const currentAtrPct = (currentAtr / closes[closes.length - 1]) * 100;
        const bbWidth = ((bb.upper - bb.lower) / bb.middle) * 100;

        let regime = 'RANGING';
        let confidence = 60;

        // Strong Trend
        if (currentAdx > 28) {
            regime = 'TRENDING';
            confidence = 85;
        }
        // High Volatility
        else if (currentAtrPct > 3.8 || bbWidth > 6) {
            regime = 'HIGH_VOLATILITY';
            confidence = 75;
        }
        // Clear Ranging
        else if (currentAdx < 18 && bbWidth < 3.5) {
            regime = 'RANGING';
            confidence = 80;
        }

        // Hysteresis to prevent rapid switching
        if (this.lastRegime && this.lastRegime.type === regime) {
            confidence = Math.min(95, confidence + 10);
        }

        const result = {
            type: regime,
            adx: currentAdx,
            atrPct: currentAtrPct,
            bbWidth,
            confidence,
            timestamp: Date.now()
        };

        this.lastRegime = result;
        this.regimeHistory.push(result);
        if (this.regimeHistory.length > 20) this.regimeHistory.shift();

        return result;
    }
}

module.exports = RegimeDetector;
