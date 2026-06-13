#!/usr/bin/env node
/**
 * Download fresh 15m candle data from Hyperliquid
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'PUMP'];
const INTERVAL = '15m';
const DAYS = 7; // Download last 7 days

async function makeRequest(payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const options = {
            hostname: 'api.hyperliquid.xyz',
            path: '/info',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            },
            timeout: 30000
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(responseData));
                } catch (error) {
                    reject(new Error(`Parse error: ${error.message}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Timeout')));
        req.write(data);
        req.end();
    });
}

async function downloadCandles(coin, interval, days) {
    const intervalMs = 15 * 60 * 1000; // 15 minutes
    const endTime = Date.now();
    const startTime = endTime - (days * 24 * 60 * 60 * 1000);

    const payload = {
        type: 'candleSnapshot',
        req: {
            coin: coin,
            interval: interval,
            startTime: startTime,
            endTime: endTime
        }
    };

    const candles = await makeRequest(payload);
    
    if (!Array.isArray(candles)) {
        throw new Error('Invalid response format');
    }

    // Format to match existing data structure
    return candles.map(c => ({
        t: c.t,
        T: c.T,
        s: c.s,
        i: c.i,
        o: c.o,
        c: c.c,
        h: c.h,
        l: c.l,
        v: c.v,
        n: c.n
    }));
}

async function main() {
    console.log('=== Downloading Fresh Candle Data ===\n');
    
    const dataDir = path.join(__dirname, '..', 'src', 'backtesting', 'data');
    
    for (const coin of COINS) {
        try {
            console.log(`Downloading ${coin}-PERP ${INTERVAL}...`);
            const candles = await downloadCandles(coin, INTERVAL, DAYS);
            
            if (candles.length === 0) {
                console.log(`  No data returned for ${coin}`);
                continue;
            }
            
            // Ensure directory exists
            const coinDir = path.join(dataDir, `${coin}-PERP`);
            if (!fs.existsSync(coinDir)) {
                fs.mkdirSync(coinDir, { recursive: true });
            }
            
            // Save to file
            const filePath = path.join(coinDir, `${coin}-PERP-${INTERVAL}.json`);
            fs.writeFileSync(filePath, JSON.stringify(candles, null, 2));
            
            const lastCandle = candles[candles.length - 1];
            const lastDate = new Date(lastCandle.t).toISOString();
            console.log(`  ✓ Saved ${candles.length} candles, last: ${lastDate}`);
            
            // Wait between requests to avoid rate limiting
            await new Promise(r => setTimeout(r, 1000));
            
        } catch (err) {
            console.error(`  ✗ Failed: ${err.message}`);
        }
    }
    
    console.log('\n=== Done ===');
}

main().catch(console.error);
