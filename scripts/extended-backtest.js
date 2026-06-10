#!/usr/bin/env node
/**
 * Extended backtest using stored historical data
 * 
 * Usage:
 *   node scripts/extended-backtest.js --coin BTC --days 90
 *   node scripts/extended-backtest.js --coin ETH --days 90
 */

const { BBRSIStrategy } = require('../src/strategy/BBRSIStrategy');
const { loadCandles } = require('../src/utils/dataManager');
const { backtestBbrsi } = require('../src/strategy/backtestBbrsi');

async function runBacktest() {
    // Parse args inside function to ensure correct values
    const coinArg = (process.argv.find(a => a.startsWith('--coin'))?.split('=')[1] || 'BTC').toUpperCase();
    const daysArg = parseInt(process.argv.find(a => a.startsWith('--days'))?.split('=')[1] || '90');
    
    console.log(`=== Extended Backtest: ${coinArg} (using stored data) ===\n`);
    
    // Load stored candles
    const allCandles = loadCandles(coinArg, '15m');
    
    if (allCandles.length === 0) {
        console.log(`No stored data for ${coinArg}. Run:`);
        console.log(`  node scripts/download-data.js --coin ${coinArg} --interval 15m --days 60`);
        process.exit(1);
    }
    
    // Limit to requested days
    const candlesPerDay = 96; // 15m candles
    const maxCandles = daysArg * candlesPerDay;
    const candles = allCandles.slice(-maxCandles);
    
    console.log(`Using ${candles.length} candles (~${(candles.length/candlesPerDay).toFixed(1)} days)`);
    console.log(`Date range: ${new Date(candles[0].t).toISOString()} to ${new Date(candles[candles.length-1].t).toISOString()}`);
    console.log('');
    
    // Mock wayfinder that returns our stored data
    const mockWayfinder = {
        get90DayCandles: async () => candles
    };
    
    // Run backtest
    const result = await backtestBbrsi(mockWayfinder, {
        coin: coinArg,
        interval: '15m',
        equity: 10000
    });
    
    // Print results
    console.log('=== RESULTS ===\n');
    
    if (!result.ok) {
        console.log('Backtest failed:', result.reason);
        return;
    }
    
    console.log('Candles used:', result.candlesUsed, `(${(result.candlesUsed/96).toFixed(1)} days)`);
    console.log('Bars evaluated:', result.barsEvaluated);
    console.log('');
    console.log('Starting Equity: $' + result.startEquity);
    console.log('Ending Equity: $' + result.endEquity);
    console.log('Net PnL: $' + result.netPnlUsd + ' (' + result.netPnlPct + '%)');
    console.log('');
    console.log('Total Trades:', result.totalTrades);
    console.log('Winning Trades:', result.winningTrades);
    console.log('Losing Trades:', result.losingTrades);
    console.log('Win Rate:', (result.winRate * 100).toFixed(1) + '%');
    console.log('');
    console.log('Avg Win: $' + result.avgWinUsd);
    console.log('Avg Loss: $' + result.avgLossUsd);
    console.log('Profit Factor:', result.profitFactor);
    console.log('Max Drawdown:', result.maxDrawdownPct + '%');
    console.log('Sharpe Ratio:', result.sharpe);
    
    if (Object.keys(result.byRegime).length > 0) {
        console.log('\nBy Regime:', JSON.stringify(result.byRegime, null, 2));
    }
    
    // Show recent trades
    if (result.trades && result.trades.length > 0) {
        console.log('\n=== Recent Trades (last 5) ===');
        result.trades.slice(-5).forEach((t, i) => {
            console.log(`${i+1}. ${t.side} | Entry: ${t.entryPrice} | Exit: ${t.exitPrice} | PnL: $${t.realizedUsd} | ${t.reason}`);
        });
    }
}

runBacktest().catch(console.error);
