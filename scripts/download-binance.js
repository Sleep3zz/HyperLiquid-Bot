#!/usr/bin/env node
/**
 * Download historical data from Binance (180 days)
 * 
 * Usage:
 *   node scripts/download-binance.js --coin BTC --interval 15m --days 180
 *   node scripts/download-binance.js --all
 */

const { downloadBinanceCandles } = require('../src/utils/binanceDataFetcher');

// Parse args
const args = process.argv.slice(2);
const coinArg = (args.find(a => a.startsWith('--coin'))?.split('=')[1] || 'BTC').toUpperCase();
const intervalArg = args.find(a => a.startsWith('--interval'))?.split('=')[1] || '15m';
const daysArg = parseInt(args.find(a => a.startsWith('--days'))?.split('=')[1] || '180');
const allCoins = args.includes('--all');

const COINS = ['BTC', 'ETH'];

async function downloadForCoin(coin, interval, days) {
    const symbol = `${coin}/USDT`;
    console.log(`\n=== Downloading ${symbol} ${interval} (${days} days) from Binance ===`);
    
    try {
        const count = await downloadBinanceCandles(symbol, interval, days);
        return { coin, success: true, count };
    } catch (err) {
        console.error(`Failed for ${coin}:`, err.message);
        return { coin, success: false, error: err.message };
    }
}

async function main() {
    console.log('=== Binance Historical Data Downloader ===');
    console.log(`Fetching ${daysArg} days of ${intervalArg} candles\n`);
    
    const results = [];
    
    if (allCoins) {
        for (const coin of COINS) {
            const result = await downloadForCoin(coin, intervalArg, daysArg);
            results.push(result);
        }
    } else {
        const result = await downloadForCoin(coinArg, intervalArg, daysArg);
        results.push(result);
    }
    
    // Summary
    console.log('\n=== Summary ===');
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`Successful: ${successful.length}/${results.length}`);
    successful.forEach(r => {
        const days = intervalArg === '15m' ? (r.count / 96).toFixed(1) : (r.count / 24).toFixed(1);
        console.log(`  ${r.coin}: ${r.count} candles (~${days} days)`);
    });
    
    if (failed.length > 0) {
        console.log(`\nFailed: ${failed.length}`);
        failed.forEach(r => console.log(`  ${r.coin}: ${r.error}`));
    }
    
    console.log('\nNext steps:');
    console.log('1. git add data/historical/');
    console.log('2. git commit -m "Add 180 days of Binance historical data"');
    console.log('3. git push');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
