#!/usr/bin/env node
/**
 * Parameter Sweep Backtest
 * Tests multiple parameter combinations
 */

const fs = require('fs');
const path = require('path');

const COINS = ['ARB', 'BTC', 'ETH', 'HYPE', 'SOL', 'UNI'];

// Test different parameter sets
const PARAM_SETS = [
  { name: 'Conservative', rsiLong: 30, rsiShort: 70, adx: 30, sl: 2, tp: 3 },
  { name: 'Moderate', rsiLong: 35, rsiShort: 65, adx: 25, sl: 2, tp: 3 },
  { name: 'Aggressive', rsiLong: 40, rsiShort: 60, adx: 35, sl: 2, tp: 3 },
  { name: 'Lenient', rsiLong: 45, rsiShort: 55, adx: 40, sl: 2, tp: 3 },
];

function loadData(coin) {
  const indFile = path.join(__dirname, '..', 'data', 'indicators', coin, '15m-indicators.json');
  const chartFile = path.join(__dirname, '..', 'data', 'charts', coin, `${coin}-15m-90d.json`);
  
  if (!fs.existsSync(indFile) || !fs.existsSync(chartFile)) return null;
  
  const indicators = JSON.parse(fs.readFileSync(indFile, 'utf8'));
  const chart = JSON.parse(fs.readFileSync(chartFile, 'utf8'));
  const candles = chart.candles || [];
  const values = indicators.values || [];
  
  const priceMap = new Map();
  candles.forEach(c => priceMap.set(Number(c.t), Number(c.c)));
  values.forEach(v => { v.price = priceMap.get(v.t) || 0; });
  
  return values;
}

function runBacktest(values, cfg) {
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
      
      if (pnl <= -cfg.sl || pnl >= cfg.tp) {
        const fee = 0.09;
        const netPnL = pnl - fee;
        const realized = (netPnL / 100) * equity * 0.10;
        equity += realized;
        trades.push({ realized });
        position = null;
      }
    }
    // Entry
    else {
      const bouncedUp = prevPrice <= curr.bbLower && price > curr.bbLower;
      const bouncedDown = prevPrice >= curr.bbUpper && price < curr.bbUpper;
      
      if (bouncedUp && curr.rsi < cfg.rsiLong && curr.adx < cfg.adx) {
        position = { side: 'LONG', entry: price };
      }
      else if (bouncedDown && curr.rsi > cfg.rsiShort && curr.adx < cfg.adx) {
        position = { side: 'SHORT', entry: price };
      }
    }
    
    if (equity > peakEquity) peakEquity = equity;
    const dd = ((peakEquity - equity) / peakEquity) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  const wins = trades.filter(t => t.realized > 0);
  const grossWin = wins.reduce((s, t) => s + t.realized, 0);
  const grossLoss = Math.abs(trades.reduce((s, t) => s + Math.min(0, t.realized), 0));
  
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: equity - startEquity,
    netPnlPct: ((equity - startEquity) / startEquity) * 100,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)
  };
}

console.log('🚀 Parameter Sweep Backtest\n');

const allResults = [];

for (const params of PARAM_SETS) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 ${params.name}: RSI ${params.rsiLong}/${params.rsiShort}, ADX ${params.adx}`);
  console.log('='.repeat(70));
  
  let totalPnl = 0, totalTrades = 0, totalWins = 0;
  
  console.log(`${'Coin'.padEnd(6)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'Net PnL'.padStart(11)} ${'PnL%'.padStart(7)} ${'MaxDD%'.padStart(8)} ${'PF'.padStart(6)}`);
  console.log('-'.repeat(60));
  
  for (const coin of COINS) {
    const data = loadData(coin);
    if (!data) {
      console.log(`${coin.padEnd(6)} No data`);
      continue;
    }
    
    const r = runBacktest(data, params);
    totalPnl += r.netPnl;
    totalTrades += r.trades;
    totalWins += r.trades * r.winRate;
    
    const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
    console.log(`${coin.padEnd(6)} ${r.trades.toString().padStart(7)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(11)} ${r.netPnlPct.toFixed(2).padStart(7)} ${r.maxDrawdown.toFixed(2).padStart(8)} ${r.profitFactor.toFixed(2).padStart(6)}`);
  }
  
  const avgWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
  console.log('-'.repeat(60));
  console.log(`${'TOTAL'.padEnd(6)} ${totalTrades.toString().padStart(7)} ${avgWinRate.toFixed(1).padStart(7)} ${(totalPnl >= 0 ? '+$' : '-$') + Math.abs(totalPnl).toFixed(2).padStart(9)}`);
  
  allResults.push({ params, totalPnl, totalTrades, avgWinRate });
}

// Summary comparison
console.log(`\n${'='.repeat(70)}`);
console.log('📊 PARAMETER COMPARISON');
console.log('='.repeat(70));
console.log(`${'Params'.padEnd(15)} ${'Total Trades'.padStart(12)} ${'Win Rate'.padStart(10)} ${'Total PnL'.padStart(12)}`);
console.log('-'.repeat(60));

allResults.sort((a, b) => b.totalPnl - a.totalPnl);
allResults.forEach(r => {
  const pnlStr = r.totalPnl >= 0 ? `+$${r.totalPnl.toFixed(2)}` : `-$${Math.abs(r.totalPnl).toFixed(2)}`;
  console.log(`${r.params.name.padEnd(15)} ${r.totalTrades.toString().padStart(12)} ${r.avgWinRate.toFixed(1).padStart(10)} ${pnlStr.padStart(12)}`);
});

// Best params
const best = allResults[0];
console.log(`\n🏆 Best: ${best.params.name} with $${best.totalPnl.toFixed(2)} total PnL`);
