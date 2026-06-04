#!/usr/bin/env node
/**
 * Synthetic Data Generator for Top 10 Coins
 * 
 * Generates realistic 90-day historical data for backtesting
 * Based on BTC patterns with coin-specific characteristics
 */

const fs = require('fs');
const path = require('path');

// Top 10 coins with their characteristics
const COIN_PROFILES = {
    'BTC-PERP': { basePrice: 65000, volatility: 0.015, trend: 0.0002 },
    'ETH-PERP': { basePrice: 3500, volatility: 0.018, trend: 0.0003 },
    'SOL-PERP': { basePrice: 150, volatility: 0.025, trend: 0.0005 },
    'HYPE-PERP': { basePrice: 20, volatility: 0.035, trend: 0.001 },
    'ARB-PERP': { basePrice: 1.2, volatility: 0.022, trend: -0.0001 },
    'OP-PERP': { basePrice: 2.5, volatility: 0.024, trend: 0.0002 },
    'LINK-PERP': { basePrice: 18, volatility: 0.02, trend: 0.0001 },
    'AVAX-PERP': { basePrice: 35, volatility: 0.028, trend: 0.0004 },
    'NEAR-PERP': { basePrice: 6.5, volatility: 0.026, trend: 0.0003 },
    'UNI-PERP': { basePrice: 9, volatility: 0.021, trend: -0.0002 }
};

class SyntheticDataGenerator {
    constructor() {
        this.baseDir = path.join(__dirname, 'src/backtesting/data');
    }

    /**
     * Generate synthetic OHLCV data
     */
    generateData(symbol, timeframe = '15m', days = 90) {
        const profile = COIN_PROFILES[symbol];
        if (!profile) {
            throw new Error(`Unknown symbol: ${symbol}`);
        }

        const candles = [];
        let currentPrice = profile.basePrice;
        
        // Calculate number of candles
        const candlesPerDay = timeframe === '15m' ? 96 : timeframe === '1h' ? 24 : 6;
        const totalCandles = days * candlesPerDay;
        
        // Start timestamp (90 days ago)
        const now = Date.now();
        const intervalMs = this.getIntervalMs(timeframe);
        let timestamp = now - (days * 24 * 60 * 60 * 1000);

        for (let i = 0; i < totalCandles; i++) {
            // Add trend
            const trendChange = currentPrice * profile.trend;
            
            // Add random volatility
            const volatility = currentPrice * profile.volatility * (Math.random() - 0.5);
            
            // Calculate OHLC
            const open = currentPrice;
            const change = trendChange + volatility;
            const close = open + change;
            
            // High and low with additional volatility
            const high = Math.max(open, close) * (1 + Math.random() * profile.volatility * 0.5);
            const low = Math.min(open, close) * (1 - Math.random() * profile.volatility * 0.5);
            
            // Volume (random with some correlation to volatility)
            const volume = Math.abs(change) * 1000 * (0.5 + Math.random());
            
            candles.push({
                t: timestamp,
                T: timestamp + intervalMs - 1,
                s: symbol.replace('-PERP', ''),
                i: timeframe,
                o: open.toFixed(profile.basePrice > 100 ? 1 : 4),
                c: close.toFixed(profile.basePrice > 100 ? 1 : 4),
                h: high.toFixed(profile.basePrice > 100 ? 1 : 4),
                l: low.toFixed(profile.basePrice > 100 ? 1 : 4),
                v: volume.toFixed(5),
                n: Math.floor(Math.random() * 500) + 100
            });

            currentPrice = close;
            timestamp += intervalMs;
        }

        return candles;
    }

    /**
     * Get interval in milliseconds
     */
    getIntervalMs(timeframe) {
        const mapping = {
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '15m': 15 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '4h': 4 * 60 * 60 * 1000,
            '1d': 24 * 60 * 60 * 1000
        };
        return mapping[timeframe] || 15 * 60 * 1000;
    }

    /**
     * Save data to file
     */
    saveData(symbol, timeframe, candles) {
        const symbolDir = path.join(this.baseDir, symbol);
        if (!fs.existsSync(symbolDir)) {
            fs.mkdirSync(symbolDir, { recursive: true });
        }

        const outputPath = path.join(symbolDir, `${symbol}-${timeframe}.json`);
        fs.writeFileSync(outputPath, JSON.stringify(candles, null, 2));
        
        const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
        return { candles: candles.length, size: sizeKB };
    }

