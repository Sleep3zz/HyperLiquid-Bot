#!/usr/bin/env node
/**
 * PUMP-Specific Extensive Parameter Optimization (90 days)
 */

const fs = require('fs');
const path = require('path');

function loadData() {
  const chartFile = path.join(__dirname, '..', 'data', 'charts', 'PUMP', 'PUMP-15m-90d.json');
  
  if (!fs.existsSync(chartFile)) {
    console.log('❌ No data files found for PUMP');
    return null;
  }
  
  const chart = JSON.parse(fs.readFileSync(chartFile, 'utf8'));
  const candles = chart.candles || [];
  
  console.log(`📊 Loaded ${candles.length} candles for PUMP`);
  console.log(`📅 Date range: ${chart.metadata.startTime.split('T')[0]} to ${chart.metadata.endTime.split('T')[0]}`);
  
  // Calculate indicators
  const values = calculateIndicators(candles);
  
  return values;
}

function calculateIndicators(candles) {
  const { RSI, BollingerBands, ADX } = require('trading-signals');
  
  const bb = new BollingerBands(20, 2);
  const rsi = new RSI(14);
  const adx = new ADX(14);
  
  const values = [];
  
  for (const c of candles) {
    bb.update(c.c);
    rsi.update(c.c);
    adx.update({ high: c.h, low: c.l, close: c.c });
    
    let bbResult = null;
    let rsiVal = null;
    let adxVal = null;
    
    try {
      bbResult = bb.getResult();
      rsiVal = parseFloat(rsi.getResult().valueOf());
      adxVal = parseFloat(adx.getResult().valueOf());
    } catch (e) {}
    
    values.push({
      t: c.t,
      price: c.c,
      rsi: rsiVal,
      bbLower: bbResult ? parseFloat(bbResult.lower.valueOf()) : null,
      bbMiddle: bbResult ? parseFloat(bbResult.middle.valueOf()) : null,
      bbUpper: bbResult ? parseFloat(bbResult.upper.valueOf()) : null,
      adx: adxVal
    });
  }
  
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
console.log('║     PUMP-Specific Extensive Parameter Optimization (90d)        ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

const values = loadData();
if (!values) {
  console.log('Exiting - no data available');
  process.exit(1);
}

console.log('');

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
console.log(`\n🏆 BEST CONFIGURATION FOR PUMP (90d):`);
console.log(`   Mode: ${best.cfg.mode}`);
console.log(`   RSI: ${best.cfg.rsiLong} (long) / ${best.cfg.rsiShort} (short)`);
console.log(`   ADX: ${best.cfg.mode === 'reversion' ? '<' : '≥'} ${best.cfg.adx}`);
console.log(`   Stop Loss: ${best.cfg.sl}% | Take Profit: ${best.cfg.tp}%`);
console.log(`   Performance: ${best.trades} trades, ${(best.winRate*100).toFixed(1)}% win rate, +$${best.netPnl.toFixed(2)}`);

const bestReversion = profitable.find(r => r.cfg.mode === 'reversion');
const bestBreakout = profitable.find(r => r.cfg.mode === 'breakout');

console.log(`\n📊 BEST BY STRATEGY:`);
if (bestReversion) {
  console.log(`   Reversion: RSI ${bestReversion.cfg.rsiLong}/${bestReversion.cfg.rsiShort}, ADX ${bestReversion.cfg.adx}, SL/TP ${bestReversion.cfg.sl}/${bestReversion.cfg.tp}% → +$${bestReversion.netPnl.toFixed(2)} (${bestReversion.trades} trades)`);
}
if (bestBreakout) {
  console.log(`   Breakout:  RSI ${bestBreakout.cfg.rsiLong}/${bestBreakout.cfg.rsiShort}, ADX ${bestBreakout.cfg.adx}, SL/TP ${bestBreakout.cfg.sl}/${bestBreakout.cfg.tp}% → +$${bestBreakout.netPnl.toFixed(2)} (${bestBreakout.trades} trades)`);
}

// Analysis
console.log(`\n${'─'.repeat(70)}`);
console.log('📊 ANALYSIS:');
console.log('─'.repeat(70));

const avgTrades = profitable.reduce((s, r) => s + r.trades, 0) / profitable.length;
const avgWinRate = profitable.reduce((s, r) => s + r.winRate, 0) / profitable.length;
const avgPnL = profitable.reduce((s, r) => s + r.netPnl, 0) / profitable.length;

console.log(`   • Profitable configs: ${profitable.length} / ${tested} (${(profitable.length/tested*100).toFixed(1)}%)`);
console.log(`   • Average trades per config: ${avgTrades.toFixed(1)}`);
console.log(`   • Average win rate: ${(avgWinRate*100).toFixed(1)}%`);
console.log(`   • Average PnL: $${avgPnL.toFixed(2)}`);
console.log(`   • Best PnL: $${best.netPnl.toFixed(2)}`);

// Save
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `PUMP-90d-optimization-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ 
  timestamp: new Date().toISOString(),
  totalTested: tested,
  profitableCount: profitable.length,
  bestConfig: best,
  topResults: results.slice(0, 100)
}, null, 2));

console.log(`\n💾 Results saved: ${file}`);
