#!/usr/bin/env node
/**
 * Final Comparison: BTC, SOL, HYPE with Optimal Parameters
 */

const fs = require('fs');
const path = require('path');

// Optimal parameters per coin
const COIN_CONFIGS = {
  BTC: { 
    name: 'Trend-Following (Reversion)', 
    mode: 'reversion',
    rsiLong: 40, rsiShort: 60, adx: 20, sl: 3.0, tp: 5.0 
  },
  SOL: { 
    name: 'Trend-Following (Reversion)', 
    mode: 'reversion',
    rsiLong: 40, rsiShort: 60, adx: 20, sl: 3.0, tp: 5.0 
  },
  HYPE: { 
    name: 'Breakout', 
    mode: 'breakout',
    rsiLong: 50, rsiShort: 40, adx: 25, sl: 2.0, tp: 5.0 
  }
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
          pnl: netPnL,
          realized,
          reason: pnl <= -cfg.sl ? 'stop-loss' : 'take-profit'
        });
        position = null;
      }
    }
    // Entry
    else {
      let entrySignal = null;
      
      if (cfg.mode === 'breakout') {
        // Breakout: price breaks BB bands with RSI confirmation
        const brokeUp = prevPrice <= curr.bbUpper && price > curr.bbUpper;
        const brokeDown = prevPrice >= curr.bbLower && price < curr.bbLower;
        
        if (brokeUp && curr.rsi > cfg.rsiLong && curr.adx >= cfg.adx) entrySignal = 'LONG';
        else if (brokeDown && curr.rsi < cfg.rsiShort && curr.adx >= cfg.adx) entrySignal = 'SHORT';
      } else {
        // Reversion: bounce from BB bands
        const bouncedUp = prevPrice <= curr.bbLower && price > curr.bbLower;
        const bouncedDown = prevPrice >= curr.bbUpper && price < curr.bbUpper;
        
        if (bouncedUp && curr.rsi < cfg.rsiLong && curr.adx < cfg.adx) entrySignal = 'LONG';
        else if (bouncedDown && curr.rsi > cfg.rsiShort && curr.adx < cfg.adx) entrySignal = 'SHORT';
      }
      
      if (entrySignal) {
        position = { side: entrySignal, entry: price };
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
console.log('║     FINAL OPTIMAL PARAMETERS COMPARISON                         ║');
console.log('║     BTC | SOL | HYPE                                            ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

const results = [];

for (const [coin, cfg] of Object.entries(COIN_CONFIGS)) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🪙 ${coin} - ${cfg.name}`);
  console.log(`   Mode: ${cfg.mode} | RSI ${cfg.rsiLong}/${cfg.rsiShort} | ADX ${cfg.adx} | SL ${cfg.sl}% | TP ${cfg.tp}%`);
  console.log('═'.repeat(70));
  
  const r = runBacktest(coin, cfg);
  results.push(r);
  
  console.log(`\n   📊 Performance:`);
  console.log(`      Trades: ${r.tradeCount} (${r.wins}W / ${r.losses}L)`);
  console.log(`      Win Rate: ${(r.winRate * 100).toFixed(1)}%`);
  console.log(`      Net PnL: $${r.netPnl.toFixed(2)} (${r.netPnlPct.toFixed(2)}%)`);
  console.log(`      Final Equity: $${r.finalEquity.toFixed(2)}`);
  console.log(`      Profit Factor: ${isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'}`);
  console.log(`      Max Drawdown: ${r.maxDrawdown.toFixed(2)}%`);
  console.log(`      Avg Win: $${r.avgWin.toFixed(2)} | Avg Loss: $${r.avgLoss.toFixed(2)}`);
  
  if (r.tradeCount > 0) {
    console.log(`\n   📋 Last 5 Trades:`);
    r.trades.slice(-5).forEach((t, i) => {
      const emoji = t.realized > 0 ? '✅' : '❌';
      const pnlStr = t.realized >= 0 ? `+$${t.realized.toFixed(2)}` : `-$${Math.abs(t.realized).toFixed(2)}`;
      console.log(`      ${emoji} ${t.side.padEnd(5)} $${t.entry.toFixed(coin === 'BTC' ? 0 : 2)} → $${t.exit.toFixed(coin === 'BTC' ? 0 : 2)}  ${pnlStr.padStart(8)}  ${t.reason}`);
    });
  }
}

// Final comparison table
console.log(`\n${'═'.repeat(70)}`);
console.log('📊 FINAL COMPARISON TABLE');
console.log('═'.repeat(70));

console.log(`\n   ${'Coin'.padEnd(6)} ${'Strategy'.padEnd(20)} ${'Trades'.padStart(7)} ${'W/L'.padStart(8)} ${'Win%'.padStart(7)} ${'Net PnL'.padStart(11)} ${'PF'.padStart(7)} ${'MaxDD%'.padStart(8)}`);
console.log(`   ${'─'.repeat(80)}`);

let totalPnl = 0;
let totalTrades = 0;

results.forEach(r => {
  const wl = `${r.wins}/${r.losses}`;
  const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`;
  const pfStr = isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞';
  console.log(`   ${r.coin.padEnd(6)} ${r.cfg.name.padEnd(20)} ${r.tradeCount.toString().padStart(7)} ${wl.padStart(8)} ${(r.winRate*100).toFixed(1).padStart(7)} ${pnlStr.padStart(11)} ${pfStr.padStart(7)} ${r.maxDrawdown.toFixed(2).padStart(8)}`);
  totalPnl += r.netPnl;
  totalTrades += r.tradeCount;
});

console.log(`   ${'─'.repeat(80)}`);
const totalStr = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
console.log(`   ${'TOTAL'.padEnd(6)} ${''.padEnd(20)} ${totalTrades.toString().padStart(7)} ${''.padStart(8)} ${''.padStart(7)} ${totalStr.padStart(11)}`);

// Summary
console.log(`\n${'─'.repeat(70)}`);
console.log('🏆 SUMMARY & RECOMMENDATIONS:');
console.log('─'.repeat(70));
console.log(`   • BTC: Mean-reversion works best (RSI 40/60, ADX 20)`);
console.log(`   • SOL: Mean-reversion works best (RSI 40/60, ADX 20)`);
console.log(`   • HYPE: Breakout strategy works best (RSI 50/40, ADX 25)`);
console.log(`   • Combined PnL: $${totalPnl.toFixed(2)} across all 3 coins`);
console.log(`   • Total trades: ${totalTrades}`);

// Save
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `FINAL-OPTIMAL-BTC-SOL-HYPE-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ results, totalPnl, totalTrades }, null, 2));

console.log(`\n💾 Results saved: ${file}`);
