#!/usr/bin/env node
/**
 * Final All-Coins Comparison with PUMP Update
 */

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     FINAL OPTIMAL PARAMETERS - ALL COINS (Updated)              ║');
console.log('║     Including PUMP Breakout Strategy                            ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

const configs = {
  BTC: { mode: 'reversion', rsi: '40/60', adx: 20, sl: 3, tp: 5, trades: 4, winRate: 100, netPnl: 206.67, pf: '∞' },
  SOL: { mode: 'reversion', rsi: '25/55', adx: 40, sl: 3, tp: 6, trades: 12, winRate: 66.7, netPnl: 381.03, pf: 3.91 },
  HYPE: { mode: 'breakout', rsi: '50/40', adx: 25, sl: 2, tp: 5, trades: 42, winRate: 47.6, netPnl: 503.87, pf: 1.86 },
  ARB: { mode: 'reversion', rsi: '35/60', adx: 25, sl: 2, tp: 6, trades: 10, winRate: 80.0, netPnl: 458.67, pf: 10.82 },
  PUMP: { mode: 'breakout', rsi: '65/35', adx: 20, sl: 3, tp: 5, trades: 44, winRate: 47.7, netPnl: 385.75, pf: 1.49 }
};

console.log('='.repeat(75));
console.log('📊 OPTIMAL PARAMETERS BY COIN');
console.log('='.repeat(75));

console.log(`\n   ${'Coin'.padEnd(6)} ${'Strategy'.padEnd(12)} ${'RSI'.padStart(7)} ${'ADX'.padStart(5)} ${'SL/TP'.padStart(8)} ${'Trades'.padStart(7)} ${'Win%'.padStart(7)} ${'PnL'.padStart(10)} ${'PF'.padStart(6)}`);
console.log('   ' + '─'.repeat(75));

let totalPnL = 0;
let totalTrades = 0;

Object.entries(configs).forEach(([coin, c]) => {
  const adxStr = c.mode === 'reversion' ? `<${c.adx}` : `>=${c.adx}`;
  const sltpStr = `${c.sl}/${c.tp}`;
  const pnlStr = `+$${c.netPnl.toFixed(2)}`;
  const pfStr = typeof c.pf === 'number' ? c.pf.toFixed(2) : c.pf;
  console.log(`   ${coin.padEnd(6)} ${c.mode.padEnd(12)} ${c.rsi.padStart(7)} ${adxStr.padStart(5)} ${sltpStr.padStart(8)} ${c.trades.toString().padStart(7)} ${c.winRate.toFixed(1).padStart(7)} ${pnlStr.padStart(10)} ${pfStr.padStart(6)}`);
  totalPnL += c.netPnl;
  totalTrades += c.trades;
});

console.log('   ' + '─'.repeat(75));
console.log(`   ${'TOTAL'.padEnd(6)} ${''.padEnd(12)} ${''.padStart(7)} ${''.padStart(5)} ${''.padStart(8)} ${totalTrades.toString().padStart(7)} ${''.padStart(7)} ${('+$' + totalPnL.toFixed(2)).padStart(10)}`);

console.log('\n' + '='.repeat(75));
console.log('🔑 STRATEGY DISTRIBUTION');
console.log('='.repeat(75));

const reversionCoins = Object.entries(configs).filter(([k, v]) => v.mode === 'reversion').map(([k]) => k);
const breakoutCoins = Object.entries(configs).filter(([k, v]) => v.mode === 'breakout').map(([k]) => k);

console.log(`\n   Mean Reversion (${reversionCoins.length} coins): ${reversionCoins.join(', ')}`);
console.log(`   Breakout (${breakoutCoins.length} coins): ${breakoutCoins.join(', ')}`);

const revPnL = reversionCoins.reduce((s, c) => s + configs[c].netPnl, 0);
const breakPnL = breakoutCoins.reduce((s, c) => s + configs[c].netPnl, 0);

console.log(`\n   Mean Reversion Total PnL: $${revPnL.toFixed(2)}`);
console.log(`   Breakout Total PnL:       $${breakPnL.toFixed(2)}`);

console.log('\n' + '='.repeat(75));
console.log('🏆 RANKINGS');
console.log('='.repeat(75));

const ranked = Object.entries(configs).sort((a, b) => b[1].netPnl - a[1].netPnl);

console.log(`\n   By PnL:`);
ranked.forEach(([coin, c], i) => {
  console.log(`   ${i+1}. ${coin}: +$${c.netPnl.toFixed(2)} (${c.mode})`);
});

const rankedByWinRate = Object.entries(configs).sort((a, b) => b[1].winRate - a[1].winRate);
console.log(`\n   By Win Rate:`);
rankedByWinRate.forEach(([coin, c], i) => {
  console.log(`   ${i+1}. ${coin}: ${c.winRate.toFixed(1)}% (${c.mode})`);
});

console.log('\n' + '='.repeat(75));
console.log('📊 PUMP COMPARISON');
console.log('='.repeat(75));

console.log(`\n   Previous (Mean Reversion): +$133.87 (33 trades, 45.5% win)`);
console.log(`   Current (Breakout):        +$385.75 (44 trades, 47.7% win)`);
console.log(`   Improvement:               +188% better PnL!`);
console.log(`\n   Key Insight: PUMP, like HYPE, works better with breakout strategy`);
console.log(`   (Buy strength/break above BB, sell weakness/break below BB)`);

console.log('\n✅ All coins optimized and ready for paper trading!');
console.log(`\nDashboard: https://trading.s3zapp.us`);
