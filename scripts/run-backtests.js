const { loadCandles } = require('../src/utils/dataManager');
const { backtestBbrsi } = require('../src/strategy/backtestBbrsi');

async function runBacktest(coin, days) {
    console.log(`\n=== ${coin} ${days}-Day Backtest ===`);
    const candles = loadCandles(coin, '15m');
    const subset = candles.slice(-days * 96);
    console.log(`Using ${subset.length} candles (~${(subset.length/96).toFixed(1)} days)`);
    
    const mockWayfinder = { get90DayCandles: async () => subset };
    const result = await backtestBbrsi(mockWayfinder, { coin, equity: 10000 });
    
    console.log(`TRADES: ${result.totalTrades}`);
    console.log(`NET_PNL: $${result.netPnlUsd} (${result.netPnlPct}%)`);
    console.log(`WIN_RATE: ${(result.winRate * 100).toFixed(1)}%`);
    console.log(`MAX_DD: ${result.maxDrawdownPct}%`);
    console.log(`SHARPE: ${result.sharpe}`);
    
    if (result.totalTrades > 0) {
        console.log('\nRecent trades:');
        result.trades.slice(-3).forEach((t, i) => {
            console.log(`  ${i+1}. ${t.side} | $${t.realizedUsd} | ${t.reason}`);
        });
    }
}

(async () => {
    console.log('Starting backtests...');
    await runBacktest('BTC', 90);
    await runBacktest('ETH', 90);
    console.log('\n=== BACKTESTS COMPLETE ===');
})();
