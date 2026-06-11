#!/usr/bin/env node
/**
 * ARB-Specific Extensive Parameter Optimization
 */

const fs = require('fs');
const path = require('path');

function loadData() {
  const indFile = path.join(__dirname, '..', 'data', 'indicators', 'ARB', '15m-indicators.json');
  const chartFile = path.join(__dirname, '..', 'data', 'charts', 'ARB', 'ARB-15m-90d.json');
  
  if (!fs.existsSync(indFile) || !fs.existsSync(chartFile)) {
    console.log('❌ No data files found for ARB');
    return null;
  }
  
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
      let entrySignal = null;
      
      if (cfg.mode === 'breakout') {
        const brokeUp = prevPrice <= curr.bbUpper && price > curr.bbUpper;
        const brokeDown = prevPrice >= curr.bbLower && price < curr.bbLower;
        
        if (brokeUp && curr.rsi > cfg.rsiLong && curr.adx >= cfg.adx) entrySignal = 'LONG';
        else if (brokeDown && curr.rsi < cfg.rsiShort && curr.adx >= cfg.adx) entrySignal = 'SHORT';
      } else {
        const bouncedUp = prevPrice <= curr.bbLower && price > curr.bbLower;
        const bouncedDown = prevPrice >= curr.bbUpper && price < curr.bbUpper;
        
        if (bouncedUp && curr.rsi < cfg.rsiLong && curr.adx < cfg.adx) entrySignal = 'LONG';
        else if (bouncedDown && curr.rsi > cfg.rsiShort && curr.adx < cfg.adx) entrySignal = 'SHORT';
      }
      
      if (entrySignal) {
        position = { side: entrySignal, entry: price };
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
console.log('║     ARB-Specific Extensive Parameter Optimization               ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

const values = loadData();
if (!values) {
  console.log('Exiting - no data available');
  process.exit(1);
}

console.log(`\n📊 Loaded ${values.length} data points for ARB\n`);

const results = [];
let tested = 0;

// Test reversion mode
for (const rsiL of [20, 25, 30, 35, 40, 45]) {
  for (const rsiS of [55, 60, 65, 70, 75, 80]) {
    for (const adx of [10, 15, 20, 25, 30, 35, 40]) {
      for (const sl of [1, 1.5, 2, 2.5, 3]) {
        for (const tp of [2, 2.5, 3, 4, 5, 6]) {
          const cfg = { mode: 'reversion', rsiLong: rsiL, rsiShort: rsiS, adx, sl, tp };
          const r = runBacktest(values, cfg);
          results.push({ cfg, ...r });
          tested++;
        }
      }
    }
  }
}

// Test breakout mode
for (const rsiL of [50, 55, 60, 65]) {
  for (const rsiS of [35, 40, 45, 50]) {
    for (const adx of [15, 20, 25, 30]) {
      for (const sl of [1.5, 2, 2.5, 3]) {
        for (const tp of [2.5, 3, 4, 5]) {
          const cfg = { mode: 'breakout', rsiLong: rsiL, rsiShort: rsiS, adx, sl, tp };
          const r = runBacktest(values, cfg);
          results.push({ cfg, ...r });
          tested++;
        }
      }
    }
  }
}

// Sort by net PnL
results.sort((a, b) => b.netPnl - a.netPnl);
const profitable = results.filter(r => r.netPnl > 0);

console.log('='.repeat(70));
console.log(`📈 RESULTS: ${profitable.length} profitable / ${tested} tested (${(profitable.length/tested*100).toFixed(1)}%)`);
console.log('='.repeat(70));

console.log(`\n   ${'Rank'.padStart(4)} ${'Mode'.padEnd(10)} ${'RSI'.padStart(7)} ${'ADX'.padStart(5)} ${'SL/TP'.padStart(8)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'PnL'.padStart(10)} ${'PF'.padStart(6)}`);
console.log(`   ${'─'.repeat(70)}`);

profitable.slice(0, 25).forEach((r, i) => {
  const rsiStr = `${r.cfg.rsiLong}/${r.cfg.rsiShort}`;
  const sltpStr = `${r.cfg.sl}/${r.cfg.tp}`;
  const pnlStr = `+$${r.netPnl.toFixed(2)}`;
  const pfStr = isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞';
  console.log(`   ${(i+1).toString().padStart(4)} ${r.cfg.mode.padEnd(10)} ${rsiStr.padStart(7)} ${r.cfg.adx.toString().padStart(5)} ${sltpStr.padStart(8)} ${r.trades.toString().padStart(7)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(10)} ${pfStr.padStart(6)}`);
});

// Best config
const best = profitable[0];
console.log(`\n🏆 BEST CONFIGURATION FOR ARB:`);
console.log(`   Mode: ${best.cfg.mode}`);
console.log(`   RSI: ${best.cfg.rsiLong} (long) / ${best.cfg.rsiShort} (short)`);
console.log(`   ADX: ${best.cfg.mode === 'reversion' ? '<' : '≥'} ${best.cfg.adx}`);
console.log(`   Stop Loss: ${best.cfg.sl}% | Take Profit: ${best.cfg.tp}%`);
console.log(`   Performance: ${best.trades} trades, ${(best.winRate*100).toFixed(1)}% win rate, +$${best.netPnl.toFixed(2)}`);

const bestReversion = profitable.find(r => r.cfg.mode === 'reversion');
const bestBreakout = profitable.find(r => r.cfg.mode === 'breakout');

console.log(`\n📊 BEST BY STRATEGY:`);
if (bestReversion) {
  console.log(`   Reversion: RSI ${bestReversion.cfg.rsiLong}/${bestReversion.cfg.rsiShort}, ADX ${bestReversion.cfg.adx}, SL/TP ${bestReversion.cfg.sl}/${bestReversion.cfg.tp}% → +$${bestReversion.netPnl.toFixed(2)}`);
}
if (bestBreakout) {
  console.log(`   Breakout:  RSI ${bestBreakout.cfg.rsiLong}/${bestBreakout.cfg.rsiShort}, ADX ${bestBreakout.cfg.adx}, SL/TP ${bestBreakout.cfg.sl}/${bestBreakout.cfg.tp}% → +$${bestBreakout.netPnl.toFixed(2)}`);
}

// Save
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `ARB-extensive-optimization-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ 
  timestamp: new Date().toISOString(),
  totalTested: tested,
  profitableCount: profitable.length,
  bestConfig: best,
  topResults: results.slice(0, 100)
}, null, 2));

console.log(`\n💾 Results saved: ${file}`);
