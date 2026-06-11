#!/usr/bin/env node
/**
 * Fast PUMP Parameter Optimization
 * Uses simple indicator calculations for speed
 */

const fs = require('fs');
const path = require('path');

// Simple SMA calculation
function sma(data, period) {
  if (data.length < period) return null;
  const sum = data.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

// Simple RSI calculation
function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Simple Bollinger Bands
function bollinger(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    lower: mean - stdDev * std,
    middle: mean,
    upper: mean + stdDev * std
  };
}

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
  
  // Pre-calculate all indicators
  console.log('🔄 Calculating indicators...');
  const values = [];
  const prices = [];
  const highs = [];
  const lows = [];
  
  for (const c of candles) {
    prices.push(c.c);
    highs.push(c.h);
    lows.push(c.l);
    
    values.push({
      t: c.t,
      price: c.c,
      rsi: rsi(prices, 14),
      bb: bollinger(prices, 20, 2),
      adx: null // Skip ADX for speed
    });
  }
  
  console.log('✅ Indicators ready');
  return values;
}

function runBacktest(values, cfg) {
  let equity = 10000;
  const startEquity = equity;
  let position = null;
  const trades = [];
  let peakEquity = equity;
  let maxDrawdown = 0;
  
  for (let i = 21; i < values.length; i++) {
    const curr = values[i];
    const prev = values[i - 1];
    
    if (!curr.rsi || !curr.bb) continue;
    
    const price = curr.price;
    const prevPrice = prev.price;
    
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
    // Entry - only reversion mode for speed
    else {
      const bouncedUp = prevPrice <= curr.bb.lower && price > curr.bb.lower;
      const bouncedDown = prevPrice >= curr.bb.upper && price < curr.bb.upper;
      
      if (bouncedUp && curr.rsi < cfg.rsiLong) {
        position = { side: 'LONG', entry: price };
      }
      else if (bouncedDown && curr.rsi > cfg.rsiShort) {
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
console.log('║     PUMP Fast Parameter Optimization (90d)                      ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

const values = loadData();
if (!values) {
  console.log('Exiting - no data available');
  process.exit(1);
}

console.log('');

const results = [];
let tested = 0;

// Test reversion mode with key parameter combinations
for (const rsiL of [20, 25, 30, 35, 40]) {
  for (const rsiS of [55, 60, 65, 70, 75]) {
    for (const sl of [1, 1.5, 2, 2.5, 3]) {
      for (const tp of [2, 3, 4, 5, 6]) {
        const cfg = { mode: 'reversion', rsiLong: rsiL, rsiShort: rsiS, sl, tp };
        const r = runBacktest(values, cfg);
        results.push({ cfg, ...r });
        tested++;
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

console.log(`\n   ${'Rank'.padStart(4)} ${'RSI'.padStart(7)} ${'SL/TP'.padStart(8)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'PnL'.padStart(10)} ${'PF'.padStart(6)}`);
console.log(`   ${'─'.repeat(60)}`);

profitable.slice(0, 20).forEach((r, i) => {
  const rsiStr = `${r.cfg.rsiLong}/${r.cfg.rsiShort}`;
  const sltpStr = `${r.cfg.sl}/${r.cfg.tp}`;
  const pnlStr = `+$${r.netPnl.toFixed(2)}`;
  const pfStr = isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞';
  console.log(`   ${(i+1).toString().padStart(4)} ${rsiStr.padStart(7)} ${sltpStr.padStart(8)} ${r.trades.toString().padStart(7)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(10)} ${pfStr.padStart(6)}`);
});

// Best config
const best = profitable[0];
console.log(`\n🏆 BEST CONFIGURATION FOR PUMP (90d):`);
console.log(`   Mode: Mean Reversion`);
console.log(`   RSI: ${best.cfg.rsiLong} (long) / ${best.cfg.rsiShort} (short)`);
console.log(`   Stop Loss: ${best.cfg.sl}% | Take Profit: ${best.cfg.tp}%`);
console.log(`   Performance: ${best.trades} trades, ${(best.winRate*100).toFixed(1)}% win rate, +$${best.netPnl.toFixed(2)}`);

console.log(`\n📊 ANALYSIS:`);
console.log(`   • Profitable configs: ${profitable.length} / ${tested}`);
console.log(`   • Best PnL: $${best.netPnl.toFixed(2)}`);
console.log(`   • Average PnL: $${(profitable.reduce((s, r) => s + r.netPnl, 0) / profitable.length).toFixed(2)}`);

// Save
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `PUMP-90d-fast-optimization-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ 
  timestamp: new Date().toISOString(),
  totalTested: tested,
  profitableCount: profitable.length,
  bestConfig: best,
  topResults: results.slice(0, 50)
}, null, 2));

console.log(`\n💾 Results saved: ${file}`);
