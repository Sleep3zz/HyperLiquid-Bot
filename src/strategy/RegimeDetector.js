const { calculateBollingerBands, calculateADX } = require("./indicators");

class RegimeDetector {
    /**
     * @param {Object} bbrsiStrategy - BBRSI strategy instance (provides bbPeriod, bbStdDev, adxPeriod, wayfinder)
     * @param {Object} logger - Logger instance (default: console)
     * @param {string} interval - Candle interval for regime detection (default: "15m" for responsiveness)
     */
    constructor(bbrsiStrategy, logger = console, interval = "15m") {
        this.bb = bbrsiStrategy;
        this.logger = logger;
        this.interval = interval; // explicit, not buried in getRegime
        this.streak = { regime: null, count: 0 };
    }

    _stable(raw, needed = 3) {
        if (raw === this.streak.regime) this.streak.count++;
        else this.streak = { regime: raw, count: 1 };
        return this.streak.count >= needed ? raw : "hold";
    }

    async getRegime(coin = "BTC") {
        const candles = await this.bb.wayfinder.getHistoricalCandles(coin, this.interval, 100);
        if (!candles || candles.length < 50) return "unknown";

        const closes = candles.map(c => Number(c.c ?? c.close));
        const highs = candles.map(c => Number(c.h ?? c.high));
        const lows = candles.map(c => Number(c.l ?? c.low));

        const bb = calculateBollingerBands(closes, this.bb.bbPeriod, this.bb.bbStdDev);
        const adx = this.bb._num(calculateADX(highs, lows, closes, this.bb.adxPeriod));

        if (![bb.upper, bb.middle, bb.lower, adx].every(Number.isFinite) || bb.middle === 0) return "unknown";

        const bandWidth = (bb.upper - bb.lower) / bb.middle;

        let raw = "neutral";
        if (adx > 25 && bandWidth > 0.03) raw = "trending";
        if (adx < 20 && bandWidth < 0.015) raw = "ranging";

        // "unknown" must never feed the hysteresis streak
        const confirmed = raw === "unknown" ? "unknown" : this._stable(raw, 3);

        this.logger.info(
            `Regime ${coin}: raw=${raw} confirmed=${confirmed} ` +
            `(adx=${adx.toFixed(1)} bw=${bandWidth.toFixed(4)} streak=${this.streak.count})`
        );

        return confirmed;
    }
}

module.exports = RegimeDetector;
