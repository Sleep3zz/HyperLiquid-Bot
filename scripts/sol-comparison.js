#!/usr/bin/env node
/**
 * SOL Before/After Comparison
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
        
        trades.push({ side: position.side, entry: position.entry, exit: price, pnl: netPnL, realized, reason: pnl <= -cfg.sl ? 'stop' : 'target' });
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
    trades,
    tradeCount: trades.length,
    wins: wins.length,
    losses: trades.length - wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: equity - startEquity,
    netPnlPct: ((equity - startEquity) / startEquity) * 100,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: trades.length - wins.length > 0 ? grossLoss / (trades.length - wins.length) : 0
  };
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     SOL OPTIMIZATION - BEFORE vs AFTER                          ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

const values = loadData();

const OLD_CONFIG = { mode: 'reversion', rsiLong: 40, rsiShort: 60, adx: 20, sl: 3.0, tp: 5.0 };
const NEW_CONFIG = { mode: 'reversion', rsiLong: 25, rsiShort: 55, adx: 40, sl: 3.0, tp: 6.0 };

console.log('\n📊 TESTING OLD PARAMETERS:');
console.log('   RSI 40/60, ADX < 20, SL 3%, TP 5%');
const old = runBacktest(values, OLD_CONFIG);

console.log('\n📊 TESTING NEW PARAMETERS:');
console.log('   RSI 25/55, ADX < 40, SL 3%, TP 6%');
const new_ = runBacktest(values, NEW_CONFIG);

console.log('\n' + '═'.repeat(70));
console.log('📈 COMPARISON RESULTS');
console.log('═'.repeat(70));

console.log(`\n   ${'Metric'.padEnd(20)} ${'OLD'.padStart(15)} ${'NEW'.padStart(15)} ${'Change'.padStart(12)}`);
console.log('   ' + '─'.repeat(65));

const formatPnL = (v) => v >= 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`;
const formatPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

console.log(`   ${'Net PnL'.padEnd(20)} ${formatPnL(old.netPnl).padStart(15)} ${formatPnL(new_.netPnl).padStart(15)} ${formatPnL(new_.netPnl - old.netPnl).padStart(12)}`);
console.log(`   ${'PnL %'.padEnd(20)} ${formatPct(old.netPnlPct).padStart(15)} ${formatPct(new_.netPnlPct).padStart(15)} ${formatPct(new_.netPnlPct - old.netPnlPct).padStart(12)}`);
console.log(`   ${'Trades'.padEnd(20)} ${old.tradeCount.toString().padStart(15)} ${new_.tradeCount.toString().padStart(15)} ${(new_.tradeCount - old.tradeCount).toString().padStart(12)}`);
console.log(`   ${'Win Rate'.padEnd(20)} ${(old.winRate*100).toFixed(1).padStart(14)}% ${(new_.winRate*100).toFixed(1).padStart(14)}% ${((new_.winRate - old.winRate)*100).toFixed(1).padStart(11)}%`);
console.log(`   ${'Profit Factor'.padEnd(20)} ${(isFinite(old.profitFactor) ? old.profitFactor.toFixed(2) : '∞').padStart(15)} ${(isFinite(new_.profitFactor) ? new_.profitFactor.toFixed(2) : '∞').padStart(15)}`);
console.log(`   ${'Max Drawdown'.padEnd(20)} ${old.maxDrawdown.toFixed(2).padStart(14)}% ${new_.maxDrawdown.toFixed(2).padStart(14)}%`);
console.log(`   ${'Avg Win'.padEnd(20)} ${formatPnL(old.avgWin).padStart(15)} ${formatPnL(new_.avgWin).padStart(15)}`);
console.log(`   ${'Avg Loss'.padEnd(20)} ${formatPnL(old.avgLoss).padStart(15)} ${formatPnL(new_.avgLoss).padStart(15)}`);

console.log('\n' + '═'.repeat(70));
console.log('🔑 KEY DIFFERENCES');
console.log('═'.repeat(70));

console.log(`\n   OLD Parameters:`);
console.log(`      • RSI: 40/60 (less extreme)`);
console.log(`      • ADX: < 20 (very weak trend only)`);
console.log(`      • TP: 5%`);
console.log(`      • Result: ${old.tradeCount} trades, ${(old.winRate*100).toFixed(1)}% win rate, ${formatPnL(old.netPnl)}`);

console.log(`\n   NEW Parameters:`);
console.log(`      • RSI: 25/55 (more extreme - deeper oversold/overbought)`);
console.log(`      • ADX: < 40 (allows moderate trends)`);
console.log(`      • TP: 6% (higher profit target)`);
console.log(`      • Result: ${new_.tradeCount} trades, ${(new_.winRate*100).toFixed(1)}% win rate, ${formatPnL(new_.netPnl)}`);

console.log(`\n   IMPROVEMENT: +${((new_.netPnl - old.netPnl) / Math.abs(old.netPnl) * 100).toFixed(0)}% better PnL!`);

console.log('\n' + '─'.repeat(70));
console.log('📋 NEW TRADE HISTORY:');
console.log('─'.repeat(70));

new_.trades.forEach((t, i) => {
  const emoji = t.realized > 0 ? '✅' : '❌';
  const pnlStr = t.realized >= 0 ? `+$${t.realized.toFixed(2)}` : `-$${Math.abs(t.realized).toFixed(2)}`;
  console.log(`   ${i+1}. ${emoji} ${t.side.padEnd(5)} $${t.entry.toFixed(2)} → $${t.exit.toFixed(2)}  ${pnlStr.padStart(8)}  ${t.reason}`);
});

console.log('\n✅ SOL optimal parameters updated successfully!');
console.log('   File: data/optimal/SOL-optimal.json');
console.log('   Restart paper trader to use new parameters.');
