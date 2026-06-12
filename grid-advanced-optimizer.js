const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const COINS = ['BTC', 'ETH', 'SOL'];
const TIMEFRAME = '15m';
const DATA_DIR = './data';

const INITIAL_CAPITAL = 10000;
const FEE_RATE = 0.00045;

// Walk-forward settings
const TRAIN_DAYS = 45;
const VALIDATION_DAYS = 15;

// ==================== ASYMMETRIC PARAMETER GRID ====================
const PARAM_GRID = [
    { levels: 6, buySpacing: 0.6, sellSpacing: 0.8 },
    { levels: 6, buySpacing: 0.7, sellSpacing: 0.7 },
    { levels: 8, buySpacing: 0.5, sellSpacing: 1.0 },
    { levels: 8, buySpacing: 0.7, sellSpacing: 0.9 },
    { levels: 10, buySpacing: 0.6, sellSpacing: 0.8 },
    { levels: 8, buySpacing: 0.8, sellSpacing: 0.8 }, // Symmetric baseline
];

// ==================== REALISTIC FILL SIMULATION ====================
function simulateFills(orders, candle) {
    const filled = [];
    const remaining = [];

    for (const order of orders) {
        let isFilled = false;

        if (order.side === 'BUY' && candle.l <= order.price) isFilled = true;
        if (order.side === 'SELL' && candle.h >= order.price) isFilled = true;

        if (isFilled) {
            filled.push({
                ...order,
                fillPrice: order.price,
                fillTime: candle.t
            });
        } else {
            remaining.push(order);
        }
    }
    return { filled, remaining };
}

// ==================== GRID ENGINE WITH ASYMMETRIC SUPPORT ====================
class AsymmetricGridEngine {
    constructor(coin, candles, params) {
        this.coin = coin;
        this.candles = candles;
        this.params = params; // { levels, buySpacing, sellSpacing }
        this.activeOrders = [];
        this.filledOrders = [];
        this.equityCurve = [];
        this.totalPnL = 0;
        this.basePrice = candles[0].c;
    }

    async run() {
        for (let i = 0; i < this.candles.length; i++) {
            const candle = this.candles[i];

            // Simulate realistic fills
            const { filled, remaining } = simulateFills(this.activeOrders, candle);
            this.filledOrders.push(...filled);
            this.activeOrders = remaining;

            // Rebalance on fills (asymmetric)
            for (const fill of filled) {
                this.rebalanceAsymmetric(fill);
            }

            const equity = INITIAL_CAPITAL + this.totalPnL;
            this.equityCurve.push({ t: candle.t, equity });

            // Range bound protection
            const move = Math.abs((candle.c - this.basePrice) / this.basePrice) * 100;
            if (move > 7) break;
        }

        return this.getResults();
    }

