#!/usr/bin/env node
/**
 * Historical Data Downloader
 * 
 * Fetches historical OHLCV data for backtesting
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()]
});

// Top coins to download
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

const TIMEFRAMES = ['15m', '1h', '4h'];

class DataDownloader {
    constructor() {
        this.baseDir = path.join(__dirname, 'src/backtesting/data');
    }

    /**
     * Check if data already exists
     */
    hasData(symbol, timeframe) {
        const filePath = path.join(this.baseDir, symbol, `${symbol}-${timeframe}.json`);
        return fs.existsSync(filePath);
    }

    /**
     * Download data using wayfinder
     */
    async downloadData(symbol, timeframe) {
        logger.info(`[DOWNLOAD] Fetching ${symbol} ${timeframe}...`);
        
        try {
            // Create directory
            const symbolDir = path.join(this.baseDir, symbol);
            if (!fs.existsSync(symbolDir)) {
                fs.mkdirSync(symbolDir, { recursive: true });
            }

            // Try to fetch candles from Hyperliquid
            // Note: This is a placeholder - actual implementation would use
            // Hyperliquid API or wayfinder if available
            
            const outputPath = path.join(symbolDir, `${symbol}-${timeframe}.json`);
            
            // For now, create empty placeholder
            // In real implementation, this would fetch from API
            logger.warn(`[DOWNLOAD] Data fetch not implemented. Creating placeholder for ${symbol}.`);
            
            fs.writeFileSync(outputPath, JSON.stringify([], null, 2));
            
            return true;
        } catch (error) {
            logger.error(`[DOWNLOAD] Failed to download ${symbol}: ${error.message}`);
            return false;
        }
    }

    /**
     * Download all top coins
     */
    async downloadAll() {
        logger.info('[DOWNLOAD] Starting data download for top 10 coins');
        
        for (const coin of TOP_COINS) {
            for (const timeframe of TIMEFRAMES) {
                if (this.hasData(coin, timeframe)) {
                    logger.info(`[DOWNLOAD] ${coin} ${timeframe} already exists`);
                    continue;
                }
                
                await this.downloadData(coin, timeframe);
            }
        }
        
        logger.info('[DOWNLOAD] Download complete');
    }

    /**
     * List available data
     */
    listAvailable() {
        const available = [];
        
        if (fs.existsSync(this.baseDir)) {
            const symbols = fs.readdirSync(this.baseDir);
            
            for (const symbol of symbols) {
                const symbolPath = path.join(this.baseDir, symbol);
                if (fs.statSync(symbolPath).isDirectory()) {
                    const files = fs.readdirSync(symbolPath)
                        .filter(f => f.endsWith('.json'))
                        .map(f => f.replace('.json', ''));
                    
                    available.push({ symbol, timeframes: files });
                }
            }
        }
        
        return available;
    }

    /**
     * Print status
     */
    printStatus() {
        const available = this.listAvailable();
        
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║       Historical Data Status           ║');
        console.log('╚════════════════════════════════════════╝\n');
        
        if (available.length === 0) {
            console.log('No historical data available.');
            console.log('Run: node download-data.js\n');
            return;
        }
        
        console.log('Available Data:\n');
        available.forEach(({ symbol, timeframes }) => {
            console.log(`${symbol}:`);
            timeframes.forEach(tf => {
                const filePath = path.join(this.baseDir, symbol, `${tf}.json`);
                const stats = fs.statSync(filePath);
                const size = (stats.size / 1024).toFixed(1);
                console.log(`  - ${tf}: ${size} KB`);
            });
        });
        
        console.log('');
    }
}

// Main
async function main() {
    const downloader = new DataDownloader();
    
    // Check command
    const command = process.argv[2];
    
    switch (command) {
        case 'download':
            await downloader.downloadAll();
            break;
        case 'status':
            downloader.printStatus();
            break;
        default:
            console.log('Usage:');
            console.log('  node download-data.js download  # Download all data');
            console.log('  node download-data.js status    # Check data status');
            downloader.printStatus();
    }
}

if (require.main === module) {
    main().catch(error => {
        logger.error('Error:', error);
        process.exit(1);
    });
}

module.exports = DataDownloader;
