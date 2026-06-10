/**
 * Binance Data Fetcher via CCXT
 * 
 * Fetches historical candle data from Binance (free, no API key needed)
 * and stores it in the same format as HyperLiquid data.
 * 
 * Binance has years of historical data vs HyperLiquid's ~52 days.
 * 
 * Usage:
 * const { downloadBinanceCandles } = require('./binanceDataFetcher');
 * await downloadBinanceCandles('BTC/USDT', '15m', 180);
 */

const ccxt = require('ccxt');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'historical');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Fetch candles from Binance using CCXT
 * @param {string} symbol - Trading pair (e.g., 'BTC/USDT')
 * @param {string} timeframe - Candle interval (e.g., '15m', '1h')
 * @param {number} days - Number of days to fetch
 * @returns {Array} Candles in {t, o, h, l, c, v} format
 */
async function fetchBinanceCandles(symbol, timeframe, days) {
    console.log(`[BINANCE] Fetching ${days} days of ${symbol} ${timeframe}...`);
    
    const exchange = new ccxt.binance({
        enableRateLimit: true, // Respect rate limits
        options: {
            defaultType: 'spot', // Spot market (not futures)
        }
    });
    
    // Calculate start time (days ago)
    const since = exchange.milliseconds() - (days * 24 * 60 * 60 * 1000);
    const allCandles = [];
    let currentSince = since;
    
    // Fetch in chunks of 1000 (Binance max)
    while (true) {
        try {
            console.log(`[BINANCE] Fetching from ${new Date(currentSince).toISOString()}...`);
            const candles = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
            
            if (!candles || candles.length === 0) {
                console.log('[BINANCE] No more data');
                break;
            }
            
            // Convert CCXT format [ts, o, h, l, c, v] to our format {t, o, h, l, c, v}
            const formatted = candles.map(c => ({
                t: c[0],           // timestamp
                o: c[1],           // open
                h: c[2],           // high
                l: c[3],           // low
                c: c[4],           // close
                v: c[5]            // volume
            }));
            
            allCandles.push(...formatted);
            console.log(`[BINANCE] Got ${candles.length} candles (total: ${allCandles.length})`);
            
            // Update since to last candle + 1ms for next batch
            currentSince = candles[candles.length - 1][0] + 1;
            
            // Stop if we got less than 1000 (no more data)
            if (candles.length < 1000) {
                break;
            }
            
            // Small delay to be nice to API
            await new Promise(r => setTimeout(r, 100));
            
        } catch (err) {
            console.error('[BINANCE] Error:', err.message);
            if (err.message.includes('rate limit')) {
                console.log('[BINANCE] Rate limit hit, waiting 5s...');
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }
            throw err;
        }
    }
    
    console.log(`[BINANCE] Total fetched: ${allCandles.length} candles (~${(allCandles.length / (timeframe === '15m' ? 96 : timeframe === '1h' ? 24 : 1)).toFixed(1)} days)`);
    return allCandles;
}

/**
 * Save candles to disk
 */
function saveCandles(coin, interval, candles) {
    // Convert coin/USDT format to coin-INTERVAL format
    const fileCoin = coin.replace('/USDT', '').replace('/USD', '');
    const file = path.join(DATA_DIR, `${fileCoin}-${interval}.json`);
    
    // Sort and dedupe
    const sorted = [...candles].sort((a, b) => a.t - b.t);
    const unique = new Map();
    sorted.forEach(c => unique.set(c.t, c));
    const deduped = Array.from(unique.values());
    
    const data = {
        meta: {
            coin: fileCoin,
            interval,
            count: deduped.length,
            oldest: deduped[0]?.t || null,
            newest: deduped[deduped.length - 1]?.t || null,
            updated: Date.now(),
            source: 'binance'
        },
        candles: deduped
    };
    
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`[BINANCE] Saved ${deduped.length} candles to ${file}`);
    return deduped.length;
}

/**
 * Download and save Binance candles
 * @param {string} symbol - e.g., 'BTC/USDT'
 * @param {string} timeframe - e.g., '15m'
 * @param {number} days - e.g., 180
 */
async function downloadBinanceCandles(symbol, timeframe, days) {
    try {
        const candles = await fetchBinanceCandles(symbol, timeframe, days);
        const coin = symbol.split('/')[0];
        return saveCandles(coin, timeframe, candles);
    } catch (err) {
        console.error('[BINANCE] Failed:', err.message);
        throw err;
    }
}

module.exports = {
    fetchBinanceCandles,
    downloadBinanceCandles,
    saveCandles
};
