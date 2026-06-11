#!/usr/bin/env node
/**
 * Grid Strategy Backtest - Find Optimal Grid Configurations
 * 
 * Tests various grid parameters against historical data
 */

const fs = require('fs');
const path = require('path');

class GridBacktest {
    constructor(data, config) {
        this.data = data; // Array of {t, price} candles
        this.config = config;
        this.trades = [];
        this.equity = 10000;
        this.initialEquity = 10000;
        this.position = 0; // Current position size
        this.entryPrice = 0;
        this.gridOrders = []; // Active grid orders
        this.basePrice = null;
        this.totalFees = 0;
    }

    run() {
        const { gridLevels, spacingPct, rangeBoundPct, feeRate = 0.0009 } = this.config;
        
        // Start grid at first price
        this.basePrice = this.data[0].price;
        const gridSpacing = this.basePrice * (spacingPct / 100);
        
        // Initialize grid orders
        for (let i = 1; i <= gridLevels; i++) {
            this.gridOrders.push({
                level: i,
                buyPrice: this.basePrice - (i * gridSpacing),
                sellPrice: this.basePrice + (i * gridSpacing),
                buyFilled: false,
                sellFilled: false
            });
        }

        let rangeBreached = false;

        // Simulate each candle
        for (let i = 0; i < this.data.length; i++) {
            const candle = this.data[i];
            const price = candle.price;

            // Check range bound
            if (!rangeBreached && this.basePrice) {
                const movePct = Math.abs((price - this.basePrice) / this.basePrice) * 100;
                if (movePct >= rangeBoundPct) {
                    rangeBreached = true;
                    this._closeAllPositions(price, feeRate);
                    break;
                }
            }

            // Check grid fills
            this._checkGridFills(price, feeRate);
        }

        // Close any remaining position at final price
        if (this.position !== 0) {
            this._closeAllPositions(this.data[this.data.length - 1].price, feeRate);
        }

        return this._calculateMetrics();
    }

    _checkGridFills(price, feeRate) {
        for (const order of this.gridOrders) {
            // Check if buy order fills (price drops to buy level)
            if (!order.buyFilled && price <= order.buyPrice) {
                // Buy order fills
                const size = this.config.baseAmount / order.buyPrice;
                this.position += size;
                this.entryPrice = this.position > 0 
                    ? ((this.entryPrice * (this.position - size)) + (order.buyPrice * size)) / this.position
                    : order.buyPrice;
                
                const fee = this.config.baseAmount * feeRate;
                this.totalFees += fee;
                this.equity -= fee;
                
                order.buyFilled = true;
                this.trades.push({
                    side: 'BUY',
                    price: order.buyPrice,
                    size: size,
                    fee: fee
                });
            }

            // Check if sell order fills (price rises to sell level)
            if (!order.sellFilled && price >= order.sellPrice) {
                // Sell order fills
                const size = this.config.baseAmount / order.sellPrice;
                this.position -= size;
                
                const fee = this.config.baseAmount * feeRate;
                this.totalFees += fee;
                this.equity -= fee;
                
                // Calculate PnL if we had a position
                if (this.entryPrice > 0) {
                    const pnl = (order.sellPrice - this.entryPrice) * size;
                    this.equity += pnl;
                }
                
                order.sellFilled = true;
                this.trades.push({
                    side: 'SELL',
                    price: order.sellPrice,
                    size: size,
                    fee: fee
                });
            }
        }
    }

    _closeAllPositions(price, feeRate) {
        if (this.position !== 0) {
            const size = Math.abs(this.position);
            const isLong = this.position > 0;
            
            // Calculate PnL
            if (isLong && this.entryPrice > 0) {
                const pnl = (price - this.entryPrice) * size;
                this.equity += pnl;
            } else if (!isLong && this.entryPrice > 0) {
                const pnl = (this.entryPrice - price) * size;
                this.equity += pnl;
            }
            
            // Fee for closing
            const closeValue = size * price;
            const fee = closeValue * feeRate;
            this.totalFees += fee;
            this.equity -= fee;
            
            this.trades.push({
                side: isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT',
                price: price,
                size: size,
                fee: fee
            });
            
            this.position = 0;
        }
    }

    _calculateMetrics() {
        const buys = this.trades.filter(t => t.side === 'BUY');
        const sells = this.trades.filter(t => t.side === 'SELL');
        const completedPairs = Math.min(buys.length, sells.length);
        
        const grossProfit = sells.reduce((sum, t) => {
            const matchingBuy = buys.find(b => !b.used && b.size >= t.size);
            if (matchingBuy) {
                matchingBuy.used = true;
                return sum + ((t.price - matchingBuy.price) * t.size);
            }
            return sum;
        }, 0);

        const netPnL = this.equity - this.initialEquity;
        
        return {
            initialEquity: this.initialEquity,
            finalEquity: this.equity,
            netPnL: netPnL,
            netPnlPct: (netPnL / this.initialEquity) * 100,
            totalTrades: this.trades.length,
            buyOrders: buys.length,
            sellOrders: sells.length,
            completedPairs: completedPairs,
            totalFees: this.totalFees,
            grossProfit: grossProfit,
            config: this.config
        };
    }
}