    /**
     * Generate all data
     */
    async generateAll() {
        console.log('╔════════════════════════════════════════════════╗');
        console.log('║   SYNTHETIC DATA GENERATOR - CLAUDE            ║');
        console.log('║   Generating 90 days for Top 10 Coins          ║');
        console.log('╚════════════════════════════════════════════════╝\n');

        const results = [];
        const timeframe = '15m';
        const days = 90;

        for (const [symbol, profile] of Object.entries(COIN_PROFILES)) {
            console.log(`[GEN] ${symbol} (base: $${profile.basePrice}, vol: ${(profile.volatility * 100).toFixed(1)}%)...`);
            
            try {
                const candles = this.generateData(symbol, timeframe, days);
                const { candles: count, size } = this.saveData(symbol, timeframe, candles);
                
                results.push({ symbol, count, size, success: true });
                console.log(`  ✓ Generated ${count} candles (${size} KB)`);
            } catch (error) {
                console.log(`  ✗ Error: ${error.message}`);
                results.push({ symbol, count: 0, size: 0, success: false });
            }
        }

        this.printSummary(results);
        return results;
    }

    /**
     * Print summary
     */
    printSummary(results) {
        const successful = results.filter(r => r.success);
        const totalCandles = results.reduce((sum, r) => sum + r.count, 0);
        
        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║           GENERATION SUMMARY                   ║');
        console.log('╚════════════════════════════════════════════════╝\n');
        
        console.log(`Successfully generated: ${successful.length}/${results.length} coins`);
        console.log(`Total candles: ${totalCandles.toLocaleString()}`);
        console.log(`Data period: 90 days`);
        console.log(`Timeframe: 15m`);
        console.log('');
        
        console.log('Coin       | Candles  | Size   | Status');
        console.log('-----------|----------|--------|--------');
        results.forEach(r => {
            const coin = r.symbol.padEnd(10);
            const candles = r.count.toLocaleString().padStart(8);
            const size = `${r.size} KB`.padStart(6);
            const status = r.success ? '✓ DONE' : '✗ FAIL';
            console.log(`${coin} | ${candles} | ${size} | ${status}`);
        });
        
        console.log('\n⚠️  Note: This is synthetic data for backtesting purposes.');
        console.log('   Real historical data should be used for live trading.');
        console.log('');
    }

    /**
     * Get status
     */
    getStatus() {
        const status = [];
        
        for (const symbol of Object.keys(COIN_PROFILES)) {
            const symbolDir = path.join(this.baseDir, symbol);
            if (fs.existsSync(symbolDir)) {
                const files = fs.readdirSync(symbolDir)
                    .filter(f => f.endsWith('.json'))
                    .map(f => {
                        const filePath = path.join(symbolDir, f);
                        const stats = fs.statSync(filePath);
                        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        return {
                            timeframe: f.replace('.json', '').replace(`${symbol}-`, ''),
                            size: (stats.size / 1024).toFixed(1),
                            candles: data.length,
                            lastUpdate: stats.mtime
                        };
                    });
                status.push({ symbol, files });
            } else {
                status.push({ symbol, files: [] });
            }
        }
        
        return status;
    }

    /**
     * Print status
     */
    printStatus() {
        const status = this.getStatus();
        
        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║          HISTORICAL DATA STATUS                ║');
        console.log('╚════════════════════════════════════════════════╝\n');
        
        console.log('Coin       | Timeframe | Candles  | Size   | Last Update');
        console.log('-----------|-----------|----------|--------|-------------------');
        
        status.forEach(({ symbol, files }) => {
            if (files.length === 0) {
                console.log(`${symbol.padEnd(10)} | No data`);
            } else {
                files.forEach((file, i) => {
                    const coinStr = i === 0 ? symbol.padEnd(10) : ' '.repeat(10);
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
    const generator = new SyntheticDataGenerator();
    const command = process.argv[2];
    
    switch (command) {
        case 'generate':
            await generator.generateAll();
            break;
        case 'status':
            generator.printStatus();
            break;
        default:
            console.log('Usage:');
            console.log('  node generate-data.js generate  # Generate 90-day data');
            console.log('  node generate-data.js status    # Show status');
            console.log('');
            generator.printStatus();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

module.exports = SyntheticDataGenerator;
