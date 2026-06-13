const fs = require('fs');
const path = require('path');

class DataProvider {
    constructor(dataDir = './data', wayfinder = null) {
        this.dataDir = dataDir;
        this.wayfinder = wayfinder; // Optional: for live fallback
    }

    async getCandles(symbol, timeframe = '1m', limit = 150, maxAgeMinutes = 10) {
        const filename = `${symbol}_${timeframe}.json`;
        const filePath = path.join(this.dataDir, filename);

        let localCandles = [];

        // Try loading local data
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                localCandles = JSON.parse(raw);
            }
        } catch (err) {
            console.warn(`[DataProvider] Failed to read ${filename}`);
        }

        // Check if local data is stale
        const isStale = this._isDataStale(localCandles, maxAgeMinutes);

        if (!isStale && localCandles.length > 0) {
            return this._normalizeCandles(localCandles.slice(-limit));
        }

        // === Live Fetch Fallback ===
        if (this.wayfinder && typeof this.wayfinder.getCandles === 'function') {
            try {
                console.log(`[DataProvider] Local data stale for ${symbol}. Fetching live candles...`);
                const liveCandles = await this.wayfinder.getCandles(symbol, timeframe, limit);
                
                if (liveCandles && liveCandles.length > 0) {
                    // Optionally merge with local data here if needed
                    return this._normalizeCandles(liveCandles);
                }
            } catch (err) {
                console.warn(`[DataProvider] Live fetch failed for ${symbol}: ${err.message}`);
            }
        }

        // Final fallback to whatever local data we have
        if (localCandles.length > 0) {
            console.warn(`[DataProvider] Using possibly stale data for ${symbol}`);
            return this._normalizeCandles(localCandles.slice(-limit));
        }

        return [];
    }

    _isDataStale(candles, maxAgeMinutes) {
        if (!candles || candles.length === 0) return true;

        const lastCandle = candles[candles.length - 1];
        const lastTimestamp = lastCandle.t || lastCandle.timestamp || lastCandle[0];

        if (!lastTimestamp) return true;

        const ageMinutes = (Date.now() - lastTimestamp) / (1000 * 60);
        return ageMinutes > maxAgeMinutes;
    }

    _normalizeCandles(candles) {
        return candles.map(c => ({
            t: c.t || c.timestamp || c[0],
            o: c.o || c.open || c[1],
            h: c.h || c.high || c[2],
            l: c.l || c.low || c[3],
            c: c.c || c.close || c[4],
            v: c.v || c.volume || c[5] || 0
        }));
    }
}

module.exports = DataProvider;
