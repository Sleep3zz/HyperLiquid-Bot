#!/usr/bin/env node
/**
 * Coin-Specific Parameter Optimization
 * Tests BTC, SOL, HYPE with various parameter combinations
 */

const fs = require('fs');
const path = require('path');

const COINS = ['BTC', 'SOL', 'HYPE'];

// Extended parameter sets for fine-tuning
const PARAM_SETS = [
  { name: 'Ultra-Conservative', rsiLong: 25, rsiShort: 75, adx: 25, sl: 1.5, tp: 2.5 },
  { name: 'Conservative', rsiLong: 30, rsiShort: 70, adx: 30, sl: 2.0, tp: 3.0 },
  { name: 'Moderate-Tight', rsiLong: 35, rsiShort: 65, adx: 25, sl: 1.5, tp: 2.5 },
  { name: 'Moderate', rsiLong: 35, rsiShort: 65, adx: 30, sl: 2.0, tp: 3.0 },
  { name: 'Aggressive', rsiLong: 40, rsiShort: 60, adx: 35, sl: 2.0, tp: 3.0 },
  { name: 'Very-Aggressive', rsiLong: 45, rsiShort: 55, adx: 40, sl: 2.0, tp: 3.0 },
  { name: 'High-Frequency', rsiLong: 35, rsiShort: 65, adx: 35, sl: 1.5, tp: 2.0 },
  { name: 'Trend-Following', rsiLong: 40, rsiShort: 60, adx: 20, sl: 3.0, tp: 5.0 },
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
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: equity - startEquity,
    netPnlPct: ((equity - startEquity) / startEquity) * 100,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)
  };
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     COIN-SPECIFIC PARAMETER OPTIMIZATION                        ║');
console.log('║     BTC | SOL | HYPE                                            ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

const allResults = {};

for (const coin of COINS) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🪙 ${coin} - Parameter Sweep`);
  console.log('═'.repeat(70));
  
  const data = loadData(coin);
  if (!data) {
    console.log(`  ❌ No data available`);
    continue;
  }
  
  const coinResults = [];
  
  for (const params of PARAM_SETS) {
    const r = runBacktest(data, params);
    coinResults.push({ params, ...r });
  }
  
  // Sort by net PnL
  coinResults.sort((a, b) => b.netPnl - a.netPnl);
  allResults[coin] = coinResults;
  
  // Display results table
  console.log(`\n  ${'Params'.padEnd(18)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'Net PnL'.padStart(10)} ${'PnL%'.padStart(7)} ${'MaxDD%'.padStart(8)} ${'PF'.padStart(6)}`);
  console.log(`  ${'─'.repeat(70)}`);
  
  coinResults.forEach((r, i) => {
    const emoji = r.netPnl > 0 ? '✅' : (r.netPnl < 0 ? '❌' : '➖');
    const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
    const pfStr = isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞';
    console.log(`  ${emoji} ${r.params.name.padEnd(16)} ${r.trades.toString().padStart(7)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(10)} ${r.netPnlPct.toFixed(2).padStart(7)} ${r.maxDrawdown.toFixed(2).padStart(8)} ${pfStr.padStart(6)}`);
  });
  
  // Best params for this coin
  const best = coinResults[0];
  console.log(`\n  🏆 BEST for ${coin}: ${best.params.name}`);
  console.log(`      RSI ${best.params.rsiLong}/${best.params.rsiShort}, ADX ${best.params.adx}, SL ${best.params.sl}%, TP ${best.params.tp}%`);
  console.log(`      PnL: $${best.netPnl.toFixed(2)} | Win Rate: ${(best.winRate*100).toFixed(1)}% | Trades: ${best.trades}`);
}

// Cross-coin comparison
console.log(`\n${'═'.repeat(70)}`);
console.log('📊 CROSS-COIN COMPARISON - Best Parameters');
console.log('═'.repeat(70));

console.log(`\n  ${'Coin'.padEnd(6)} ${'Best Params'.padEnd(18)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'Net PnL'.padStart(10)} ${'PF'.padStart(7)}`);
console.log(`  ${'─'.repeat(60)}`);

for (const coin of COINS) {
  const best = allResults[coin][0];
  const pnlStr = best.netPnl >= 0 ? `+$${best.netPnl.toFixed(2)}` : `-$${Math.abs(best.netPnl).toFixed(2)}`;
  const pfStr = isFinite(best.profitFactor) ? best.profitFactor.toFixed(2) : '∞';
  console.log(`  ${coin.padEnd(6)} ${best.params.name.padEnd(18)} ${best.trades.toString().padStart(7)} ${(best.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(10)} ${pfStr.padStart(7)}`);
}

// Summary
console.log(`\n${'─'.repeat(70)}`);
console.log('📈 SUMMARY INSIGHTS:');
console.log('─'.repeat(70));

for (const coin of COINS) {
  const results = allResults[coin];
  const profitable = results.filter(r => r.netPnl > 0);
  const best = results[0];
  const worst = results[results.length - 1];
  
  console.log(`\n  🪙 ${coin}:`);
  console.log(`     • Profitable configs: ${profitable.length}/${PARAM_SETS.length}`);
  console.log(`     • Best: ${best.params.name} (+$${best.netPnl.toFixed(2)})`);
  console.log(`     • Worst: ${worst.params.name} ($${worst.netPnl.toFixed(2)})`);
  console.log(`     • Range: $${(best.netPnl - worst.netPnl).toFixed(2)} difference`);
}

// Save results
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `coin-optimization-BTC-SOL-HYPE-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), allResults }, null, 2));

console.log(`\n💾 Results saved: ${file}`);
