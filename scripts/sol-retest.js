#!/usr/bin/env node
/**
 * SOL-Specific Extensive Parameter Optimization
 */

const fs = require('fs');
const path = require('path');

function loadData() {
  const indFile = path.join(__dirname, '..', 'data', 'indicators', 'SOL', '15m-indicators.json');
  const chartFile = path.join(__dirname, '..', 'data', 'charts', 'SOL', 'SOL-15m-90d.json');
  
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
  let position = null;
  const trades = [];
  let peak = equity;
  let maxDD = 0;
  
  for (let i = 1; i < values.length; i++) {
    const curr = values[i];
    const prev = values[i - 1];
    
    if (curr.rsi === null || curr.bbLower === null) continue;
    
    if (position) {
      const pnl = position.side === 'LONG' 
        ? ((curr.price - position.entry) / position.entry) * 100
        : ((position.entry - curr.price) / position.entry) * 100;
      
      if (pnl <= -cfg.sl || pnl >= cfg.tp) {
        const fee = 0.09;
        const netPnL = pnl - fee;
        equity += (netPnL / 100) * equity * 0.10;
        trades.push({ pnl: netPnL });
        position = null;
      }
    } else {
      let signal = null;
      
      if (cfg.mode === 'breakout') {
        const brokeUp = prev.price <= curr.bbUpper && curr.price > curr.bbUpper;
        const brokeDown = prev.price >= curr.bbLower && curr.price < curr.bbLower;
        if (brokeUp && curr.rsi > cfg.rsiLong && curr.adx >= cfg.adx) signal = 'LONG';
        else if (brokeDown && curr.rsi < cfg.rsiShort && curr.adx >= cfg.adx) signal = 'SHORT';
      } else {
        const bouncedUp = prev.price <= curr.bbLower && curr.price > curr.bbLower;
        const bouncedDown = prev.price >= curr.bbUpper && curr.price < curr.bbUpper;
        if (bouncedUp && curr.rsi < cfg.rsiLong && curr.adx < cfg.adx) signal = 'LONG';
        else if (bouncedDown && curr.rsi > cfg.rsiShort && curr.adx < cfg.adx) signal = 'SHORT';
      }
      
      if (signal) position = { side: signal, entry: curr.price };
    }
    
    if (equity > peak) peak = equity;
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  }
  
  const wins = trades.filter(t => t.pnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  
  return {
    mode: cfg.mode,
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: equity - 10000,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    maxDrawdown: maxDD
  };
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     SOL Extensive Parameter Optimization                        ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

const values = loadData();
console.log('📊 Loaded ' + values.length + ' candles for SOL\n');

const results = [];
let tested = 0;

// Test reversion mode
const rsiLongValues = [20, 25, 30, 35, 40, 45];
const rsiShortValues = [55, 60, 65, 70, 75];
const adxValues = [20, 25, 30, 35, 40, 45];
const slValues = [2, 2.5, 3, 3.5, 4];
const tpValues = [4, 5, 6, 7, 8];

for (const rsiL of rsiLongValues) {
  for (const rsiS of rsiShortValues) {
    for (const adx of adxValues) {
      for (const sl of slValues) {
        for (const tp of tpValues) {
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
const breakRsiLong = [50, 55, 60, 65];
const breakRsiShort = [35, 40, 45, 50];
const breakAdx = [15, 20, 25, 30];
const breakSl = [2, 2.5, 3, 3.5];
const breakTp = [4, 5, 6, 7];

for (const rsiL of breakRsiLong) {
  for (const rsiS of breakRsiShort) {
    for (const adx of breakAdx) {
      for (const sl of breakSl) {
        for (const tp of breakTp) {
          const cfg = { mode: 'breakout', rsiLong: rsiL, rsiShort: rsiS, adx, sl, tp };
          const r = runBacktest(values, cfg);
          results.push({ cfg, ...r });
          tested++;
        }
      }
    }
  }
}

results.sort((a, b) => b.netPnl - a.netPnl);
const profitable = results.filter(r => r.netPnl > 0);

console.log('='.repeat(75));
console.log('📈 RESULTS: ' + profitable.length + ' profitable / ' + tested + ' tested');
console.log('='.repeat(75));

console.log('\n   Rank Mode       RSI     ADX  SL/TP  Trades   Win%        PnL     PF');
console.log('   ' + '─'.repeat(75));

profitable.slice(0, 20).forEach((r, i) => {
  const rsiStr = r.cfg.rsiLong + '/' + r.cfg.rsiShort;
  const pnlStr = r.netPnl >= 0 ? '+$' + r.netPnl.toFixed(2) : '-$' + Math.abs(r.netPnl).toFixed(2);
  const pfStr = isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞';
  const modeStr = r.mode.substring(0, 10).padEnd(10);
  console.log('   ' + (i+1).toString().padStart(4) + ' ' + modeStr + ' ' + rsiStr.padStart(7) + ' ' + r.cfg.adx.toString().padStart(5) + ' ' + r.cfg.sl + '/' + r.cfg.tp + ' '.padStart(5) + r.trades.toString().padStart(7) + ' ' + (r.winRate*100).toFixed(1).padStart(7) + ' ' + pnlStr.padStart(10) + ' ' + pfStr.padStart(6));
});

const best = profitable[0];
console.log('\n🏆 BEST FOR SOL:');
console.log('   Mode: ' + best.mode);
console.log('   RSI ' + best.cfg.rsiLong + '/' + best.cfg.rsiShort + ', ADX ' + (best.mode === 'reversion' ? '<' : '>=') + best.cfg.adx);
console.log('   SL ' + best.cfg.sl + '% | TP ' + best.cfg.tp + '%');
console.log('   ' + best.trades + ' trades, ' + (best.winRate*100).toFixed(1) + '% win, +$' + best.netPnl.toFixed(2));

// Current config comparison
const currentReversion = { mode: 'reversion', rsiLong: 25, rsiShort: 55, adx: 40, sl: 3, tp: 6 };
const currentResult = runBacktest(values, currentReversion);

console.log('\n' + '─'.repeat(75));
console.log('📊 COMPARISON WITH CURRENT CONFIG:');
console.log('─'.repeat(75));
console.log('   Current: RSI 25/55, ADX <40, SL 3%/TP 6%');
console.log('            ' + currentResult.trades + ' trades, ' + (currentResult.winRate*100).toFixed(1) + '% win, +$' + currentResult.netPnl.toFixed(2));
console.log('   Best:    ' + best.mode + ' RSI ' + best.cfg.rsiLong + '/' + best.cfg.rsiShort + ', ADX ' + best.cfg.adx + ', SL ' + best.cfg.sl + '%/TP ' + best.cfg.tp + '%');
console.log('            ' + best.trades + ' trades, ' + (best.winRate*100).toFixed(1) + '% win, +$' + best.netPnl.toFixed(2));

if (best.netPnl > currentResult.netPnl) {
  const improvement = ((best.netPnl - currentResult.netPnl) / currentResult.netPnl * 100);
  console.log('   Improvement: +' + improvement.toFixed(0) + '%');
} else {
  console.log('   Current config is already optimal or very close!');
}

// Save
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'SOL-optimization-' + Date.now() + '.json'),
  JSON.stringify({ 
    timestamp: new Date().toISOString(), 
    totalTested: tested, 
    profitableCount: profitable.length, 
    bestConfig: best,
    currentConfig: { config: currentReversion, results: currentResult },
    topResults: results.slice(0, 50) 
  }, null, 2)
);

console.log('\n✅ SOL optimization complete!');
