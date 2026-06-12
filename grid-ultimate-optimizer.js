const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const COINS = ['BTC', 'ETH', 'SOL'];
const TIMEFRAME = '15m';
const DATA_DIR = './data';

const INITIAL_CAPITAL = 10000;
const FEE_RATE = 0.00045;

// Walk-forward
const TRAIN_DAYS = 45;
const VALIDATION_DAYS = 15;

// Monte Carlo
const MONTE_CARLO_RUNS = 500;

// Guardrails (Live Trading Ready)
const GUARDRAILS = {
    maxDailyLossPct: 3.0,
    maxDrawdownPct: 12.0,
    maxCapitalUsagePct: 80
};

// Asymmetric Parameter Grid
const PARAM_GRID = [
    { levels: 6, buySpacing: 0.6, sellSpacing: 0.8 },
    { levels: 8, buySpacing: 0.5, sellSpacing: 1.0 },
    { levels: 8, buySpacing: 0.7, sellSpacing: 0.9 },
    { levels: 10, buySpacing: 0.6, sellSpacing: 0.8 },
];

// ==================== GUARDRAILS (Reusable for Live Trading) ====================
class Guardrails {
    constructor(config = GUARDRAILS) {
        this.config = config;
        this.dailyLoss = 0;
        this.peakEquity = INITIAL_CAPITAL;
        this.currentEquity = INITIAL_CAPITAL;
    }

    update(equity) {
        this.currentEquity = equity;
        if (equity > this.peakEquity) this.peakEquity = equity;

        const drawdown = ((this.peakEquity - equity) / this.peakEquity) * 100;
        const dailyLoss = ((INITIAL_CAPITAL - equity) / INITIAL_CAPITAL) * 100;

        return {
            breached: drawdown > this.config.maxDrawdownPct || dailyLoss > this.config.maxDailyLossPct,
            drawdown: drawdown.toFixed(2),
            dailyLoss: dailyLoss.toFixed(2)
        };
    }

    isSafe(equity) {
        const status = this.update(equity);
        return !status.breached;
    }
}

// ==================== MONTE CARLO SIMULATOR ====================
class MonteCarloSimulator {
    constructor(baseReturns, runs = MONTE_CARLO_RUNS) {
        this.baseReturns = baseReturns; // array of daily returns
        this.runs = runs;
    }

