#!/usr/bin/env node
/**
 * Optimal Parameters Backtest - Detailed Report
 * Best: RSI 30/70, ADX 30 (Conservative)
 */

const fs = require('fs');
const path = require('path');

const COINS = ['ARB', 'BTC', 'ETH', 'HYPE', 'SOL', 'UNI'];

// OPTIMAL PARAMETERS
const CONFIG = {
  name: 'Conservative',
  rsiLong: 30,
  rsiShort: 70,
  adxThreshold: 30,
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
        
        trades.push({
          side: position.side,
          entry: position.entry,
          exit: price,
          pnl: netPnL,
          realized,
          reason: pnl <= -CONFIG.stopLoss ? 'stop-loss' : 'take-profit'
        });
        position = null;
      }
    }
    
    // Check entry
    else {
      const bouncedUp = prevPrice <= curr.bbLower && price > curr.bbLower;
      const bouncedDown = prevPrice >= curr.bbUpper && price < curr.bbUpper;
      
      if (bouncedUp && curr.rsi < CONFIG.rsiLong && curr.adx < CONFIG.adxThreshold) {
        position = { side: 'LONG', entry: price, time: curr.t };
      }
      else if (bouncedDown && curr.rsi > CONFIG.rsiShort && curr.adx < CONFIG.adxThreshold) {
        position = { side: 'SHORT', entry: price, time: curr.t };
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
  
  // Calculate Sharpe-like metric (simplified)
  const returns = trades.map(t => t.realized / 10000);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  const sharpe = variance > 0 ? mean / Math.sqrt(variance) : 0;
  
  return {
    coin,
    trades,
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: equity - startEquity,
    netPnlPct: ((equity - startEquity) / startEquity) * 100,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    sharpe
  };
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     OPTIMAL PARAMETERS BACKTEST - DETAILED REPORT               ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log(`\n📊 Configuration: ${CONFIG.name}`);
console.log(`   • RSI Long: < ${CONFIG.rsiLong}  |  RSI Short: > ${CONFIG.rsiShort}`);
console.log(`   • ADX Threshold: < ${CONFIG.adxThreshold}`);
console.log(`   • Stop Loss: ${CONFIG.stopLoss}%  |  Take Profit: ${CONFIG.takeProfit}%`);
console.log(`   • Position Size: ${CONFIG.positionSize * 100}% of equity`);
console.log(`   • Initial Capital: $10,000 per coin`);

const results = [];
for (const coin of COINS) {
  const r = runBacktest(coin);
  if (r) results.push(r);
}

// Per-coin detailed report
results.forEach(r => {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`🪙 ${r.coin}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(`   Total Trades: ${r.tradeCount}  |  Wins: ${r.wins}  |  Losses: ${r.losses}`);
  console.log(`   Win Rate: ${(r.winRate * 100).toFixed(1)}%  |  Profit Factor: ${r.profitFactor.toFixed(2)}`);
  console.log(`   Net PnL: $${r.netPnl.toFixed(2)} (${r.netPnlPct.toFixed(2)}%)`);
  console.log(`   Max Drawdown: ${r.maxDrawdown.toFixed(2)}%`);
  console.log(`   Avg Win: $${r.avgWin.toFixed(2)}  |  Avg Loss: $${r.avgLoss.toFixed(2)}`);
  
  if (r.trades.length > 0) {
    console.log(`\n   Trade History:`);
    r.trades.forEach((t, i) => {
      const emoji = t.realized > 0 ? '✅' : '❌';
      const pnlStr = t.realized >= 0 ? `+$${t.realized.toFixed(2)}` : `-$${Math.abs(t.realized).toFixed(2)}`;
      console.log(`      ${i+1}. ${emoji} ${t.side}  Entry: $${t.entry.toFixed(2)} → Exit: $${t.exit.toFixed(2)}  ${pnlStr}  (${t.reason})`);
    });
  }
});

// Aggregate summary
console.log(`\n${'═'.repeat(70)}`);
console.log('📊 AGGREGATE SUMMARY');
console.log('═'.repeat(70));

const totalPnl = results.reduce((s, r) => s + r.netPnl, 0);
const totalTrades = results.reduce((s, r) => s + r.tradeCount, 0);
const totalWins = results.reduce((s, r) => s + r.wins, 0);
const avgWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
const maxDD = Math.max(...results.map(r => r.maxDrawdown));
const avgPF = results.reduce((s, r) => s + (isFinite(r.profitFactor) ? r.profitFactor : 0), 0) / results.length;

console.log(`   Total Trades (all coins): ${totalTrades}`);
console.log(`   Total Wins: ${totalWins}  |  Total Losses: ${totalTrades - totalWins}`);
console.log(`   Overall Win Rate: ${avgWinRate.toFixed(1)}%`);
console.log(`   Total Net PnL: $${totalPnl.toFixed(2)}`);
console.log(`   Average Profit Factor: ${avgPF.toFixed(2)}`);
console.log(`   Worst Max Drawdown: ${maxDD.toFixed(2)}%`);

// Performance table
console.log(`\n${'─'.repeat(70)}`);
console.log(`   Performance Table:`);
console.log(`${'─'.repeat(70)}`);
console.log(`   ${'Coin'.padEnd(6)} ${'Trades'.padStart(7)} ${'W/L'.padStart(8)} ${'Win%'.padStart(7)} ${'Net PnL'.padStart(11)} ${'PF'.padStart(7)}`);
console.log(`   ${'─'.repeat(60)}`);
results.forEach(r => {
  const wl = `${r.wins}/${r.losses}`;
  const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
  console.log(`   ${r.coin.padEnd(6)} ${r.tradeCount.toString().padStart(7)} ${wl.padStart(8)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(11)} ${r.profitFactor.toFixed(2).padStart(7)}`);
});
console.log(`   ${'─'.repeat(60)}`);
const totalPnlStr = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
console.log(`   ${'TOTAL'.padEnd(6)} ${totalTrades.toString().padStart(7)} ${''.padStart(8)} ${avgWinRate.toFixed(1).padStart(7)} ${totalPnlStr.padStart(11)}`);

// Save results
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `OPTIMAL-backtest-${CONFIG.name.toLowerCase()}-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({
  timestamp: new Date().toISOString(),
  config: CONFIG,
  summary: { totalPnl, totalTrades, totalWins, avgWinRate, maxDD, avgPF },
  results
}, null, 2));

console.log(`\n💾 Results saved to: ${file}`);
console.log(`\n✅ Backtest complete!`);
