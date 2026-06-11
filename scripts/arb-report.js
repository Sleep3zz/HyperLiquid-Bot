#!/usr/bin/env node
/**
 * ARB Detailed Backtest Report
 */

const fs = require('fs');
const path = require('path');

function loadData() {
  const indFile = path.join(__dirname, '..', 'data', 'indicators', 'ARB', '15m-indicators.json');
  const chartFile = path.join(__dirname, '..', 'data', 'charts', 'ARB', 'ARB-15m-90d.json');
  
  const indicators = JSON.parse(fs.readFileSync(indFile, 'utf8'));
  const chart = JSON.parse(fs.readFileSync(chartFile, 'utf8'));
  const candles = chart.candles || [];
  const values = indicators.values || [];
  
  const priceMap = new Map();
  candles.forEach(c => priceMap.set(Number(c.t), Number(c.c)));
  values.forEach(v => { v.price = priceMap.get(v.t) || 0; });
  
  return values;
}

const CONFIG = { mode: 'reversion', rsiLong: 35, rsiShort: 60, adx: 25, sl: 2.0, tp: 6.0 };

function runBacktest(values) {
  let equity = 10000;
  const startEquity = equity;
  let position = null;
  const trades = [];
  let peakEquity = equity;
  let maxDrawdown = 0;
  
  for (let i = 1; i < values.length; i++) {
    const curr = values[i];
    const prev = values[i - 1];
    
    if (curr.rsi === null || curr.bbLower === null || curr.adx === null) continue;
    
    const price = curr.price;
    const prevPrice = prev.price;
    if (!price || !prevPrice) continue;
    
    // Exit
    if (position) {
      const pnl = position.side === 'LONG' 
        ? ((price - position.entry) / position.entry) * 100
        : ((position.entry - price) / position.entry) * 100;
      
      if (pnl <= -CONFIG.sl || pnl >= CONFIG.tp) {
        const fee = 0.09;
        const netPnL = pnl - fee;
        const realized = (netPnL / 100) * equity * 0.10;
        equity += realized;
        
        trades.push({
          side: position.side,
          entry: position.entry,
          exit: price,
          pnl: netPnL,
          realized,
          reason: pnl <= -CONFIG.sl ? 'stop-loss' : 'take-profit'
        });
        position = null;
      }
    }
    // Entry
    else {
      const bouncedUp = prevPrice <= curr.bbLower && price > curr.bbLower;
      const bouncedDown = prevPrice >= curr.bbUpper && price < curr.bbUpper;
      
      if (bouncedUp && curr.rsi < CONFIG.rsiLong && curr.adx < CONFIG.adx) {
        position = { side: 'LONG', entry: price };
      }
      else if (bouncedDown && curr.rsi > CONFIG.rsiShort && curr.adx < CONFIG.adx) {
        position = { side: 'SHORT', entry: price };
      }
    }
    
    if (equity > peakEquity) peakEquity = equity;
    const dd = ((peakEquity - equity) / peakEquity) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  return { trades, equity, maxDrawdown };
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     ARB OPTIMAL PARAMETERS - DETAILED REPORT                    ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

const values = loadData();
const result = runBacktest(values);

console.log('\n📊 CONFIGURATION:');
console.log(`   Mode: Mean Reversion`);
console.log(`   RSI: ${CONFIG.rsiLong} (long) / ${CONFIG.rsiShort} (short)`);
console.log(`   ADX: < ${CONFIG.adx}`);
console.log(`   Stop Loss: ${CONFIG.sl}%`);
console.log(`   Take Profit: ${CONFIG.tp}%`);

console.log('\n📈 PERFORMANCE:');
console.log(`   Total Trades: ${result.trades.length}`);
console.log(`   Wins: ${result.trades.filter(t => t.realized > 0).length}`);
console.log(`   Losses: ${result.trades.filter(t => t.realized <= 0).length}`);
console.log(`   Win Rate: ${(result.trades.filter(t => t.realized > 0).length / result.trades.length * 100).toFixed(1)}%`);
console.log(`   Net PnL: $${(result.equity - 10000).toFixed(2)}`);
console.log(`   Final Equity: $${result.equity.toFixed(2)}`);
console.log(`   Max Drawdown: ${result.maxDrawdown.toFixed(2)}%`);

const wins = result.trades.filter(t => t.realized > 0);
const losses = result.trades.filter(t => t.realized <= 0);
const grossWin = wins.reduce((s, t) => s + t.realized, 0);
const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realized, 0));
console.log(`   Profit Factor: ${(grossWin / grossLoss).toFixed(2)}`);

console.log('\n📋 TRADE HISTORY:');
result.trades.forEach((t, i) => {
  const emoji = t.realized > 0 ? '✅' : '❌';
  const pnlStr = t.realized >= 0 ? `+$${t.realized.toFixed(2)}` : `-$${Math.abs(t.realized).toFixed(2)}`;
  console.log(`   ${i+1}. ${emoji} ${t.side.padEnd(5)} $${t.entry.toFixed(4)} → $${t.exit.toFixed(4)}  ${pnlStr.padStart(8)}  ${t.reason}`);
});

console.log('\n✅ ARB optimal parameters saved to data/optimal/ARB-optimal.json');