// Load data for a coin
function loadData(coin) {
    const chartFile = path.join(__dirname, '..', 'data', 'charts', coin, `${coin}-15m-90d.json`);
    
    if (!fs.existsSync(chartFile)) {
        console.log(`❌ No data found for ${coin}`);
        return null;
    }
    
    const chart = JSON.parse(fs.readFileSync(chartFile, 'utf8'));
    return chart.candles.map(c => ({ t: c.t, price: c.c }));
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║     Grid Strategy Backtest - Optimal Configuration Search       ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

const COIN = process.argv[2] || 'BTC';
const data = loadData(COIN);

if (!data) {
    console.log('Exiting - no data available');
    process.exit(1);
}

console.log(`📊 Testing ${COIN} with ${data.length} candles\n`);

const results = [];
let tested = 0;

// Test grid configurations
const gridLevelsOptions = [5, 8, 10, 12];
const spacingOptions = [0.5, 0.8, 1.0, 1.5, 2.0];
const rangeBoundOptions = [3, 5, 7, 10];
const baseAmountOptions = [50, 100, 200];

for (const gridLevels of gridLevelsOptions) {
    for (const spacingPct of spacingOptions) {
        for (const rangeBoundPct of rangeBoundOptions) {
            for (const baseAmount of baseAmountOptions) {
                const config = {
                    gridLevels,
                    spacingPct,
                    rangeBoundPct,
                    baseAmount,
                    feeRate: 0.0009
                };
                
                const backtest = new GridBacktest(data, config);
                const result = backtest.run();
                results.push(result);
                tested++;
            }
        }
    }
}

// Sort by PnL
results.sort((a, b) => b.netPnL - a.netPnL);
const profitable = results.filter(r => r.netPnL > 0);

console.log('='.repeat(80));
console.log(`📈 RESULTS: ${profitable.length} profitable / ${tested} tested`);
console.log('='.repeat(80));

console.log(`\n   ${'Rank'.padStart(4)} ${'Levels'.padStart(7)} ${'Spacing'.padStart(8)} ${'Range%'.padStart(7)} ${'Amount'.padStart(8)} ${'Trades'.padStart(7)} ${'Pairs'.padStart(6)} ${'Fees'.padStart(10)} ${'PnL'.padStart(10)}`);
console.log('   ' + '─'.repeat(80));

profitable.slice(0, 20).forEach((r, i) => {
    const feesStr = `$${r.totalFees.toFixed(2)}`;
    const pnlStr = r.netPnL >= 0 ? `+$${r.netPnL.toFixed(2)}` : `-$${Math.abs(r.netPnL).toFixed(2)}`;
    console.log(`   ${(i+1).toString().padStart(4)} ${r.config.gridLevels.toString().padStart(7)} ${r.config.spacingPct.toString().padStart(8)} ${r.config.rangeBoundPct.toString().padStart(7)} $${r.config.baseAmount.toString().padStart(7)} ${r.totalTrades.toString().padStart(7)} ${r.completedPairs.toString().padStart(6)} ${feesStr.padStart(10)} ${pnlStr.padStart(10)}`);
});

const best = profitable[0];
console.log(`\n🏆 BEST GRID CONFIGURATION FOR ${COIN}:`);
console.log(`   Grid Levels: ${best.config.gridLevels}`);
console.log(`   Spacing: ${best.config.spacingPct}%`);
console.log(`   Range Bound: ${best.config.rangeBoundPct}%`);
console.log(`   Base Amount: $${best.config.baseAmount}`);
console.log(`   Performance: ${best.totalTrades} trades (${best.completedPairs} pairs), +$${best.netPnL.toFixed(2)}`);
console.log(`   Total Fees: $${best.totalFees.toFixed(2)}`);

// Save results
const outDir = path.join(__dirname, '..', 'backtest-results');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const outFile = path.join(outDir, `GRID-${COIN}-optimization-${Date.now()}.json`);
fs.writeFileSync(outFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    coin: COIN,
    candles: data.length,
    totalTested: tested,
    profitableCount: profitable.length,
    bestConfig: best,
    topResults: results.slice(0, 50)
}, null, 2));

console.log(`\n💾 Results saved: ${outFile}`);
console.log('\n✅ Grid backtest complete!');
