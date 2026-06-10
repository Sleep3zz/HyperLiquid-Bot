/**
 * Historical Data Manager
 * 
 * Downloads and stores candle data in chunks, building up a historical dataset.
 * Data is stored in the repo at data/historical/{coin}-{interval}.json
 * 
 * Usage:
 * const { downloadCandles, loadCandles } = require('./dataManager');
 * await downloadCandles('BTC', '15m', 30); // Download 30 more days
 * const candles = loadCandles('BTC', '15m'); // Load all stored data
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'historical');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getDataFile(coin, interval) {
    return path.join(DATA_DIR, `${coin}-${interval}.json`);
}

/**
 * Load existing candles from disk
 * @returns {Array} candles or empty array if no file
 */
function loadCandles(coin, interval) {
    const file = getDataFile(coin, interval);
    if (!fs.existsSync(file)) return [];
    
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        console.log(`[DATA] Loaded ${data.candles?.length || 0} candles for ${coin}/${interval}`);
        console.log(`[DATA] Date range: ${new Date(data.meta?.oldest).toISOString()} to ${new Date(data.meta?.newest).toISOString()}`);
        return data.candles || [];
    } catch (e) {
        console.error(`[DATA] Failed to load ${file}: ${e.message}`);
        return [];
    }
}

/**
 * Save candles to disk with metadata
 */
function saveCandles(coin, interval, candles) {
    const file = getDataFile(coin, interval);
    
    // Sort by time
    const sorted = [...candles].sort((a, b) => a.t - b.t);
    
    // Remove duplicates
    const unique = new Map();
    sorted.forEach(c => unique.set(c.t, c));
    const deduped = Array.from(unique.values());
    
    const data = {
        meta: {
            coin,
            interval,
            count: deduped.length,
            oldest: deduped[0]?.t || null,
            newest: deduped[deduped.length - 1]?.t || null,
            updated: Date.now()
        },
        candles: deduped
    };
    
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`[DATA] Saved ${deduped.length} candles to ${file}`);
    return deduped.length;
}

/**
 * Download candles in chunks and append to stored data
 * @param {Object} wayfinder - WayfinderAgent instance
 * @param {string} coin - Coin symbol
 * @param {string} interval - Candle interval
 * @param {number} daysToFetch - Number of days to fetch (backwards from oldest stored)
 * @returns {number} Total candles now stored
 */
async function downloadCandles(wayfinder, coin, interval, daysToFetch = 30) {
    // Load existing data
    const existing = loadCandles(coin, interval);
    const existingTimes = new Set(existing.map(c => c.t));
    
    // Determine time range to fetch
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    let fetchEnd, fetchStart;
    if (existing.length === 0) {
        // No data yet - fetch from now backwards
        fetchEnd = now;
        fetchStart = now - (daysToFetch * dayMs);
    } else {
        // Have data - fetch backwards from oldest candle
        const oldest = Math.min(...existing.map(c => c.t));
        fetchEnd = oldest - 1; // Just before oldest
        fetchStart = oldest - (daysToFetch * dayMs);
    }
    
    console.log(`[FETCH] Downloading ${daysToFetch} days of ${coin}/${interval}`);
    console.log(`[FETCH] Range: ${new Date(fetchStart).toISOString()} to ${new Date(fetchEnd).toISOString()}`);
    
    // Fetch in chunks
    const chunkDays = 10;
    const chunks = Math.ceil(daysToFetch / chunkDays);
    const allNewCandles = [];
    
    for (let i = 0; i < chunks; i++) {
        const chunkEnd = fetchEnd - (i * chunkDays * dayMs);
        const chunkStart = chunkEnd - (chunkDays * dayMs);
        
        try {
            console.log(`[FETCH] Chunk ${i + 1}/${chunks}: ${new Date(chunkStart).toISOString()}...`);
            const candles = await wayfinder.getHistoricalCandles(coin, interval, 5000, chunkStart, chunkEnd);
            
            if (candles && candles.length > 0) {
                // Filter out duplicates
                const newOnes = candles.filter(c => !existingTimes.has(c.t));
                allNewCandles.push(...newOnes);
                console.log(`[FETCH] Got ${candles.length} candles, ${newOnes.length} new`);
            } else {
                console.log(`[FETCH] No data for this chunk`);
            }
        } catch (err) {
            console.error(`[FETCH] Chunk ${i + 1} failed: ${err.message}`);
        }
        
        // Rate limit
        if (i < chunks - 1) await new Promise(r => setTimeout(r, 1000));
    }
    
    // Merge and save
    const combined = [...existing, ...allNewCandles];
    const saved = saveCandles(coin, interval, combined);
    
    console.log(`[DATA] Total stored: ${saved} candles (~${(saved / 96).toFixed(1)} days)`);
    return saved;
}

/**
 * Get extended candles - combines stored + fresh API data
 * Returns up to requested days, prioritizing stored data
 */
async function getExtendedCandles(wayfinder, coin, interval, days = 90) {
    const stored = loadCandles(coin, interval);
    const storedDays = stored.length / 96; // 96 15m candles per day
    
    console.log(`[DATA] Have ${stored.length} candles stored (${storedDays.toFixed(1)} days)`);
    
    if (storedDays >= days) {
        console.log(`[DATA] Using stored data (sufficient)`);
        return stored.slice(-days * 96); // Return last N days
    }
    
    // Need more data
    const needed = Math.ceil(days - storedDays);
    console.log(`[DATA] Need ${needed} more days, downloading...`);
    await downloadCandles(wayfinder, coin, interval, needed + 5); // Buffer
    
    return loadCandles(coin, interval);
}

module.exports = {
    loadCandles,
    saveCandles,
    downloadCandles,
    getExtendedCandles,
    getDataFile
};
