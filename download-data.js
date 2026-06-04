#!/usr/bin/env node
/**
 * Historical Data Fetcher for Hyperliquid
 * 
 * Fetches 90 days of OHLCV data from Hyperliquid API
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [new winston.transports.Console()]
});

// Top 10 coins by volume
const TOP_COINS = [
    'BTC-PERP',
    'ETH-PERP',
    'SOL-PERP',
    'HYPE-PERP',
    'ARB-PERP',
    'OP-PERP',
    'LINK-PERP',
    'AVAX-PERP',
    'NEAR-PERP',
    'UNI-PERP'
];

class HyperliquidDataFetcher {
    constructor() {
        this.baseDir = path.join(__dirname, 'src/backtesting/data');
        this.apiHost = 'api.hyperliquid.xyz';
    }

    /**
     * Make HTTPS request to Hyperliquid
     */
    async makeRequest(endpoint, payload) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(payload);
            
            const options = {
                hostname: this.apiHost,
                path: endpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        resolve(parsed);
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Fetch candle data from Hyperliquid
     */
    async fetchCandles(coin, timeframe, startTime, endTime) {
        try {
            // Convert timeframe to Hyperliquid format
            const interval = this.convertTimeframe(timeframe);
            
            const payload = {
                type: 'candleSnapshot',
                req: {
                    coin: coin.replace('-PERP', ''),
                    interval: interval,
                    startTime: startTime,
                    endTime: endTime
                }
            };

            logger.info(`[FETCH] ${coin} ${timeframe} (${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()})`);
            
            const response = await this.makeRequest('/info', payload);
            
            if (!response || !Array.isArray(response)) {
                logger.warn(`[FETCH] No data returned for ${coin}`);
                return [];
            }

            // Convert to standard format
            const candles = response.map(candle => ({
                t: candle.t,           // timestamp
                o: parseFloat(candle.o), // open
                h: parseFloat(candle.h), // high
                l: parseFloat(candle.l), // low
                c: parseFloat(candle.c), // close
                v: parseFloat(candle.v)  // volume
            }));

            logger.info(`[FETCH] Retrieved ${candles.length} candles for ${coin}`);
            return candles;

        } catch (error) {
            logger.error(`[FETCH] Error fetching ${coin}: ${error.message}`);
            return [];
        }
    }

    /**
     * Convert timeframe to Hyperliquid format
     */
    convertTimeframe(timeframe) {
        const mapping = {
            '1m': '1m',
            '5m': '5m',
            '15m': '15m',
            '1h': '1h',
            '4h': '4h',
            '1d': '1d'
        };
        return mapping[timeframe] || '15m';
    }

    /**
     * Download 90 days of data for a coin
     */
    async downloadCoinData(coin, timeframe) {
        const symbolDir = path.join(this.baseDir, coin);
        if (!fs.existsSync(symbolDir)) {
            fs.mkdirSync(symbolDir, { recursive: true });
        }

        const outputPath = path.join(symbolDir, `${coin}-${timeframe}.json`);
        
        // Check if we already have recent data
        if (fs.existsSync(outputPath)) {
            const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
            if (existing.length > 0) {
                const lastCandle = existing[existing.length - 1];
                const age = Date.now() - lastCandle.t;
                if (age < 86400000) { // Less than 1 day old
                    logger.info(`[SKIP] ${coin} ${timeframe} already up to date (${existing.length} candles)`);
                    return existing.length;
                }
            }
        }

        // Calculate 90 days range
        const endTime = Date.now();
        const startTime = endTime - (90 * 24 * 60 * 60 * 1000); // 90 days ago
        
        // Fetch in chunks (Hyperliquid has limits)
        const allCandles = [];
        let currentStart = startTime;
        const chunkSize = 7 * 24 * 60 * 60 * 1000; // 7 days per chunk
        
        while (currentStart < endTime) {
            const chunkEnd = Math.min(currentStart + chunkSize, endTime);
            const candles = await this.fetchCandles(coin, timeframe, currentStart, chunkEnd);
            
            if (candles.length === 0) {
                break; // No more data
            }
            
            allCandles.push(...candles);
            currentStart = chunkEnd;
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (allCandles.length === 0) {
            logger.warn(`[WARN] No data available for ${coin}`);
            return 0;
        }

        // Sort by timestamp
        allCandles.sort((a, b) => a.t - b.t);
        
        // Remove duplicates
        const unique = [];
        const seen = new Set();
        for (const candle of allCandles) {
            if (!seen.has(candle.t)) {
                seen.add(candle.t);
                unique.push(candle);
            }
        }

        // Save to file
        fs.writeFileSync(outputPath, JSON.stringify(unique, null, 2));
        
        const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
        logger.info(`[SAVE] ${coin} ${timeframe}: ${unique.length} candles (${sizeKB} KB)`);
        
        return unique.length;
    }

    /**
     * Download all top coins
     */
    async downloadAll(timeframe = '15m') {
        logger.info('╔════════════════════════════════════════════════╗');
        logger.info('║     HYPERLIQUID DATA FETCHER - CLAUDE          ║');
        logger.info('║     Fetching 90 days of historical data        ║');
        logger.info('╚════════════════════════════════════════════════╝');
        logger.info(`Timeframe: ${timeframe}`);
        logger.info(`Coins: ${TOP_COINS.join(', ')}`);
        logger.info('');

        const results = [];
        
        for (const coin of TOP_COINS) {
            try {
                const count = await this.downloadCoinData(coin, timeframe);
                results.push({ coin, count, success: count > 0 });
                
                // Delay between coins
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                logger.error(`[ERROR] Failed to download ${coin}: ${error.message}`);
                results.push({ coin, count: 0, success: false });
            }
        }

        this.printSummary(results);
        return results;
    }

    /**
     * Print download summary
     */
    printSummary(results) {
        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║           DOWNLOAD SUMMARY                     ║');
        console.log('╚════════════════════════════════════════════════╝\n');
        
        const successful = results.filter(r => r.success);
        const totalCandles = results.reduce((sum, r) => sum + r.count, 0);
        
        console.log(`Successfully downloaded: ${successful.length}/${results.length} coins`);
        console.log(`Total candles: ${totalCandles.toLocaleString()}`);
        console.log('');
        
        console.log('Coin       | Candles  | Status');
        console.log('-----------|----------|--------');
        results.forEach(r => {
            const coin = r.coin.padEnd(10);
            const count = r.count.toLocaleString().padStart(8);
            const status = r.success ? '✓ DONE' : '✗ FAIL';
            console.log(`${coin} | ${count} | ${status}`);
        });
        
        console.log('');
        
        if (successful.length < results.length) {
            console.log('⚠️  Some coins failed to download. You may need to:');
            console.log('   1. Check internet connection');
            console.log('   2. Verify coin symbols are correct');
            console.log('   3. Try again later (rate limiting)');
        }
        
        console.log('');
    }

    /**
     * Get data status
     */
    getStatus() {
        const status = [];
        
        for (const coin of TOP_COINS) {
            const coinDir = path.join(this.baseDir, coin);
            if (fs.existsSync(coinDir)) {
                const files = fs.readdirSync(coinDir).filter(f => f.endsWith('.json'));
                const fileInfo = files.map(f => {
                    const filePath = path.join(coinDir, f);
                    const stats = fs.statSync(filePath);
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    return {
                        timeframe: f.replace('.json', '').replace(`${coin}-`, ''),
                        size: (stats.size / 1024).toFixed(1),
                        candles: data.length,
                        lastUpdate: stats.mtime
                    };
                });
                status.push({ coin, files: fileInfo });
            } else {
                status.push({ coin, files: [] });
            }
        }
        
        return status;
    }

    /**
     * Print data status
     */
    printStatus() {
        const status = this.getStatus();
        
        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║          HISTORICAL DATA STATUS                ║');
        console.log('╚════════════════════════════════════════════════╝\n');
        
        console.log('Coin       | Timeframe | Candles  | Size   | Last Update');
        console.log('-----------|-----------|----------|--------|-------------------');
        
        status.forEach(({ coin, files }) => {
            if (files.length === 0) {
                console.log(`${coin.padEnd(10)} | No data available`);
            } else {
                files.forEach((file, i) => {
                    const coinStr = i === 0 ? coin.padEnd(10) : ' '.repeat(10);
                    const tf = file.timeframe.padEnd(9);
                    const candles = file.candles.toLocaleString().padStart(8);
                    const size = `${file.size} KB`.padStart(6);
                    const update = file.lastUpdate.toISOString().slice(0, 19).replace('T', ' ');
                    console.log(`${coinStr} | ${tf} | ${candles} | ${size} | ${update}`);
                });
            }
        });
        
        console.log('');
    }
}

// Main
async function main() {
    const fetcher = new HyperliquidDataFetcher();
    const command = process.argv[2];
    const timeframe = process.argv[3] || '15m';
    
    switch (command) {
        case 'download':
            await fetcher.downloadAll(timeframe);
            break;
        case 'status':
            fetcher.printStatus();
            break;
        default:
            console.log('Usage:');
            console.log('  node download-data.js download [timeframe]  # Download 90 days');
            console.log('  node download-data.js status               # Show status');
            console.log('');
            console.log('Timeframes: 1m, 5m, 15m, 1h, 4h, 1d');
            console.log('Default: 15m');
            console.log('');
            fetcher.printStatus();
    }
}

if (require.main === module) {
    main().catch(error => {
        logger.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = HyperliquidDataFetcher;
