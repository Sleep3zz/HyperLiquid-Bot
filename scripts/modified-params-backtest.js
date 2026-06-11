#!/usr/bin/env node
/**
 * Multi-Coin Backtest - Streaming Parameters
 * 
 * Uses parameters from streaming-backtest.js:
 * - RSI < 40 (long) / RSI > 60 (short)
 * - ADX < 35 (trend filter)
 * - BB touch/bounce
 */

const fs = require('fs');
const path = require('path');

const COINS = ['ARB', 'BTC', 'ETH', 'HYPE', 'SOL', 'UNI'];

// Modified parameters from streaming-backtest.js
const CONFIG = {
  rsiLong: 40,
  rsiShort: 60,
  adxThreshold: 35,
  stopLoss: 2.0,
  takeProfit: 3.0,
  positionSize: 0.10
};

function loadData(coin) {
  const indFile = path.join(__dirname, '..', 'data', 'indicators', coin, '15m-indicators.json');
  const chartFile = path.join(__dirname, '..', 'data', 'charts', coin, `${coin}-15m-90d.json`);
  
  if (!fs.existsSync(indFile) || !fs.existsSync(chartFile)) return null;
  
  const indicators = JSON.parse(fs.readFileSync(indFile, 'utf8'));
  const chart = JSON.parse(fs.readFileSync(chartFile, 'utf8'));
  const candles = chart.candles || [];
  const values = indicators.values || [];
  
  // Merge
  const priceMap = new Map();
  candles.forEach(c => priceMap.set(Number(c.t), Number(c.c)));
  
  values.forEach(v => {
    v.price = priceMap.get(v.t) || 0;
  });
  
  return { values, candles };
}

function runBacktest(coin) {
  const data = loadData(coin);
  if (!data) return null;
  
  const { values } = data;
  let equity = 10000;
  const startEquity = equity;
  let position = null;
  const trades = [];
  let peakEquity = equity;
  let maxDrawdown = 0;
  
  let entryCount = 0;
  
  for (let i = 1; i < values.length; i++) {
    const curr = values[i];
    const prev = values[i - 1];
    
    if (curr.rsi === null || curr.bbLower === null || curr.adx === null) continue;
    
    const price = curr.price;
    const prevPrice = prev.price;
    if (!price || !prevPrice) continue;
    
    // Check exit
    if (position) {
      const pnl = position.side === 'LONG' 
        ? ((price - position.entry) / position.entry) * 100
        : ((position.entry - price) / position.entry) * 100;
      
      if (pnl <= -CONFIG.stopLoss || pnl >= CONFIG.takeProfit) {
        const fee = 0.09;
        const netPnL = pnl - fee;
        const realized = (netPnL / 100) * equity * CONFIG.positionSize;
        equity += realized;
        
        trades.push({ side: position.side, pnl: netPnL, realized, reason: pnl <= -CONFIG.stopLoss ? 'stop' : 'target' });
        position = null;
      }
    }
    
    // Check entry
    else {
      // Bounce from BB
      const bouncedUp = prevPrice <= curr.bbLower && price > curr.bbLower;
      const bouncedDown = prevPrice >= curr.bbUpper && price < curr.bbUpper;
      
      if (bouncedUp && curr.rsi < CONFIG.rsiLong && curr.adx < CONFIG.adxThreshold) {
        position = { side: 'LONG', entry: price };
        entryCount++;
      }
      else if (bouncedDown && curr.rsi > CONFIG.rsiShort && curr.adx < CONFIG.adxThreshold) {
        position = { side: 'SHORT', entry: price };
        entryCount++;
      }
    }
    
    if (equity > peakEquity) peakEquity = equity;
    const dd = ((peakEquity - equity) / peakEquity) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  const wins = trades.filter(t => t.realized > 0);
  const losses = trades.filter(t => t.realized <= 0);
  const grossWin = wins.reduce((s, t) => s + t.realized, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realized, 0));
  
  return {
    coin,
    candles: values.length,
    trades: trades.length,
    entrySignals: entryCount,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: equity - startEquity,
    netPnlPct: ((equity - startEquity) / startEquity) * 100,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)
  };
}

console.log('🚀 Multi-Coin Backtest - Modified Parameters');
console.log(`🎯 RSI < ${CONFIG.rsiLong} / RSI > ${CONFIG.rsiShort}, ADX < ${CONFIG.adxThreshold}, SL ${CONFIG.stopLoss}% / TP ${CONFIG.takeProfit}%`);

const results = [];
for (const coin of COINS) {
  const r = runBacktest(coin);
  if (r) results.push(r);
}

console.log(`\n${'='.repeat(85)}`);
console.log('📊 BACKTEST RESULTS');
console.log('='.repeat(85));
console.log(`${'Coin'.padEnd(6)} ${'Trades'.padStart(7)} ${'Wins'.padStart(6)} ${'Losses'.padStart(7)} ${'Win%'.padStart(7)} ${'Net PnL'.padStart(11)} ${'PnL%'.padStart(7)} ${'MaxDD%'.padStart(8)} ${'PF'.padStart(6)}`);
console.log('-'.repeat(85));

let totalPnl = 0, totalTrades = 0, totalWins = 0;

results.forEach(r => {
  const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
  console.log(`${r.coin.padEnd(6)} ${r.trades.toString().padStart(7)} ${r.wins.toString().padStart(6)} ${r.losses.toString().padStart(7)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(11)} ${r.netPnlPct.toFixed(2).padStart(7)} ${r.maxDrawdown.toFixed(2).padStart(8)} ${r.profitFactor.toFixed(2).padStart(6)}`);
  totalPnl += r.netPnl;
  totalTrades += r.trades;
  totalWins += r.wins;
});

console.log('-'.repeat(85));
const totalWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
console.log(`${'TOTAL'.padEnd(6)} ${totalTrades.toString().padStart(7)} ${totalWins.toString().padStart(6)} ${(totalTrades-totalWins).toString().padStart(7)} ${totalWinRate.toFixed(1).padStart(7)} ${(totalPnl >= 0 ? '+$' : '-$') + Math.abs(totalPnl).toFixed(2).padStart(9)}`);

// Save
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `modified-params-backtest-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({results, totalPnl, totalTrades, totalWins, config: CONFIG}, null, 2));
console.log(`\n💾 Saved: ${file}`);
