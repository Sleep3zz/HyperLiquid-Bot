#!/usr/bin/env node
/**
 * PUMP Historical Test Comparison
 * Compare all past PUMP backtests
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     PUMP HISTORICAL TEST COMPARISON                             ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// Load all PUMP backtest results
const resultsDir = path.join(__dirname, '..', 'backtest-results');
const files = fs.readdirSync(resultsDir).filter(f => f.includes('PUMP')).sort();

console.log(`Found ${files.length} PUMP backtest files:\n`);

const allResults = [];

files.forEach(file => {
  const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8'));
  console.log(`📄 ${file}`);
  console.log(`   Date: ${data.timestamp}`);
  console.log(`   Tested: ${data.totalTested} configs`);
  console.log(`   Profitable: ${data.profitableCount} (${(data.profitableCount/data.totalTested*100).toFixed(1)}%)`);
  
  if (data.bestConfig) {
    const bc = data.bestConfig;
    console.log(`   Best: ${bc.cfg?.mode || 'unknown'} RSI ${bc.cfg?.rsiLong}/${bc.cfg?.rsiShort}`);
    console.log(`         ${bc.trades} trades, ${(bc.winRate*100).toFixed(1)}% win, +$${bc.netPnl?.toFixed(2) || 0}`);
    allResults.push({
      file,
      timestamp: data.timestamp,
      mode: bc.cfg?.mode || 'unknown',
      rsi: `${bc.cfg?.rsiLong}/${bc.cfg?.rsiShort}`,
      adx: bc.cfg?.adx,
      sl: bc.cfg?.sl,
      tp: bc.cfg?.tp,
      trades: bc.trades,
      winRate: bc.winRate,
      netPnl: bc.netPnl,
      profitFactor: bc.profitFactor
    });
  }
  console.log('');
});

// Find best overall
allResults.sort((a, b) => b.netPnl - a.netPnl);

console.log('='.repeat(70));
console.log('🏆 BEST PUMP CONFIGURATION ACROSS ALL TESTS');
console.log('='.repeat(70));

const best = allResults[0];
console.log(`\n   Source: ${best.file}`);
console.log(`   Date: ${best.timestamp}`);
console.log(`   Strategy: ${best.mode}`);
console.log(`   RSI: ${best.rsi} | ADX: ${best.adx}`);
console.log(`   SL: ${best.sl}% | TP: ${best.tp}%`);
console.log(`   Trades: ${best.trades}`);
console.log(`   Win Rate: ${(best.winRate*100).toFixed(1)}%`);
console.log(`   Net PnL: $${best.netPnl.toFixed(2)}`);
console.log(`   Profit Factor: ${best.profitFactor?.toFixed(2) || 'N/A'}`);

console.log(`\n📊 ALL RESULTS RANKED BY PnL:`);
console.log('   ' + '─'.repeat(65));
console.log(`   ${'Date'.padEnd(12)} ${'Mode'.padEnd(12)} ${'RSI'.padStart(7)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'PnL'.padStart(10)}`);
console.log('   ' + '─'.repeat(65));

allResults.forEach(r => {
  const date = r.timestamp.split('T')[0].slice(5);
  const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
  console.log(`   ${date.padEnd(12)} ${r.mode.padEnd(12)} ${r.rsi.padStart(7)} ${r.trades.toString().padStart(7)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(10)}`);
});

console.log('\n✅ Comparison complete!');