    rebalanceAsymmetric(filledOrder) {
        const { side, level } = filledOrder;

        let newPrice;
        if (side === 'BUY') {
            newPrice = this.basePrice * (1 + (level * this.params.sellSpacing / 100));
            this.activeOrders.push({ side: 'SELL', price: newPrice, level });
        } else {
            newPrice = this.basePrice * (1 - (level * this.params.buySpacing / 100));
            this.activeOrders.push({ side: 'BUY', price: newPrice, level });
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

// ==================== WALK-FORWARD OPTIMIZATION ====================
async function walkForwardOptimize(coin, candles) {
    const results = [];

    const trainSize = TRAIN_DAYS * 24 * 4; // 15m candles
    const valSize = VALIDATION_DAYS * 24 * 4;

    for (let start = 0; start + trainSize + valSize < candles.length; start += valSize) {
        const trainCandles = candles.slice(start, start + trainSize);
        const valCandles = candles.slice(start + trainSize, start + trainSize + valSize);

        // Optimize on training window
        let bestParams = null;
        let bestReturn = -Infinity;

        for (const params of PARAM_GRID) {
            const engine = new AsymmetricGridEngine(coin, trainCandles, params);
            const res = await engine.run();

            if (parseFloat(res.totalReturn) > bestReturn) {
                bestReturn = parseFloat(res.totalReturn);
                bestParams = params;
            }
        }

        // Validate on out-of-sample window
        const valEngine = new AsymmetricGridEngine(coin, valCandles, bestParams);
        const valResult = await valEngine.run();

        results.push({
            window: start,
            bestParams,
            trainReturn: bestReturn,
            validationReturn: valResult.totalReturn,
            validationDD: valResult.maxDrawdown
        });
    }

    return results;
}

// ==================== HTML REPORT GENERATOR ====================
function generateHTMLReport(allResults, walkForwardResults) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Grid Strategy Advanced Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f8f9fa; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background: #343a40; color: white; }
        .positive { color: green; font-weight: bold; }
        .negative { color: red; }
        .card { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    </style>
</head>
<body>
    <h1>🚀 Grid Strategy Advanced Optimization Report</h1>
    <p>Generated: ${new Date().toISOString()}</p>

    <div class="card">
        <h2>🏆 Top Performing Configurations</h2>
        <table>
            <tr>
                <th>Coin</th><th>Levels</th><th>Buy Spacing</th><th>Sell Spacing</th>
                <th>Return %</th><th>Max DD %</th><th>Fills</th>
            </tr>
            ${allResults.slice(0, 15).map(r => `
                <tr>
                    <td>${r.coin}</td>
                    <td>${r.params.levels}</td>
                    <td>${r.params.buySpacing}%</td>
                    <td>${r.params.sellSpacing}%</td>
                    <td class="${parseFloat(r.totalReturn) >= 0 ? 'positive' : 'negative'}">${r.totalReturn}%</td>
                    <td>${r.maxDrawdown}%</td>
                    <td>${r.filledOrders}</td>
                </tr>
            `).join('')}
        </table>
    </div>

    <div class="card">
        <h2>📊 Walk-Forward Validation Results</h2>
        <table>
            <tr><th>Window</th><th>Best Params</th><th>Train Return</th><th>Validation Return</th><th>Validation DD</th></tr>
            ${walkForwardResults.map(w => `
                <tr>
                    <td>Window ${w.window}</td>
                    <td>L${w.bestParams.levels} | B${w.bestParams.buySpacing}% / S${w.bestParams.sellSpacing}%</td>
                    <td>${w.trainReturn}%</td>
                    <td class="${parseFloat(w.validationReturn) >= 0 ? 'positive' : 'negative'}">${w.validationReturn}%</td>
                    <td>${w.validationDD}%</td>
                </tr>
            `).join('')}
        </table>
    </div>

    <script>
        // You can add interactive equity curve charts here if needed
        console.log("Report loaded successfully");
    </script>
</body>
</html>`;

    fs.writeFileSync('grid-advanced-report.html', html);
    console.log('\n✅ Visual HTML Report generated: grid-advanced-report.html');
}

// ==================== MAIN RUNNER ====================
async function main() {
    console.log('🚀 Starting Advanced Grid Optimizer with Walk-Forward & Asymmetric Grids...\n');

    const allResults = [];
    const allWalkForward = [];

    for (const coin of COINS) {
        const dataPath = path.join(DATA_DIR, `${coin.toLowerCase()}-${TIMEFRAME}.json`);
        if (!fs.existsSync(dataPath)) continue;

        const candles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        console.log(`\n=== Processing ${coin} ===`);

        // Walk-forward optimization
        const wfResults = await walkForwardOptimize(coin, candles);
        allWalkForward.push(...wfResults);

        // Full parameter search
        for (const params of PARAM_GRID) {
            const engine = new AsymmetricGridEngine(coin, candles, params);
            const result = await engine.run();
            allResults.push(result);
        }
    }

    // Sort results
    allResults.sort((a, b) => parseFloat(b.totalReturn) - parseFloat(a.totalReturn));

    // Generate everything
    generateHTMLReport(allResults, allWalkForward);

    // Save raw data
    fs.writeFileSync('grid-advanced-results.json', JSON.stringify({ allResults, allWalkForward }, null, 2));

    console.log('\n✅ All tasks completed!');
    console.log('📄 Open grid-advanced-report.html in your browser');
}

main().catch(console.error);
