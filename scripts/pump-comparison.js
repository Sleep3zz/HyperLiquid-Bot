#!/usr/bin/env node
/**
 * PUMP Comprehensive Comparison Test
 * Compares mean reversion vs breakout with extensive parameters
 */

const fs = require('fs');
const path = require('path');

// Load PUMP data
function loadData() {
  const chartFile = path.join(__dirname, '..', 'data', 'charts', 'PUMP', 'PUMP-15m-90d.json');
  const chart = JSON.parse(fs.readFileSync(chartFile, 'utf8'));
  const candles = chart.candles;
  
  // Calculate simple indicators
  const values = [];
  const prices = [];
  
  for (const c of candles) {
    prices.push(c.c);
    
    // Simple RSI
    let rsi = null;
    if (prices.length > 14) {
      let gains = 0, losses = 0;
      for (let i = prices.length - 14; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
      }
      const avgGain = gains / 14;
      const avgLoss = losses / 14;
      rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    
    // Simple Bollinger Bands
    let bb = null;
    if (prices.length >= 20) {
      const slice = prices.slice(-20);
      const mean = slice.reduce((a, b) => a + b, 0) / 20;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20;
      const std = Math.sqrt(variance);
      bb = { lower: mean - 2 * std, middle: mean, upper: mean + 2 * std };
    }
    
    // Simple ADX approximation
    let adx = null;
    if (values.length > 14 && values[values.length - 1].adx !== null) {
      const atr = Math.abs(c.h - c.l);
      adx = values[values.length - 1].adx * 0.9 + (atr / c.c * 100) * 0.1;
    } else {
      adx = Math.abs(c.h - c.l) / c.c * 100;
    }
    
    values.push({ t: c.t, price: c.c, rsi, bb, adx });
  }
  
  return values;
}

function runBacktest(values, cfg) {
  let equity = 10000;
  let position = null;
  const trades = [];
  let peak = equity;
  let maxDD = 0;
  
  for (let i = 21; i < values.length; i++) {
    const curr = values[i];
    const prev = values[i - 1];
    if (!curr.rsi || !curr.bb) continue;
    
    // Exit
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
    }
    // Entry
    else {
      let signal = null;
      
      if (cfg.mode === 'breakout') {
        const brokeUp = prev.price <= curr.bb.upper && curr.price > curr.bb.upper;
        const brokeDown = prev.price >= curr.bb.lower && curr.price < curr.bb.lower;
        if (brokeUp && curr.rsi > cfg.rsiLong && curr.adx >= cfg.adx) signal = 'LONG';
        else if (brokeDown && curr.rsi < cfg.rsiShort && curr.adx >= cfg.adx) signal = 'SHORT';
      } else {
        const bouncedUp = prev.price <= curr.bb.lower && curr.price > curr.bb.lower;
        const bouncedDown = prev.price >= curr.bb.upper && curr.price < curr.bb.upper;
        if (bouncedUp && curr.rsi < cfg.rsiLong && curr.adx < cfg.adx) signal = 'LONG';
        else if (bouncedDown && curr.rsi > cfg.rsiShort && curr.adx < cfg.adx) signal = 'SHORT';
      }
      
      if (signal) position = { side: signal, entry: curr.price };
    }
    
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  
  const wins = trades.filter(t => t.pnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  
  return {
    mode: cfg.mode,
    params: cfg,
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: equity - 10000,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    maxDrawdown: maxDD
  };
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     PUMP COMPREHENSIVE COMPARISON TEST                          ║');
console.log('║     Mean Reversion vs Breakout                                  ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

const values = loadData();
console.log(`📊 Loaded ${values.length} candles for PUMP\n`);

// Test configurations
const testConfigs = [
  // Previous best - Mean Reversion
  { name: 'Previous Best (Reversion)', mode: 'reversion', rsiLong: 25, rsiShort: 55, adx: 30, sl: 3, tp: 5 },
  
  // New best - Breakout
  { name: 'New Best (Breakout)', mode: 'breakout', rsiLong: 65, rsiShort: 35, adx: 20, sl: 3, tp: 5 },
  
  // Variations of breakout
  { name: 'Breakout V2', mode: 'breakout', rsiLong: 60, rsiShort: 40, adx: 20, sl: 2.5, tp: 5 },
  { name: 'Breakout V3', mode: 'breakout', rsiLong: 55, rsiShort: 45, adx: 25, sl: 3, tp: 6 },
  { name: 'Breakout V4', mode: 'breakout', rsiLong: 65, rsiShort: 35, adx: 15, sl: 2, tp: 4 },
  
  // Variations of reversion
  { name: 'Reversion V2', mode: 'reversion', rsiLong: 20, rsiShort: 60, adx: 25, sl: 2.5, tp: 5 },
  { name: 'Reversion V3', mode: 'reversion', rsiLong: 30, rsiShort: 50, adx: 35, sl: 2, tp: 6 },
];

const results = [];
for (const cfg of testConfigs) {
  const r = runBacktest(values, cfg);
  results.push({ ...r, name: cfg.name });
}

// Sort by PnL
results.sort((a, b) => b.netPnl - a.netPnl);

console.log('='.repeat(70));
console.log('📈 COMPARISON RESULTS');
console.log('='.repeat(70));

console.log(`\n   ${'Rank'.padStart(4)} ${'Strategy'.padEnd(20)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'PnL'.padStart(10)} ${'PF'.padStart(6)} ${'MaxDD%'.padStart(8)}`);
console.log('   ' + '─'.repeat(70));

results.forEach((r, i) => {
  const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
  const pfStr = isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞';
  console.log(`   ${(i+1).toString().padStart(4)} ${r.name.padEnd(20)} ${r.trades.toString().padStart(7)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(10)} ${pfStr.padStart(6)} ${r.maxDrawdown.toFixed(2).padStart(8)}`);
});

const best = results[0];
console.log(`\n🏆 BEST CONFIGURATION FOR PUMP:`);
console.log(`   Strategy: ${best.name}`);
console.log(`   Mode: ${best.mode}`);
console.log(`   RSI: ${best.params.rsiLong} (long) / ${best.params.rsiShort} (short)`);
console.log(`   ADX: ${best.params.mode === 'reversion' ? '<' : '≥'} ${best.params.adx}`);
console.log(`   SL: ${best.params.sl}% | TP: ${best.params.tp}%`);
console.log(`   Performance: ${best.trades} trades, ${(best.winRate*100).toFixed(1)}% win rate, +$${best.netPnl.toFixed(2)}`);

// Compare reversion vs breakout averages
const reversionResults = results.filter(r => r.mode === 'reversion');
const breakoutResults = results.filter(r => r.mode === 'breakout');

const revAvg = reversionResults.reduce((s, r) => s + r.netPnl, 0) / reversionResults.length;
const breakAvg = breakoutResults.reduce((s, r) => s + r.netPnl, 0) / breakoutResults.length;

console.log(`\n📊 STRATEGY COMPARISON:`);
console.log(`   Mean Reversion Avg: $${revAvg.toFixed(2)} (${reversionResults.length} configs tested)`);
console.log(`   Breakout Avg:       $${breakAvg.toFixed(2)} (${breakoutResults.length} configs tested)`);
console.log(`   Winner: ${breakAvg > revAvg ? 'BREAKOUT' : 'MEAN REVERSION'} (+$${Math.abs(breakAvg - revAvg).toFixed(2)} better)`);

// Save best config
const outDir = path.join(__dirname, '..', 'data', 'optimal');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const optimalConfig = {
  coin: 'PUMP',
  recommended: best.name.includes('Breakout') ? 'Breakout (Optimized)' : 'Mean Reversion (Optimized)',
  mode: best.mode,
  params: {
    leverage: 3,
    positionSize: 0.10,
    profitTarget: best.params.tp,
    stopLoss: best.params.sl,
    bbPeriod: 20,
    bbStdDev: 2,
    rsiPeriod: 14,
    rsiOverbought: best.params.rsiShort,
    rsiOversold: best.params.rsiLong,
    adxPeriod: 14,
    adxTrendThreshold: best.params.adx
  },
  backtestResults: {
    trades: best.trades,
    wins: best.wins,
    losses: best.trades - best.wins,
    winRate: best.winRate,
    netPnl: best.netPnl,
    netPnlPct: best.netPnl / 100,
    profitFactor: best.profitFactor,
    maxDrawdown: best.maxDrawdown
  },
  comparison: {
    reversionAvgPnL: revAvg,
    breakoutAvgPnL: breakAvg,
    winner: breakAvg > revAvg ? 'breakout' : 'reversion'
  },
  updatedAt: new Date().toISOString()
};

fs.writeFileSync(
  path.join(outDir, 'PUMP-optimal.json'),
  JSON.stringify(optimalConfig, null, 2)
);

console.log(`\n💾 Updated optimal config: data/optimal/PUMP-optimal.json`);
console.log(`\n✅ PUMP optimization complete!`);
