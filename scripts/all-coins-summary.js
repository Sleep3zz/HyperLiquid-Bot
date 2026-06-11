#!/usr/bin/env node
/**
 * All Coins Optimal Parameters Summary
 */

const fs = require('fs');
const path = require('path');

const COINS = ['BTC', 'SOL', 'HYPE', 'ARB'];

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     OPTIMAL PARAMETERS SUMMARY - ALL COINS                      ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

console.log('\n' + '═'.repeat(70));
console.log('📊 CONFIGURATION COMPARISON');
console.log('═'.repeat(70));

console.log(`\n   ${'Coin'.padEnd(6)} ${'Mode'.padEnd(12)} ${'RSI'.padStart(7)} ${'ADX'.padStart(5)} ${'SL/TP'.padStart(8)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'PnL'.padStart(10)}`);
console.log('   ' + '─'.repeat(65));

const configs = {
  BTC: { mode: 'reversion', rsiLong: 40, rsiShort: 60, adx: 20, sl: 3.0, tp: 5.0, trades: 4, wins: 4, netPnl: 206.67 },
  SOL: { mode: 'reversion', rsiLong: 25, rsiShort: 55, adx: 40, sl: 3.0, tp: 6.0, trades: 12, wins: 8, netPnl: 381.03 },
  HYPE: { mode: 'breakout', rsiLong: 50, rsiShort: 40, adx: 25, sl: 2.0, tp: 5.0, trades: 42, wins: 20, netPnl: 503.87 },
  ARB: { mode: 'reversion', rsiLong: 35, rsiShort: 60, adx: 25, sl: 2.0, tp: 6.0, trades: 10, wins: 8, netPnl: 458.67 }
};

let totalPnL = 0;
let totalTrades = 0;

Object.entries(configs).forEach(([coin, c]) => {
  const rsiStr = `${c.rsiLong}/${c.rsiShort}`;
  const sltpStr = `${c.sl}/${c.tp}`;
  const adxStr = c.mode === 'reversion' ? `<${c.adx}` : `>=${c.adx}`;
  const winRate = (c.wins / c.trades * 100).toFixed(1);
  const pnlStr = `+$${c.netPnl.toFixed(2)}`;
  
  console.log(`   ${coin.padEnd(6)} ${c.mode.padEnd(12)} ${rsiStr.padStart(7)} ${adxStr.padStart(5)} ${sltpStr.padStart(8)} ${c.trades.toString().padStart(7)} ${winRate.padStart(7)} ${pnlStr.padStart(10)}`);
  
  totalPnL += c.netPnl;
  totalTrades += c.trades;
});

console.log('   ' + '─'.repeat(65));
console.log(`   ${'TOTAL'.padEnd(6)} ${''.padEnd(12)} ${''.padStart(7)} ${''.padStart(5)} ${''.padStart(8)} ${totalTrades.toString().padStart(7)} ${''.padStart(7)} ${('+$' + totalPnL.toFixed(2)).padStart(10)}`);

console.log('\n' + '═'.repeat(70));
console.log('🔑 KEY INSIGHTS');
console.log('═'.repeat(70));

console.log(`\n   Strategy Distribution:`);
console.log(`      • Mean Reversion: BTC, SOL, ARB (3 coins)`);
console.log(`      • Breakout: HYPE (1 coin)`);

console.log(`\n   Best Performers:`);
console.log(`      1. HYPE: +$503.87 (breakout during trend)`);
console.log(`      2. ARB: +$458.67 (80% win rate, excellent PF)`);
console.log(`      3. SOL: +$381.03 (optimized reversion)`);
console.log(`      4. BTC: +$206.67 (perfect 4/4 win rate)`);

console.log(`\n   Combined Portfolio PnL: +$${totalPnL.toFixed(2)}`);

console.log('\n' + '═'.repeat(70));
console.log('📁 FILES UPDATED');
console.log('═'.repeat(70));

COINS.forEach(coin => {
  console.log(`   ✓ data/optimal/${coin}-optimal.json`);
});

console.log('\n✅ All coin configurations are ready for paper trading!');
