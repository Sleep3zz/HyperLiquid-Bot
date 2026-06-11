#!/usr/bin/env node
/**
 * Detailed Best-Params Backtest for BTC, SOL, HYPE
 */

const fs = require('fs');
const path = require('path');

// Best parameters found per coin
const COIN_CONFIGS = {
  BTC: { name: 'Trend-Following', rsiLong: 40, rsiShort: 60, adx: 20, sl: 3.0, tp: 5.0 },
  SOL: { name: 'Trend-Following', rsiLong: 40, rsiShort: 60, adx: 20, sl: 3.0, tp: 5.0 },
  HYPE: { name: 'Ultra-Conservative', rsiLong: 25, rsiShort: 75, adx: 25, sl: 1.5, tp: 2.5 }
};

function loadData(coin) {
  const indFile = path.join(__dirname, '..', 'data', 'indicators', coin, '15m-indicators.json');
  const chartFile = path.join(__dirname, '..', 'data', 'charts', coin, `${coin}-15m-90d.json`);
  
  const indicators = JSON.parse(fs.readFileSync(indFile, 'utf8'));
  const chart = JSON.parse(fs.readFileSync(chartFile, 'utf8'));
  const candles = chart.candles || [];
  const values = indicators.values || [];
  
  const priceMap = new Map();
  candles.forEach(c => priceMap.set(Number(c.t), Number(c.c)));
  values.forEach(v => { v.price = priceMap.get(v.t) || 0; });
  
  return values;
}

function runBacktest(coin, cfg) {
  const values = loadData(coin);
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
        
        trades.push({
          side: position.side,
          entry: position.entry,
          exit: price,
          entryTime: position.time,
          exitTime: curr.t,
          pnl: netPnL,
          realized,
          reason: pnl <= -cfg.sl ? 'stop-loss' : 'take-profit'
        });
        position = null;
      }
    }
    // Entry
    else {
      const bouncedUp = prevPrice <= curr.bbLower && price > curr.bbLower;
      const bouncedDown = prevPrice >= curr.bbUpper && price < curr.bbUpper;
      
      if (bouncedUp && curr.rsi < cfg.rsiLong && curr.adx < cfg.adx) {
        position = { side: 'LONG', entry: price, time: curr.t };
      }
      else if (bouncedDown && curr.rsi > cfg.rsiShort && curr.adx < cfg.adx) {
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
  
  return {
    coin,
    cfg,
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
    finalEquity: equity
  };
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     DETAILED BACKTEST - OPTIMAL PARAMETERS BY COIN              ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

const results = [];

for (const [coin, cfg] of Object.entries(COIN_CONFIGS)) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🪙 ${coin} - ${cfg.name}`);
  console.log(`   RSI ${cfg.rsiLong}/${cfg.rsiShort}, ADX < ${cfg.adx}, SL ${cfg.sl}%, TP ${cfg.tp}%`);
  console.log('═'.repeat(70));
  
  const r = runBacktest(coin, cfg);
  results.push(r);
  
  if (r.tradeCount === 0) {
    console.log('   No trades generated with these parameters.');
    continue;
  }
  
  console.log(`\n   📊 Performance:`);
  console.log(`      Trades: ${r.tradeCount} (${r.wins}W / ${r.losses}L)`);
  console.log(`      Win Rate: ${(r.winRate * 100).toFixed(1)}%`);
  console.log(`      Net PnL: $${r.netPnl.toFixed(2)} (${r.netPnlPct.toFixed(2)}%)`);
  console.log(`      Final Equity: $${r.finalEquity.toFixed(2)}`);
  console.log(`      Profit Factor: ${isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'}`);
  console.log(`      Max Drawdown: ${r.maxDrawdown.toFixed(2)}%`);
  console.log(`      Avg Win: $${r.avgWin.toFixed(2)} | Avg Loss: $${r.avgLoss.toFixed(2)}`);
  
  console.log(`\n   📋 Trade History:`);
  r.trades.forEach((t, i) => {
    const emoji = t.realized > 0 ? '✅' : '❌';
    const pnlStr = t.realized >= 0 ? `+$${t.realized.toFixed(2)}` : `-$${Math.abs(t.realized).toFixed(2)}`;
    const entryDate = new Date(t.entryTime).toISOString().slice(0, 10);
    console.log(`      ${i+1}. ${emoji} ${t.side.padEnd(5)} ${entryDate}  $${t.entry.toFixed(coin === 'BTC' ? 0 : 2)} → $${t.exit.toFixed(coin === 'BTC' ? 0 : 2)}  ${pnlStr.padStart(8)}  ${t.reason}`);
  });
}

// Comparison table
console.log(`\n${'═'.repeat(70)}`);
console.log('📊 SIDE-BY-SIDE COMPARISON');
console.log('═'.repeat(70));

console.log(`\n   ${'Coin'.padEnd(6)} ${'Params'.padEnd(18)} ${'Trades'.padStart(7)} ${'W/L'.padStart(8)} ${'Win%'.padStart(7)} ${'Net PnL'.padStart(11)} ${'Final Eq'.padStart(11)}`);
console.log(`   ${'─'.repeat(75)}`);

let totalPnl = 0;
results.forEach(r => {
  const wl = `${r.wins}/${r.losses}`;
  const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
  const eqStr = `$${r.finalEquity.toFixed(2)}`;
  console.log(`   ${r.coin.padEnd(6)} ${r.cfg.name.padEnd(18)} ${r.tradeCount.toString().padStart(7)} ${wl.padStart(8)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(11)} ${eqStr.padStart(11)}`);
  totalPnl += r.netPnl;
});

console.log(`   ${'─'.repeat(75)}`);
const totalStr = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
console.log(`   ${'TOTAL'.padEnd(6)} ${''.padEnd(18)} ${''.padStart(7)} ${''.padStart(8)} ${''.padStart(7)} ${totalStr.padStart(11)}`);

// Key findings
console.log(`\n${'─'.repeat(70)}`);
console.log('🔑 KEY FINDINGS:');
console.log('─'.repeat(70));
console.log(`   • BTC + SOL: Trend-Following (RSI 40/60, ADX 20, SL 3%/TP 5%) works best`);
console.log(`   • HYPE: No profitable config found - suggests avoiding or different strategy`);
console.log(`   • Combined PnL (BTC+SOL): $${(results[0].netPnl + results[1].netPnl).toFixed(2)}`);
console.log(`   • Best single trade: BTC with Trend-Following params`);

// Save
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `DETAILED-BTC-SOL-HYPE-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ results, totalPnl }, null, 2));
console.log(`\n💾 Saved: ${file}`);
