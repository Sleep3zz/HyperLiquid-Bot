#!/usr/bin/env node
/**
 * Ultra-fast backtest using pre-computed indicators
 */

const fs = require('fs');
const path = require('path');

const COINS = ['ARB', 'BTC', 'ETH', 'HYPE', 'SOL', 'UNI'];

// Optimal parameters
const CONFIG = {
  rsiOversold: 25,
  rsiOverbought: 75,
  adxThreshold: 25,
  stopLoss: 1.5,
  takeProfit: 1.5,
  warmup: 30
};

function loadIndicators(coin) {
  const indFile = path.join(__dirname, '..', 'data', 'indicators', coin, '15m-indicators.json');
  const chartFile = path.join(__dirname, '..', 'data', 'charts', coin, `${coin}-15m-90d.json`);
  
  if (!fs.existsSync(indFile)) {
    console.log(`  ⚠️ No indicators for ${coin}`);
    return null;
  }
  if (!fs.existsSync(chartFile)) {
    console.log(`  ⚠️ No chart data for ${coin}`);
    return null;
  }
  
  const indicators = JSON.parse(fs.readFileSync(indFile, 'utf8'));
  const chart = JSON.parse(fs.readFileSync(chartFile, 'utf8'));
  
  // Merge price data from chart with indicators
  const chartData = Array.isArray(chart) ? chart : (chart.candles || chart.data || []);
  const values = indicators.values || [];
  
  // Create a map of timestamp to price
  const priceMap = new Map();
  chartData.forEach(c => {
    const t = Number(c.t || c.time || c.T);
    const price = Number(c.c || c.close);
    if (t && price) priceMap.set(t, price);
  });
  
  console.log(`  📈 Price data: ${chartData.length} candles, matched: ${priceMap.size} prices`);
  
  // Add price to each indicator value
  values.forEach(v => {
    v.price = priceMap.get(v.t) || 0;
  });
  
  return { ...indicators, values };
}

function runBacktest(coin) {
  console.log(`\n🔄 ${coin}...`);
  
  const data = loadIndicators(coin);
  if (!data || !data.values) return null;
  
  const values = data.values;
  console.log(`  📊 ${values.length} indicator sets`);
  
  let equity = 10000;
  const startEquity = equity;
  let position = null;
  const trades = [];
  let peakEquity = equity;
  let maxDrawdown = 0;
  
  for (let i = 1; i < values.length; i++) {
    const curr = values[i];
    const prev = values[i - 1];
    
    // Skip until we have valid indicators
    if (curr.rsi === null || curr.bbLower === null || curr.adx === null) continue;
    
    const price = curr.price || 0;
    const prevPrice = prev.price || price;
    
    if (!price) continue;
    
    // Check exit
    if (position) {
      const pnl = position.side === 'LONG' 
        ? ((price - position.entry) / position.entry) * 100
        : ((position.entry - price) / position.entry) * 100;
      
      if (pnl <= -CONFIG.stopLoss || pnl >= CONFIG.takeProfit) {
        const fee = 0.09;
        const netPnL = pnl - fee;
        const realized = (netPnL / 100) * equity * 0.10; // 10% position
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
    
    // Check entry (when flat)
    else {
      const bouncedUp = prevPrice <= curr.bbLower && price > curr.bbLower;
      const bouncedDown = prevPrice >= curr.bbUpper && price < curr.bbUpper;
      
      if (bouncedUp && curr.rsi < CONFIG.rsiOversold && curr.adx < CONFIG.adxThreshold) {
        position = { side: 'LONG', entry: price, time: curr.t };
      }
      else if (bouncedDown && curr.rsi > CONFIG.rsiOverbought && curr.adx < CONFIG.adxThreshold) {
        position = { side: 'SHORT', entry: price, time: curr.t };
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
  const grossWin = wins.reduce((s, t) => s + t.realized, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realized, 0));
  
  return {
    coin,
    candles: values.length,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl,
    netPnlPct: (netPnl / startEquity) * 100,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)
  };
}

console.log('🚀 Ultra-Fast Multi-Coin Backtest (using pre-computed indicators)');
console.log(`🎯 Optimal params: RSI ${CONFIG.rsiOversold}/${CONFIG.rsiOverbought}, ADX ${CONFIG.adxThreshold}, SL/TP ${CONFIG.stopLoss}%`);

const results = [];
for (const coin of COINS) {
  const r = runBacktest(coin);
  if (r) results.push(r);
}

// Summary
console.log(`\n${'='.repeat(80)}`);
console.log('📊 BACKTEST RESULTS - OPTIMAL PARAMETERS');
console.log('='.repeat(80));
console.log(`${'Coin'.padEnd(6)} ${'Trades'.padStart(7)} ${'Wins'.padStart(6)} ${'Losses'.padStart(7)} ${'Win%'.padStart(7)} ${'Net PnL'.padStart(10)} ${'PnL%'.padStart(7)} ${'MaxDD%'.padStart(8)} ${'PF'.padStart(6)}`);
console.log('-'.repeat(80));

let totalPnl = 0;
let totalTrades = 0;
let totalWins = 0;

results.forEach(r => {
  const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
  console.log(`${r.coin.padEnd(6)} ${r.trades.toString().padStart(7)} ${r.wins.toString().padStart(6)} ${r.losses.toString().padStart(7)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(10)} ${r.netPnlPct.toFixed(2).padStart(7)} ${r.maxDrawdown.toFixed(2).padStart(8)} ${r.profitFactor.toFixed(2).padStart(6)}`);
  totalPnl += r.netPnl;
  totalTrades += r.trades;
  totalWins += r.wins;
});

console.log('-'.repeat(80));
const totalWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
console.log(`${'TOTAL'.padEnd(6)} ${totalTrades.toString().padStart(7)} ${totalWins.toString().padStart(6)} ${(totalTrades-totalWins).toString().padStart(7)} ${totalWinRate.toFixed(1).padStart(7)} ${(totalPnl >= 0 ? '+$' : '-$') + Math.abs(totalPnl).toFixed(2).padStart(8)}`);

// Save
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `optimal-params-backtest-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({results, totalPnl, totalTrades, totalWins, config: CONFIG}, null, 2));
console.log(`\n💾 Results saved: ${file}`);
