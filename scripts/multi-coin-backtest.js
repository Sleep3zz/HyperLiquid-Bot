#!/usr/bin/env node
/**
 * Multi-Coin Optimal Backtest Runner
 * 
 * Runs BBRSI backtests for all available coins with optimal parameters:
 * - RSI: oversold 25, overbought 75
 * - BB: period 20, stdDev 2
 * - ADX: threshold 25
 * - Mode: reversion
 * - Stop Loss: 1.5%
 * - Take Profit: 1.5%
 * 
 * Usage: node scripts/multi-coin-backtest.js [--days 90]
 */

const { loadCandles } = require('../src/utils/dataManager');
const { BBRSIStrategy } = require('../src/strategy/BBRSIStrategy');
const fs = require('fs');
const path = require('path');

// Parse args
const args = process.argv.slice(2);
const daysArg = parseInt(args.find(a => a.startsWith('--days'))?.split('=')[1] || '90');

// Available coins with indicator data
const COINS = ['ARB', 'BTC', 'ETH', 'HYPE', 'SOL', 'UNI'];

// Memory-only state store (no disk writes during backtest)
const memoryStore = { load: () => ({}), save: () => {} };

// Silent logger
const silentLogger = { info() {}, warn() {}, error() {} };

function pctMove(side, entry, exit) {
  const m = ((exit - entry) / entry) * 100;
  return side === "LONG" ? m : -m;
}