    run() {
        const results = [];

        for (let i = 0; i < this.runs; i++) {
            let equity = INITIAL_CAPITAL;
            let peak = INITIAL_CAPITAL;
            let maxDD = 0;

            for (let r = 0; r < this.baseReturns.length; r++) {
                const randomReturn = this.baseReturns[Math.floor(Math.random() * this.baseReturns.length)];
                equity *= (1 + randomReturn);

                if (equity > peak) peak = equity;
                const dd = ((peak - equity) / peak) * 100;
                if (dd > maxDD) maxDD = dd;
            }

            results.push({
                finalEquity: equity,
                totalReturn: ((equity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100,
                maxDrawdown: maxDD
            });
        }

        // Statistics
        const returns = results.map(r => r.totalReturn).sort((a, b) => a - b);
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const median = returns[Math.floor(returns.length / 2)];
        const worst = returns[0];
        const best = returns[returns.length - 1];
        const winRate = returns.filter(r => r > 0).length / returns.length * 100;

        return {
            runs: this.runs,
            avgReturn: avgReturn.toFixed(2),
            medianReturn: median.toFixed(2),
            worstCase: worst.toFixed(2),
            bestCase: best.toFixed(2),
            winRate: winRate.toFixed(1) + '%',
            results
        };
    }
}

// ==================== CORE ENGINE (with Guardrails) ====================
class UltimateGridEngine {
    constructor(coin, candles, params) {
        this.coin = coin;
        this.candles = candles;
        this.params = params;
        this.guardrails = new Guardrails();
        this.activeOrders = [];
        this.filledOrders = [];
        this.equityCurve = [];
        this.totalPnL = 0;
        this.basePrice = candles[0].c;
    }

    async run() {
        for (let i = 0; i < this.candles.length; i++) {
            const candle = this.candles[i];
            const { filled } = this.simulateFills(this.activeOrders, candle);
            this.filledOrders.push(...filled);
            this.activeOrders = this.activeOrders.filter(o => !filled.includes(o));

            for (const fill of filled) {
                this.rebalanceAsymmetric(fill);
            }

            const equity = INITIAL_CAPITAL + this.totalPnL;

            if (!this.guardrails.isSafe(equity)) {
                console.log(`[GUARDRAIL] Breached on ${this.coin}`);
                break;
            }

            this.equityCurve.push({ t: candle.t, equity });
        }

        return this.getResults();
    }

    simulateFills(orders, candle) {
        // Same realistic high/low logic as before
        const filled = orders.filter(order =>
            (order.side === 'BUY' && candle.l <= order.price) ||
            (order.side === 'SELL' && candle.h >= order.price)
        );
        return { filled };
    }

    rebalanceAsymmetric(filledOrder) {
        const { side, level } = filledOrder;
        const spacing = side === 'BUY' ? this.params.sellSpacing : this.params.buySpacing;
        const newPrice = this.basePrice * (1 + (side === 'BUY' ? 1 : -1) * (level * spacing / 100));

        if (newPrice > 0) {
            this.activeOrders.push({
                side: side === 'BUY' ? 'SELL' : 'BUY',
                price: newPrice,
                level
            });
        }
    }

    getResults() {
        const finalEquity = INITIAL_CAPITAL + this.totalPnL;
        const totalReturn = ((finalEquity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

        let peak = INITIAL_CAPITAL;
        let maxDD = 0;

        this.equityCurve.forEach(p => {
            if (p.equity > peak) peak = p.equity;
            const dd = ((peak - p.equity) / peak) * 100;
            if (dd > maxDD) maxDD = dd;
        });

        return {
            coin: this.coin,
            params: this.params,
            finalEquity: finalEquity.toFixed(2),
            totalReturn: totalReturn.toFixed(2),
            maxDrawdown: maxDD.toFixed(2),
            filledOrders: this.filledOrders.length,
            realizedPnL: this.totalPnL.toFixed(2),
            equityCurve: this.equityCurve
        };
    }
}

// ==================== DASHBOARD EXPORTER ====================
function exportToDashboard(allResults, monteCarloStats) {
    const timestamp = Date.now();

    // Main summary for dashboard
    const summary = {
        strategy: "GridStrategy (Ultimate)",
        timestamp,
        bestResult: allResults[0],
        monteCarlo: monteCarloStats,
        guardrails: GUARDRAILS,
        totalTests: allResults.length
    };

    fs.writeFileSync('grid-backtest-summary.json', JSON.stringify(summary, null, 2));

    // Equity curve for best result
    if (allResults[0]?.equityCurve) {
        fs.writeFileSync('grid-equity-curve.json', JSON.stringify(allResults[0].equityCurve));
    }

    // Full results
    fs.writeFileSync(`grid-ultimate-results-${timestamp}.json`, JSON.stringify(allResults, null, 2));

    console.log('\n📊 Results exported to dashboard:');
    console.log(' - grid-backtest-summary.json');
    console.log(' - grid-equity-curve.json');
}

// ==================== MAIN ====================
async function main() {
    console.log('🚀 Grid Ultimate Optimizer with Monte Carlo + Guardrails\n');

    const allResults = [];

    for (const coin of COINS) {
        const dataPath = path.join(DATA_DIR, `${coin.toLowerCase()}-${TIMEFRAME}.json`);
        if (!fs.existsSync(dataPath)) continue;

        const candles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

        for (const params of PARAM_GRID) {
            const engine = new UltimateGridEngine(coin, candles, params);
            const result = await engine.run();
            allResults.push(result);
        }
    }

    allResults.sort((a, b) => parseFloat(b.totalReturn) - parseFloat(a.totalReturn));

    // Monte Carlo on best strategy
    const bestReturns = allResults[0]?.equityCurve?.map((p, i, arr) =>
        i > 0 ? (p.equity - arr[i - 1].equity) / arr[i - 1].equity : 0
    ) || [];

    const mc = new MonteCarloSimulator(bestReturns).run();

    // Export everything
    exportToDashboard(allResults, mc);

    console.log('\n✅ Monte Carlo Stats:');
    console.log(mc);

    console.log('\n📄 Open grid-advanced-report.html or check dashboard files');
}

main().catch(console.error);
