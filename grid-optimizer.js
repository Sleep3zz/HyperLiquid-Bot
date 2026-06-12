const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const COINS = ['BTC', 'ETH', 'SOL'];
const TIMEFRAME = '15m';
const DATA_DIR = './data';

const PARAM_GRID = {
    levels: [4, 6, 8, 10],
    spacingPct: [0.5, 0.7, 0.8, 1.0, 1.2]
};

const INITIAL_CAPITAL = 10000;
const FEE_RATE = 0.00045;

// ==================== REALISTIC FILL SIMULATOR ====================
function simulateFills(orders, candle) {
    const filled = [];
    const remaining = [];

    for (const order of orders) {
        let filledThisCandle = false;

        if (order.side === 'BUY' && candle.l <= order.price) {
            filledThisCandle = true;
        }
        if (order.side === 'SELL' && candle.h >= order.price) {
            filledThisCandle = true;
        }

        if (filledThisCandle) {
            filled.push({
                ...order,
                fillPrice: order.price,
                fillTime: candle.t,
                pnl: calculatePnl(order, order.price)
            });
        } else {
            remaining.push(order);
        }
    }

    return { filled, remaining };
}

function calculatePnl(order, fillPrice) {
    // Simplified PnL (you can expand this)
    return order.side === 'BUY' ? 0 : 0; // Placeholder - improve with actual position tracking
}

// ==================== CORE BACKTEST ENGINE ====================
class GridBacktestEngine {
    constructor(coin, candles, params) {
        this.coin = coin;
        this.candles = candles;
        this.params = params;
        this.capital = INITIAL_CAPITAL;
        this.activeOrders = [];
        this.filledOrders = [];
        this.equityCurve = [];
        this.totalPnL = 0;
    }

    async run() {
        let currentOrders = [];

        for (let i = 0; i < this.candles.length; i++) {
            const candle = this.candles[i];

            // Simulate fills using high/low
            const { filled, remaining } = simulateFills(currentOrders, candle);
            this.filledOrders.push(...filled);
            currentOrders = remaining;

            // Rebalance grid on fills
            for (const fill of filled) {
                this.totalPnL += fill.pnl || 0;
                this.rebalanceGrid(fill, currentOrders);
            }

            // Track equity
            const equity = this.capital + this.totalPnL;
            this.equityCurve.push({ t: candle.t, equity });

            // Range check (simplified)
            const movePct = Math.abs((candle.c - this.candles[0].c) / this.candles[0].c) * 100;
            if (movePct > this.params.rangeBoundPct) break;
        }

        return this.getResults();
    }

    rebalanceGrid(filledOrder, currentOrders) {
        // Simple rebalancing logic
        const { side, level } = filledOrder;
        const newLevel = level;

        let newPrice;
        if (side === 'BUY') {
            newPrice = this.candles[0].c * (1 + (newLevel * this.params.spacingPct / 100));
        } else {
            newPrice = this.candles[0].c * (1 - (newLevel * this.params.spacingPct / 100));
        }

        if (newPrice > 0) {
            currentOrders.push({
                side: side === 'BUY' ? 'SELL' : 'BUY',
                price: newPrice,
                level: newLevel
            });
        }
    }

    getResults() {
        const finalEquity = this.capital + this.totalPnL;
        const totalReturn = ((finalEquity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

        let peak = INITIAL_CAPITAL;
        let maxDrawdown = 0;

        this.equityCurve.forEach(point => {
            if (point.equity > peak) peak = point.equity;
            const dd = ((peak - point.equity) / peak) * 100;
            if (dd > maxDrawdown) maxDrawdown = dd;
        });

        return {
            coin: this.coin,
            params: this.params,
            finalEquity: finalEquity.toFixed(2),
            totalReturn: totalReturn.toFixed(2) + '%',
            maxDrawdown: maxDrawdown.toFixed(2) + '%',
            filledOrders: this.filledOrders.length,
            realizedPnL: this.totalPnL.toFixed(2),
            equityCurve: this.equityCurve
        };
    }
}

// ==================== MAIN OPTIMIZER ====================
async function runGridOptimizer() {
    console.log('🚀 Starting Grid Strategy Optimizer...\n');

    const allResults = [];

    for (const coin of COINS) {
        const dataPath = path.join(DATA_DIR, `${coin.toLowerCase()}-${TIMEFRAME}.json`);

        if (!fs.existsSync(dataPath)) {
            console.log(`⚠️ Data not found for ${coin}. Skipping...`);
            continue;
        }

        const candles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        console.log(`\n=== Testing ${coin} (${candles.length} candles) ===`);

        for (const levels of PARAM_GRID.levels) {
            for (const spacing of PARAM_GRID.spacingPct) {
                const params = {
                    levels,
                    spacingPct: spacing,
                    rangeBoundPct: 6.0
                };

                const engine = new GridBacktestEngine(coin, candles, params);
                const result = await engine.run();

                allResults.push(result);

                console.log(
                    `Levels: ${levels} | Spacing: ${spacing}% → Return: ${result.totalReturn} | DD: ${result.maxDrawdown} | Fills: ${result.filledOrders}`
                );
            }
        }
    }

    // Sort by return
    allResults.sort((a, b) => parseFloat(b.totalReturn) - parseFloat(a.totalReturn));

    console.log('\n\n🏆 TOP 10 PARAMETER COMBINATIONS:');
    console.table(allResults.slice(0, 10).map(r => ({
        Coin: r.coin,
        Levels: r.params.levels,
        Spacing: r.params.spacingPct + '%',
        Return: r.totalReturn,
        'Max DD': r.maxDrawdown,
        Fills: r.filledOrders
    })));

    // Save results
    const timestamp = Date.now();
    const resultsPath = `grid-optimization-results-${timestamp}.json`;
    fs.writeFileSync(resultsPath, JSON.stringify(allResults, null, 2));
    console.log(`\n✅ Full results saved to: ${resultsPath}`);

    // Dashboard Integration
    generateDashboardUpdate(allResults, timestamp);

    return allResults;
}

function generateDashboardUpdate(results, timestamp) {
    // Create summary for existing dashboard
    const summary = {
        timestamp,
        strategy: 'GridStrategy',
        bestResult: results[0],
        totalTests: results.length,
        coinsTested: [...new Set(results.map(r => r.coin))]
    };

    fs.writeFileSync('grid-backtest-summary.json', JSON.stringify(summary, null, 2));

    // Optional: Update equity curve for best result
    if (results[0] && results[0].equityCurve) {
        fs.writeFileSync('grid-equity-curve.json', JSON.stringify(results[0].equityCurve));
        console.log('📊 Equity curve saved → grid-equity-curve.json (can be used by dashboard.js)');
    }
}

// Run
runGridOptimizer().catch(console.error);