async function backtestCoin(coin, days) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Backtesting ${coin} (${days} days)`);
  console.log('='.repeat(60));
  
  // Load candles
  const allCandles = loadCandles(coin, '15m');
  const candles = allCandles.slice(-days * 96);
  
  if (candles.length < 100) {
    console.log(`❌ Insufficient data: ${candles.length} candles`);
    return null;
  }
  
  console.log(`📊 Candles: ${candles.length} (~${(candles.length/96).toFixed(1)} days)`);
  console.log(`📅 Range: ${new Date(candles[0].t).toISOString().split('T')[0]} to ${new Date(candles[candles.length-1].t).toISOString().split('T')[0]}`);
  
  // Strategy instance
  const strat = new BBRSIStrategy(silentLogger, memoryStore);
  strat.stateStore = memoryStore;
  
  // Backtest state
  const startEquity = 10000;
  let equity = startEquity;
  let position = null;
  const trades = [];
  let peakEquity = startEquity;
  let maxDrawdownPct = 0;
  
  const warmup = 60;
  
  // Replay
  for (let i = warmup; i < candles.length; i++) {
    const bar = candles[i];
    const history = candles.slice(0, i + 1);
    
    // Current PnL calc
    let currentPnl = 0;
    if (position) {
      const grossPct = pctMove(position.side, position.entryPrice, bar.c);
      const notional = position.sizeUnits * position.entryPrice;
      const leverage = notional / startEquity;
      currentPnl = grossPct * leverage;
    }
    
    // Evaluate
    const result = await strat.evaluatePosition(
      history,
      position ? position.side : null,
      equity,
      position ? position.entryPrice : null,
      currentPnl
    );
    
    const sig = (result && result.signal) || "NONE";
    
    // Handle exits
    if (position && (sig === "CLOSE_LONG" || sig === "CLOSE_SHORT")) {
      let exitPrice = bar.c;
      const reason = result.reason || "signal";
      
      if (reason === "stop-loss" && Number.isFinite(position.stopLoss)) {
        exitPrice = position.stopLoss;
      } else if (reason === "take-profit" && Number.isFinite(position.takeProfit)) {
        exitPrice = position.takeProfit;
      }
      
      const grossPct = pctMove(position.side, position.entryPrice, exitPrice);
      const feePct = strat.roundTripFeePercent();
      const netPct = grossPct - feePct;
      
      const notional = position.sizeUnits * position.entryPrice;
      const leverage = notional / startEquity;
      const realizedPctOfEquity = netPct * leverage;
      const realizedUsd = (realizedPctOfEquity / 100) * startEquity;
      
      equity += realizedUsd;
      
      strat.notifyExit(bar.t, 0, {
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice,
      });
      
      trades.push({
        side: position.side,
        entryTs: position.entryTs,
        exitTs: bar.t,
        entryPrice: position.entryPrice,
        exitPrice,
        reason,
        netPct: +netPct.toFixed(4),
        realizedUsd: +realizedUsd.toFixed(2),
      });
      
      position = null;
    }
    
    // Handle entries
    else if (!position && (sig === "LONG" || sig === "SHORT")) {
      const entryPrice = bar.c;
      const sizeUnits = Number(result.positionSize) || 0;
      
      if (sizeUnits > 0 && Number.isFinite(entryPrice)) {
        position = {
          side: sig,
          entryPrice,
          entryTs: bar.t,
          sizeUnits,
          stopLoss: Number(result.stopLoss),
          takeProfit: Number(result.takeProfit),
        };
      }
    }
    
    // Track drawdown
    if (equity > peakEquity) peakEquity = equity;
    const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }
  
  // Calculate metrics
  const wins = trades.filter(t => t.realizedUsd > 0);
  const losses = trades.filter(t => t.realizedUsd <= 0);
  const grossWin = wins.reduce((s, t) => s + t.realizedUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedUsd, 0));
  const netPnlUsd = equity - startEquity;
  
  // Calculate Sharpe
  const rets = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    if (prev > 0) rets.push((candles[i].c - prev) / prev);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length : 0;
  const stdev = Math.sqrt(variance);
  const barsPerYear = 35040; // 15m bars
  const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(barsPerYear) : 0;
  
  const report = {
    coin,
    candles: candles.length,
    startEquity,
    endEquity: +equity.toFixed(2),
    netPnlUsd: +netPnlUsd.toFixed(2),
    netPnlPct: +((netPnlUsd / startEquity) * 100).toFixed(2),
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: trades.length ? +(wins.length / trades.length).toFixed(3) : 0,
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? Infinity : 0),
    maxDrawdownPct: +maxDrawdownPct.toFixed(2),
    sharpe: +sharpe.toFixed(2),
    trades,
  };
  
  // Print summary
  console.log(`\n📈 RESULTS:`);
  console.log(`  Net PnL: $${report.netPnlUsd.toFixed(2)} (${report.netPnlPct}%)`);
  console.log(`  Total Trades: ${report.totalTrades}`);
  console.log(`  Win Rate: ${(report.winRate * 100).toFixed(1)}%`);
  console.log(`  Profit Factor: ${report.profitFactor}`);
  console.log(`  Max Drawdown: ${report.maxDrawdownPct}%`);
  console.log(`  Sharpe: ${report.sharpe}`);
  
  if (trades.length > 0) {
    console.log(`\n  Last 3 trades:`);
    trades.slice(-3).forEach((t, i) => {
      const emoji = t.realizedUsd > 0 ? '✅' : '❌';
      console.log(`    ${emoji} ${t.side} $${t.realizedUsd.toFixed(2)} | ${t.reason}`);
    });
  }
  
  return report;
}

async function main() {
  console.log('🚀 Multi-Coin Optimal Backtest');
  console.log(`📅 Days: ${daysArg}`);
  console.log(`🎯 Optimal Parameters:`);
  console.log(`   RSI: oversold 25, overbought 75`);
  console.log(`   BB: period 20, stdDev 2`);
  console.log(`   ADX: threshold 25`);
  console.log(`   Mode: reversion`);
  console.log(`   SL: 1.5%, TP: 1.5%`);
  
  const results = [];
  
  for (const coin of COINS) {
    const result = await backtestCoin(coin, daysArg);
    if (result) results.push(result);
  }
  
  // Aggregate report
  console.log(`\n${'='.repeat(70)}`);
  console.log('📊 AGGREGATE SUMMARY');
  console.log('='.repeat(70));
  
  const totalPnl = results.reduce((s, r) => s + r.netPnlUsd, 0);
  const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
  const avgWinRate = results.length ? results.reduce((s, r) => s + r.winRate, 0) / results.length : 0;
  const avgSharpe = results.length ? results.reduce((s, r) => s + r.sharpe, 0) / results.length : 0;
  const maxDD = Math.max(...results.map(r => r.maxDrawdownPct));
  
  console.log(`\n  Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`  Total Trades: ${totalTrades}`);
  console.log(`  Avg Win Rate: ${(avgWinRate * 100).toFixed(1)}%`);
  console.log(`  Avg Sharpe: ${avgSharpe.toFixed(2)}`);
  console.log(`  Max Drawdown (worst): ${maxDD.toFixed(2)}%`);
  
  // Per-coin table
  console.log(`\n  Per-Coin Breakdown:`);
  console.log(`  ${'Coin'.padEnd(6)} ${'PnL ($)'.padStart(10)} ${'Trades'.padStart(8)} ${'Win%'.padStart(8)} ${'PF'.padStart(6)} ${'Sharpe'.padStart(8)} ${'MaxDD%'.padStart(8)}`);
  console.log(`  ${'-'.repeat(60)}`);
  results.forEach(r => {
    const pnlStr = r.netPnlUsd >= 0 ? `+${r.netPnlUsd.toFixed(2)}` : r.netPnlUsd.toFixed(2);
    console.log(`  ${r.coin.padEnd(6)} ${pnlStr.padStart(10)} ${r.totalTrades.toString().padStart(8)} ${(r.winRate*100).toFixed(1).padStart(8)} ${r.profitFactor.toString().padStart(6)} ${r.sharpe.toFixed(2).padStart(8)} ${r.maxDrawdownPct.toFixed(2).padStart(8)}`);
  });
  
  // Save results
  const resultsDir = path.join(__dirname, '..', 'backtest-results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  
  const timestamp = Date.now();
  const filename = `optimal-backtest-${daysArg}d-${timestamp}.json`;
  const filepath = path.join(resultsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify({
    timestamp: new Date().toISOString(),
    days: daysArg,
    coins: COINS,
    aggregate: { totalPnl, totalTrades, avgWinRate, avgSharpe, maxDD },
    results
  }, null, 2));
  
  console.log(`\n💾 Results saved to: ${filepath}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
