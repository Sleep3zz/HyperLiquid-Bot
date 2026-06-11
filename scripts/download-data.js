#!/usr/bin/env node
/**
 * Download historical data and save to repo
 * 
 * Usage:
 *   node scripts/download-data.js --coin BTC --interval 15m --days 60
 *   node scripts/download-data.js --coin ETH --interval 15m --days 60
 *   node scripts/download-data.js --all  # Download all tracked coins
 */

const path = require('path');
const WayfinderAgent = require('../../model-router/src/agents/wayfinder-agent');
const { downloadCandles } = require('../src/utils/dataManager');

// Parse args
const args = process.argv.slice(2);
const coinArg = args.find(a => a.startsWith('--coin'))?.split('=')[1] || 'BTC';
const intervalArg = args.find(a => a.startsWith('--interval'))?.split('=')[1] || '15m';
const daysArg = parseInt(args.find(a => a.startsWith('--days'))?.split('=')[1] || '60');
const allCoins = args.includes('--all');

const COINS = ['BTC', 'ETH', 'SOL', 'ARB', 'OP', 'LINK', 'AVAX', 'NEAR', 'UNI'];

async function downloadForCoin(coin, interval, days) {
    console.log(`\n=== Downloading ${coin}/${interval} ===`);
    const wayfinder = new WayfinderAgent({ autoConnect: false });
    
    try {
        const count = await downloadCandles(wayfinder, coin, interval, days);
        return { coin, success: true, count };
    } catch (err) {
        console.error(`Failed for ${coin}:`, err.message);
        return { coin, success: false, error: err.message };
    }
}

async function main() {
    console.log('=== Historical Data Downloader ===\n');
    
    const results = [];
    
    if (allCoins) {
        console.log(`Downloading ${COINS.length} coins...\n`);
        for (const coin of COINS) {
            const result = await downloadForCoin(coin, intervalArg, daysArg);
            results.push(result);
            // Delay between coins
            if (coin !== COINS[COINS.length - 1]) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    } else {
        const result = await downloadForCoin(coinArg.toUpperCase(), intervalArg, daysArg);
        results.push(result);
    }
    
    // Summary
    console.log('\n=== Summary ===');
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`Successful: ${successful.length}`);
    successful.forEach(r => console.log(`  ${r.coin}: ${r.count} candles`));
    
    if (failed.length > 0) {
        console.log(`\nFailed: ${failed.length}`);
        failed.forEach(r => console.log(`  ${r.coin}: ${r.error}`));
    }
    
    console.log('\nNext steps:');
    console.log('1. git add data/historical/');
    console.log('2. git commit -m "Add historical candle data"');
    console.log('3. git push');
    console.log('\nTo backtest with stored data:');
    console.log('  const { getExtendedCandles } = require("./src/utils/dataManager");');
    console.log('  const candles = await getExtendedCandles(wayfinder, "BTC", "15m", 90);');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
