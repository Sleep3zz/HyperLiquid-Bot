#!/usr/bin/env node
/**
 * Grid Strategy Optimal Configurations Summary
 */

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     GRID STRATEGY - OPTIMAL CONFIGURATIONS SUMMARY              ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

const results = {
  BTC: {
    levels: 12,
    spacing: 0.8,
    range: 10,
    amount: 200,
    trades: 23,
    pairs: 11,
    fees: 4.13,
    pnl: 126.03
  },
  SOL: {
    levels: 10,
    spacing: 0.5,
    range: 5,
    amount: 200,
    trades: 19,
    pairs: 9,
    fees: 3.33,
    pnl: 92.59
  },
  ETH: {
    levels: 8,
    spacing: 0.5,
    range: 5,
    amount: 200,
    trades: 15,
    pairs: 6,
    fees: 2.91,
    pnl: 30.84
  }
};

console.log('='.repeat(75));
console.log('📊 OPTIMAL GRID CONFIGURATIONS BY COIN');
console.log('='.repeat(75));

console.log(`\n   ${'Coin'.padEnd(6)} ${'Levels'.padStart(7)} ${'Spacing'.padStart(8)} ${'Range'.padStart(7)} ${'Amount'.padStart(8)} ${'Trades'.padStart(7)} ${'Pairs'.padStart(6)} ${'PnL'.padStart(10)}`);
console.log('   ' + '─'.repeat(75));

let totalPnL = 0;
Object.entries(results).forEach(([coin, r]) => {
  console.log(`   ${coin.padEnd(6)} ${r.levels.toString().padStart(7)} ${(r.spacing + '%').padStart(8)} ${(r.range + '%').padStart(7)} $${r.amount.toString().padStart(7)} ${r.trades.toString().padStart(7)} ${r.pairs.toString().padStart(6)} +$${r.pnl.toFixed(2).padStart(8)}`);
  totalPnL += r.pnl;
});

console.log('   ' + '─'.repeat(75));
console.log(`   ${'TOTAL'.padEnd(6)} ${''.padStart(7)} ${''.padStart(8)} ${''.padStart(7)} ${''.padStart(8)} ${''.padStart(7)} ${''.padStart(6)} +$${totalPnL.toFixed(2).padStart(8)}`);

console.log('\n' + '='.repeat(75));
console.log('🔑 KEY INSIGHTS');
console.log('='.repeat(75));

console.log(`
   1. SPACING:
      - Lower spacing (0.5-0.8%) works best
      - Tighter grids = more trades = more fees but also more opportunities
      - Too tight (0.5%) can be noisy; 0.8% is sweet spot for BTC

   2. GRID LEVELS:
      - More levels = wider range coverage
      - BTC: 12 levels (wider due to larger price swings)
      - SOL: 10 levels
      - ETH: 8 levels (less volatile)

   3. RANGE BOUND:
      - BTC: 10% (larger moves before stopping)
      - SOL/ETH: 5% (stops earlier on trend breakout)

   4. BASE AMOUNT:
      - $200 consistently optimal across all coins
      - Larger amounts = higher absolute PnL
      - Smaller amounts ($100) showed lower PnL

   5. PERFORMANCE RANKING:
      1. BTC: +$126.03 (best grid performance)
      2. SOL: +$92.59
      3. ETH: +$30.84
`);

console.log('='.repeat(75));
console.log('⚠️  GRID vs MEAN REVERSION COMPARISON');
console.log('='.repeat(75));

console.log(`\n   Coin    Grid PnL    BBRSI PnL    Winner`);
console.log('   ' + '─'.repeat(55));
console.log(`   BTC     +$126.03    +$309.97      BBRSI (+146%)`);
console.log(`   SOL     +$92.59     +$416.15      BBRSI (+350%)`);
console.log(`   ETH     +$30.84     N/A           Grid (only tested)`);

console.log(`\n   Note: BBRSI mean reversion significantly outperforms`);
console.log(`   grid trading on BTC and SOL. Grid may be better suited`);
console.log(`   for ranging markets or as a complementary strategy.`);

console.log('\n' + '='.repeat(75));
console.log('📁 CONFIGURATION FOR DEPLOYMENT');
console.log('='.repeat(75));

console.log(`
   Add to config/default.json or config/paper-trading.json:

   "trading": {
     "grid": {
       "BTC": {
         "levels": 12,
         "spacingPct": 0.8,
         "rangeBoundPct": 10,
         "baseAmount": 200
       },
       "SOL": {
         "levels": 10,
         "spacingPct": 0.5,
         "rangeBoundPct": 5,
         "baseAmount": 200
       },
       "ETH": {
         "levels": 8,
         "spacingPct": 0.5,
         "rangeBoundPct": 5,
         "baseAmount": 200
       }
     }
   }
`);

console.log('='.repeat(75));
console.log('✅ Grid Optimization Complete!');
console.log('='.repeat(75));
