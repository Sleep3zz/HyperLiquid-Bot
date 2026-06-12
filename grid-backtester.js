const fs = require('fs');
const path = require('path');
const GridStrategy = require('./src/strategy/GridStrategy');

// Simple historical backtester for GridStrategy
class GridBacktester {
    constructor(config = {}) {
        this.initialCapital = config.initialCapital || 10000;
        this.feeRate = config.feeRate || 0.00045;
        this.capital = this.initialCapital;
        this.trades = [];
        this.equityCurve = [];
    }

    async runBacktest(coin, candles, gridConfig = {}) {
        console.log(`\n=== Grid Backtest: ${coin} ===`);
        console.log(`Candles: ${candles.length} | Period: ${candles[0].t} → ${candles[candles.length - 1].t}`);

        // Create a mock Wayfinder for backtesting
        const mockWayfinder = this._createMockWayfinder(candles);

        const grid = new GridStrategy(console, mockWayfinder);

        // Override config
        Object.assign(grid, {
            gridLevels: gridConfig.levels || 8,
            gridSpacingPct: gridConfig.spacingPct || 0.8,
            baseAmount: gridConfig.baseAmount || 50,
            maxGridCapital: gridConfig.maxGridCapital || 2000,
            rangeBoundPct: gridConfig.rangeBoundPct || 5.0
        });

        // Start grid at first candle price
        const startPrice = candles[0].c;
        await grid.startGrid(coin);

        let totalPnL = 0;
        let maxDrawdown = 0;
        let peak = this.initialCapital;

        for (let i = 1; i < candles.length; i++) {
            const candle = candles[i];
            const price = candle.c;

            // Simulate update
            await grid.update(price);

            // Track equity (simplified)
            const currentEquity = this.capital + totalPnL;
            this.equityCurve.push({ timestamp: candle.t, equity: currentEquity });

            if (currentEquity > peak) peak = currentEquity;
            const drawdown = ((peak - currentEquity) / peak) * 100;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }

        await grid.stopGrid();

        const finalEquity = this.capital + totalPnL;
        const totalReturn = ((finalEquity - this.initialCapital) / this.initialCapital) * 100;

        console.log(`\n=== Backtest Results ===`);
        console.log(`Final Equity: $${finalEquity.toFixed(2)}`);
        console.log(`Total Return: ${totalReturn.toFixed(2)}%`);
        console.log(`Max Drawdown: ${maxDrawdown.toFixed(2)}%`);
        console.log(`Total Trades (fills): ${grid.filledOrders.length}`);
        console.log(`Realized PnL: $${grid.totalPnL.toFixed(2)}`);

        return {
            coin,
            finalEquity,
            totalReturn,
            maxDrawdown,
            filledOrders: grid.filledOrders.length,
            realizedPnL: grid.totalPnL,
            equityCurve: this.equityCurve
        };
    }

    _createMockWayfinder(candles) {
        let index = 0;
        return {
            getPrice: () => candles[Math.min(index++, candles.length - 1)].c,
            placeLimitOrder: ({ coin, isBuy, size, price }) => {
                // Simulate order placement success
                return {
                    status: "ok",
                    effects: [{
                        ok: true,
                        result: {
                            response: {
                                data: {
                                    statuses: [{
                                        resting: { oid: `mock_${Date.now()}_${Math.random()}` }
                                    }]
                                }
                            }
                        }
                    }]
                };
            },
            cancelOrder: () => ({ status: "ok" }),
            closePosition: () => ({ status: "ok" }),
            getPositionSize: () => 0,
            getUnrealizedPnl: () => 0,
            getOpenOrders: () => []
        };
    }
}

// ==================== USAGE EXAMPLE ====================

async function main() {
    // Example: Load candles from JSON (you can use your existing download-data.js output)
    const coin = "BTC";
    const candlesPath = `./data/${coin.toLowerCase()}-15m.json`;

    if (!fs.existsSync(candlesPath)) {
        console.log(`Please generate candle data first. Example command:`);
        console.log(`node download-data.js --coin ${coin} --timeframe 15m --days 90`);
        return;
    }

    const candles = JSON.parse(fs.readFileSync(candlesPath, 'utf8'));

    const backtester = new GridBacktester({
        initialCapital: 10000,
        feeRate: 0.00045
    });

    const result = await backtester.runBacktest(coin, candles, {
        levels: 6,
        spacingPct: 0.7,
        baseAmount: 40,
        rangeBoundPct: 4.5
    });

    // Optional: Save results
    fs.writeFileSync(`grid-backtest-${coin}-${Date.now()}.json`, JSON.stringify(result, null, 2));
    console.log(`\nResults saved to grid-backtest-${coin}-*.json`);
}

main().catch(console.error);
