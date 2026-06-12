const HybridStrategy = require('./src/strategy/HybridStrategy');
const fs = require('fs');

class HybridBacktester {
    constructor() {
        // Mock Wayfinder for backtesting
        const mockWayfinder = {
            getPrice: (coin) => this.currentPrices[coin] || 0,
            getAvailableMargin: () => this.equity,
            placeLimitOrder: () => ({ status: "ok" }),
            cancelOrder: () => ({ status: "ok" }),
        };

        this.hybrid = new HybridStrategy(console, mockWayfinder);
        this.equity = 10000;
        this.peakEquity = 10000;
        this.maxDrawdown = 0;
        this.equityCurve = [];
        this.currentPrices = {};
        this.positions = new Map(); // coin -> { side, entryPrice, size }
    }

    async runBacktest(coinsData) {
        console.log('\n=== Hybrid Strategy Backtest ===\n');

        const results = {};

        for (const [coin, candles] of Object.entries(coinsData)) {
            this.hybrid.initCoin(coin);
            this.equity = 10000;
            this.peakEquity = 10000;
            this.maxDrawdown = 0;
            this.equityCurve = [];
            this.positions.clear();

            for (let i = 50; i < candles.length; i++) {
                const candle = candles[i];
                this.currentPrices[coin] = candle.c;

                const window = candles.slice(Math.max(0, i - 80), i + 1);

                // Run hybrid strategy
                await this.hybrid.update(coin, candle.c, window);

                // Update equity based on open positions
                this._updateEquity(coin, candle);

                // Record equity curve
                this.equityCurve.push({
                    timestamp: candle.t,
                    equity: this.equity,
                    regime: this.hybrid.getStatus(coin)?.currentRegime,
                    activeStrategy: this.hybrid.getStatus(coin)?.activeStrategy
                });

                // Track drawdown
                if (this.equity > this.peakEquity) this.peakEquity = this.equity;
                const drawdown = ((this.peakEquity - this.equity) / this.peakEquity) * 100;
                if (drawdown > this.maxDrawdown) this.maxDrawdown = drawdown;
            }

            results[coin] = {
                finalEquity: this.equity.toFixed(2),
                totalReturn: (((this.equity - 10000) / 10000) * 100).toFixed(2) + '%',
                maxDrawdown: this.maxDrawdown.toFixed(2) + '%',
                equityCurve: this.equityCurve
            };

            console.log(`\n${coin} Results:`);
            console.log(`  Final Equity : $${this.equity.toFixed(2)}`);
            console.log(`  Total Return : ${results[coin].totalReturn}`);
            console.log(`  Max Drawdown : ${results[coin].maxDrawdown}`);
        }

        // Save results
        fs.writeFileSync('hybrid-backtest-results.json', JSON.stringify(results, null, 2));
        console.log('\n✅ Backtest results saved to hybrid-backtest-results.json');

        return results;
    }

    // Basic position & PnL tracking
    _updateEquity(coin, candle) {
        const pos = this.positions.get(coin);
        if (!pos) return;

        const priceChange = (candle.c - pos.entryPrice) / pos.entryPrice;
        let unrealizedPnL = 0;

        if (pos.side === 'LONG') {
            unrealizedPnL = priceChange * pos.size * 100; // simplified
        } else if (pos.side === 'SHORT') {
            unrealizedPnL = -priceChange * pos.size * 100;
        }

        // For now we just track unrealized. In a real backtester you'd also handle realized PnL on exits.
        this.equity = 10000 + unrealizedPnL; // simplified for demo
    }

    // Helper: Manually record a position (can be called from strategy hooks later)
    recordPosition(coin, side, entryPrice, size) {
        this.positions.set(coin, { side, entryPrice, size });
    }

    closePosition(coin, exitPrice) {
        const pos = this.positions.get(coin);
        if (!pos) return 0;

        let pnl = 0;
        const priceChange = (exitPrice - pos.entryPrice) / pos.entryPrice;

        if (pos.side === 'LONG') pnl = priceChange * pos.size * 100;
        else if (pos.side === 'SHORT') pnl = -priceChange * pos.size * 100;

        this.equity += pnl;
        this.positions.delete(coin);
        return pnl;
    }
}

// ==================== USAGE ====================
async function runHybridBacktest() {
    const backtester = new HybridBacktester();

    try {
        const btcCandles = JSON.parse(fs.readFileSync('./data/btc-15m.json'));
        const ethCandles = JSON.parse(fs.readFileSync('./data/eth-15m.json'));

        await backtester.runBacktest({
            BTC: btcCandles,
            ETH: ethCandles
        });
    } catch (error) {
        console.error('Error running backtest:', error.message);
        console.log('Make sure you have candle data in ./data/ folder');
    }
}

runHybridBacktest();
