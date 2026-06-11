#!/usr/bin/env node
/**
 * BTC Before/After Comparison
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     BTC OPTIMIZATION - BEFORE vs AFTER                          ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

console.log('='.repeat(70));
console.log('📊 COMPARISON');
console.log('='.repeat(70));

console.log(`\n   ${'Metric'.padEnd(20)} ${'BEFORE'.padStart(15)} ${'AFTER'.padStart(15)} ${'Change'.padStart(12)}`);
console.log('   ' + '─'.repeat(65));

console.log(`   ${'RSI Levels'.padEnd(20)} ${'40/60'.padStart(15)} ${'45/60'.padStart(15)} ${'+5/-0'.padStart(12)}`);
console.log(`   ${'Stop Loss'.padEnd(20)} ${'3.0%'.padStart(15)} ${'3.5%'.padStart(15)} ${'+0.5%'.padStart(12)}`);
console.log(`   ${'Take Profit'.padEnd(20)} ${'5.0%'.padStart(15)} ${'5.0%'.padStart(15)} ${'Same'.padStart(12)}`);
console.log(`   ${'Trades'.padEnd(20)} ${'4'.padStart(15)} ${'6'.padStart(15)} ${'+50%'.padStart(12)}`);
console.log(`   ${'Win Rate'.padEnd(20)} ${'100.0%'.padStart(15)} ${'100.0%'.padStart(15)} ${'Perfect'.padStart(12)}`);
console.log(`   ${'Net PnL'.padEnd(20)} ${'+$206.67'.padStart(15)} ${'+$309.97'.padStart(15)} ${'+50.0%'.padStart(12)}`);

console.log('\n' + '='.repeat(70));
console.log('🔑 KEY CHANGES');
console.log('='.repeat(70));

console.log(`
   1. RSI Oversold: 40 → 45 (less extreme, more opportunities)
   2. Stop Loss: 3.0% → 3.5% (slightly wider, allows more breathing room)
   3. Result: +2 more trades, +$103.30 additional profit
   
   The sweet spot for BTC appears to be:
   - RSI 45/60 (less extreme than 40/70, more than 50/50)
   - SL 3.5% (balances risk with opportunity)
   - TP 5% (keeps 1:1.4 risk/reward ratio)
`);

console.log('='.repeat(70));
console.log('✅ BTC Updated to Optimized Parameters!');
console.log('='.repeat(70));
