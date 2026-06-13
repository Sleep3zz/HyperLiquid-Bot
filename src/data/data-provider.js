const fs = require('fs');
const path = require('path');

class DataProvider {
    constructor(dataDir = './data') {
        this.dataDir = dataDir;
    }

    async getCandles(symbol, timeframe = '1m', limit = 150) {
        const filename = `${symbol}_${timeframe}.json`;
        const filePath = path.join(this.dataDir, filename);

        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`Data file not found: ${filename}`);
            }

            const rawData = fs.readFileSync(filePath, 'utf8');
            let candles = JSON.parse(rawData);

            // Normalize to expected format { t, o, h, l, c, v }
            if (Array.isArray(candles) && candles.length > 0) {
                // Take the most recent candles
                candles = candles.slice(-limit);

                return candles.map(c => ({
                    t: c.t || c.timestamp || c[0],
                    o: c.o || c.open || c[1],
                    h: c.h || c.high || c[2],
                    l: c.l || c.low || c[3],
                    c: c.c || c.close || c[4],
                    v: c.v || c.volume || c[5] || 0
                }));
            }

            return [];
        } catch (error) {
            console.warn(`[DataProvider] Failed to load ${filename}: ${error.message}`);
            return [];
        }
    }
}

module.exports = DataProvider;
