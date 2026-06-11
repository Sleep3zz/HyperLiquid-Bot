#!/usr/bin/env node
/**
 * Fast Multi-Coin Backtest using streaming indicators
 */

const { loadCandles } = require('../src/utils/dataManager');
const { RSI, BollingerBands, ADX } = require('trading-signals');
const fs = require('fs');
const path = require('path');

const COINS = ['ARB', 'BTC', 'ETH', 'HYPE', 'SOL', 'UNI'];
const DAYS = 90;

// Optimal parameters
const CONFIG = {
  bbPeriod: 20,
  bbStdDev: 2,
  rsiPeriod: 14,
  adxPeriod: 14,
  adxThreshold: 25,
  rsiOversold: 25,
  rsiOverbought: 75,
  stopLoss: 1.5,
  takeProfit: 1.5,
  positionSize: 0.10, // 10% of equity
  warmup: 50
};

function runBacktest(coin) {
  console.log(`\n🔄 ${coin}...`);
  
  const allCandles = loadCandles(coin, '15m');
  const candles = allCandles.slice(-DAYS * 96);
  
  if (candles.length < 100) {
    console.log(`  ❌ Insufficient data: ${candles.length}`);
    return null;
  }
  
  // Streaming indicators
  const bb = new BollingerBands(CONFIG.bbPeriod, CONFIG.bbStdDev);
  const rsi = new RSI(CONFIG.rsiPeriod);
  const adx = new ADX(CONFIG.adxPeriod);
  
  let equity = 10000;
  const startEquity = equity;
  let position = null;
  const trades = [];
  let peakEquity = equity;
  let maxDrawdown = 0;
  
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prev = i > 0 ? candles[i - 1] : c;
    
    // Update indicators
    bb.update(c.c);
    rsi.update(c.c);
    adx.update({ high: c.h, low: c.l, close: c.c });
    
    if (i < CONFIG.warmup) continue;
    
    const bbResult = bb.getResult();
    const rsiVal = parseFloat(rsi.getResult().valueOf());
    const adxVal = parseFloat(adx.getResult().valueOf());
    const lower = parseFloat(bbResult.lower.valueOf());
    const upper = parseFloat(bbResult.upper.valueOf());
    
    // Check exit
    if (position) {
      const entry = position.entry;
      const pnl = position.side === 'LONG' 
        ? ((c.c - entry) / entry) * 100
        : ((entry - c.c) / entry) * 100;
      
      if (pnl <= -CONFIG.stopLoss || pnl >= CONFIG.takeProfit) {
        const fee = 0.09;
        const netPnL = pnl - fee;
        const realized = (netPnL / 100) * equity * CONFIG.positionSize;
        equity += realized;
        
        trades.push({
          side: position.side,
          pnl: netPnL,
          realized: realized,
          reason: pnl <= -CONFIG.stopLoss ? 'stop' : 'target'
        });
        
        position = null;
      }
    }
    
    // Check entry
    else {
      const bouncedUp = prev.c <= lower && c.c > lower;
      const bouncedDown = prev.c >= upper && c.c < upper;
      
      if (bouncedUp && rsiVal < CONFIG.rsiOversold && adxVal < CONFIG.adxThreshold) {
        position = { side: 'LONG', entry: c.c, time: c.t };
      }
      else if (bouncedDown && rsiVal > CONFIG.rsiOverbought && adxVal < CONFIG.adxThreshold) {
        position = { side: 'SHORT', entry: c.c, time: c.t };
      }
    }
    
    // Track drawdown
    if (equity > peakEquity) peakEquity = equity;
    const dd = ((peakEquity - equity) / peakEquity) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  // Metrics
  const wins = trades.filter(t => t.realized > 0);
  const losses = trades.filter(t => t.realized <= 0);
  const netPnl = equity - startEquity;
  
  return {
    coin,
    candles: candles.length,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl,
    netPnlPct: (netPnl / startEquity) * 100,
    maxDrawdown,
    profitFactor: losses.length ? 
      Math.abs(wins.reduce((s,t)=>s+t.realized,0) / losses.reduce((s,t)=>s+t.realized,0)) : 
      (wins.length ? Infinity : 0)
  };
}

console.log('🚀 Fast Multi-Coin Backtest');
console.log(`📅 ${DAYS} days | Optimal params (RSI 25/75, BB 20/2, ADX 25)`);

const results = [];
for (const coin of COINS) {
  const r = runBacktest(coin);
  if (r) results.push(r);
}

// Summary
console.log(`\n${'='.repeat(75)}`);
console.log('📊 RESULTS SUMMARY');
console.log('='.repeat(75));
console.log(`${'Coin'.padEnd(6)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'Net PnL'.padStart(10)} ${'PnL%'.padStart(7)} ${'MaxDD%'.padStart(8)} ${'PF'.padStart(6)}`);
console.log('-'.repeat(75));

let totalPnl = 0;
let totalTrades = 0;

results.forEach(r => {
  const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
  console.log(`${r.coin.padEnd(6)} ${r.trades.toString().padStart(7)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(10)} ${r.netPnlPct.toFixed(2).padStart(7)} ${r.maxDrawdown.toFixed(2).padStart(8)} ${r.profitFactor.toFixed(2).padStart(6)}`);
  totalPnl += r.netPnl;
  totalTrades += r.trades;
});

console.log('-'.repeat(75));
console.log(`${'TOTAL'.padEnd(6)} ${totalTrades.toString().padStart(7)} ${''.padStart(7)} ${(totalPnl >= 0 ? '+' : '-') + '$' + Math.abs(totalPnl).toFixed(2).padStart(8)}`);

// Save
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `fast-optimal-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({results, totalPnl, totalTrades}, null, 2));
console.log(`\n💾 Saved: ${file}`);
