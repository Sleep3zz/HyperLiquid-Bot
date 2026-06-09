#!/usr/bin/env node
/**
 * Paper Trading Engine
 * 
 * Features:
 * - Uses existing HyperLiquid WebSocket for live price data
 * - Uses WayfinderAgent for historical data (indicators)
 * - Loads optimal parameters from param-manager
 * - Real-time P&L tracking
 * - Trade history logging
 * 
 * Usage: node paper-trader.js --coin BTC [--capital 1000]
 */

const HyperLiquidWebSocket = require('../model-router/src/bridge/hyperliquid-websocket');
const WayfinderAgent = require('../model-router/src/agents/wayfinder-agent');
const ParameterManager = require('./param-manager');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'paper-trading');

class PaperTrader {
    constructor(options = {}) {
        this.coin = (options.coin || 'BTC').toUpperCase();
        this.initialCapital = options.capital || 1000;
        this.equity = this.initialCapital;
        
        // Load optimal params for this coin
        this.params = ParameterManager.getOptimalParams(this.coin);
        
        // Trading state
        this.position = null;
        this.trades = [];
        this.equityHistory = [];
        this.isRunning = false;
        
        // Initialize connections
        this.ws = new HyperLiquidWebSocket();
        this.agent = new WayfinderAgent({ autoConnect: false });
        
        // Candles for indicator calculation
        this.candles = [];
        this.maxCandles = 100; // Keep last 100 candles
        
        // Setup data directory
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        
        this.dataFile = path.join(DATA_DIR, `${this.coin}-paper-trades.json`);
        this.equityFile = path.join(DATA_DIR, `${this.coin}-equity.json`);
        
        // Load existing data if any
        this.loadState();
    }

    loadState() {
        if (fs.existsSync(this.dataFile)) {
            const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            this.trades = data.trades || [];
            this.equity = data.currentEquity || this.initialCapital;
            console.log(`[PAPER TRADER] Loaded ${this.trades.length} historical trades for ${this.coin}`);
        }
        if (fs.existsSync(this.equityFile)) {
            this.equityHistory = JSON.parse(fs.readFileSync(this.equityFile, 'utf8'));
        }
    }

    saveState() {
        const state = {
            coin: this.coin,
            initialCapital: this.initialCapital,
            currentEquity: this.equity,
            position: this.position,
            params: this.params,
            trades: this.trades,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(this.dataFile, JSON.stringify(state, null, 2));
        fs.writeFileSync(this.equityFile, JSON.stringify(this.equityHistory, null, 2));
    }

    async start() {
        console.log(`\n🚀 PAPER TRADER STARTED: ${this.coin}`);
        console.log('='.repeat(60));
        console.log(`Initial Capital: $${this.initialCapital.toFixed(2)}`);
        console.log(`Current Equity:  $${this.equity.toFixed(2)}`);
        console.log(`Config:          ${this.params.configName}`);
        console.log(`Leverage:        ${this.params.leverage}x`);
        console.log(`Position Size:   ${(this.params.positionSize * 100).toFixed(0)}%`);
        console.log(`Profit Target:   ${this.params.profitTarget}%`);
        console.log(`Stop Loss:       ${this.params.stopLoss}%`);
        console.log('='.repeat(60));
        console.log('Waiting for WebSocket connection...\n');

        // Connect WebSocket
        this.ws.connect();
        
        // Wait for connection and initial data
        await this.waitForConnection();
        
        // Fetch initial historical candles
        await this.loadHistoricalCandles();
        
        this.isRunning = true;
        
        // Start main loop
        this.mainLoop();
        
        // Start status reporting
        this.statusLoop();
        
        console.log('✅ Paper trader is running. Press Ctrl+C to stop.\n');
        
        // Save initial state so dashboard can see this trader
        this.saveState();
        console.log(`[PAPER TRADER] ${this.coin} state initialized and saved`);
    }

    async waitForConnection(timeout = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const prices = this.ws.getAllPrices();
            if (prices && prices[this.coin]) {
                console.log(`[PAPER TRADER] WebSocket connected, ${this.coin} price: $${prices[this.coin]}`);
                return true;
            }
            await this.sleep(500);
        }
        throw new Error('WebSocket connection timeout');
    }

    async loadHistoricalCandles() {
        console.log(`[PAPER TRADER] Loading historical candles for ${this.coin}...`);
        const candles = await this.agent.getHistoricalCandles(this.coin, '15m', 100);
        if (candles) {
            this.candles = candles;
            console.log(`[PAPER TRADER] Loaded ${candles.length} candles`);
        }
    }

    async mainLoop() {
        while (this.isRunning) {
            try {
                // Get current price from WebSocket
                const prices = this.ws.getAllPrices();
                if (!prices || !prices[this.coin]) {
                    await this.sleep(1000);
                    continue;
                }
                
                const currentPrice = parseFloat(prices[this.coin]);
                
                // Update candles with current price
                this.updateCandles(currentPrice);
                
                // Check position management
                await this.managePosition(currentPrice);
                
                // Look for new signals
                await this.checkForSignals(currentPrice);
                
                // Record equity
                this.recordEquity(currentPrice);
                
                await this.sleep(1000); // 1 second tick
                
            } catch (err) {
                console.error('[PAPER TRADER] Error in main loop:', err.message);
                await this.sleep(5000);
            }
        }
    }

    updateCandles(currentPrice) {
        const now = Date.now();
        const intervalMs = 15 * 60 * 1000; // 15 minutes
        
        if (this.candles.length === 0) {
            // Create initial candle
            this.candles.push({
                t: now,
                o: currentPrice,
                h: currentPrice,
                l: currentPrice,
                c: currentPrice,
                v: 0
            });
            return;
        }
        
        const lastCandle = this.candles[this.candles.length - 1];
        const timeSinceLastCandle = now - lastCandle.t;
        
        if (timeSinceLastCandle >= intervalMs) {
            // Start new candle
            this.candles.push({
                t: now,
                o: currentPrice,
                h: currentPrice,
                l: currentPrice,
                c: currentPrice,
                v: 0
            });
            
            // Limit array size
            if (this.candles.length > this.maxCandles) {
                this.candles = this.candles.slice(-this.maxCandles);
            }
        } else {
            // Update current candle
            lastCandle.h = Math.max(lastCandle.h, currentPrice);
            lastCandle.l = Math.min(lastCandle.l, currentPrice);
            lastCandle.c = currentPrice;
        }
    }

    async managePosition(currentPrice) {
        if (!this.position) return;
        
        const positionValue = this.initialCapital * this.position.size * this.params.leverage;
        const direction = this.position.type === 'LONG' ? 1 : -1;
        const priceChange = (currentPrice - this.position.entryPrice) / this.position.entryPrice;
        const pnlPercent = priceChange * direction * 100;
        const pnl = positionValue * priceChange * direction;
        
        // Check take profit
        if (pnlPercent >= this.params.profitTarget) {
            await this.closePosition(currentPrice, 'TAKE_PROFIT', pnl);
            return;
        }
        
        // Check stop loss
        if (pnlPercent <= -this.params.stopLoss) {
            await this.closePosition(currentPrice, 'STOP_LOSS', pnl);
            return;
        }
        
        // Update position PnL
        this.position.currentPnL = pnl;
        this.position.currentPnLPercent = pnlPercent;
    }

    async checkForSignals(currentPrice) {
        if (this.position) return; // Already in position
        if (this.candles.length < 50) return; // Need more data
        
        // Calculate indicators
        const signal = this.evaluateStrategy();
        
        if (signal === 'LONG' || signal === 'SHORT') {
            await this.openPosition(signal, currentPrice);
        }
    }

    evaluateStrategy() {
        const closes = this.candles.map(c => c.c);
        const highs = this.candles.map(c => c.h);
        const lows = this.candles.map(c => c.l);
        
        // Calculate Bollinger Bands
        const bb = this.calculateBollinger(closes, this.params.bbPeriod, this.params.bbStdDev);
        
        // Calculate RSI
        const rsi = this.calculateRSI(closes, this.params.rsiPeriod);
        
        // Calculate ADX
        const adx = this.calculateADX(highs, lows, closes, this.params.adxPeriod);
        
        const currentPrice = closes[closes.length - 1];
        const currentRSI = rsi[rsi.length - 1];
        const currentADX = adx[adx.length - 1];
        
        // Long signal
        if (currentPrice < bb.lower && 
            currentRSI < this.params.rsiOversold && 
            currentADX < this.params.adxTrendThreshold) {
            return 'LONG';
        }
        
        // Short signal
        if (currentPrice > bb.upper && 
            currentRSI > this.params.rsiOverbought && 
            currentADX < this.params.adxTrendThreshold) {
            return 'SHORT';
        }
        
        return 'NONE';
    }

    async openPosition(type, price) {
        const size = this.params.positionSize;
        const positionValue = this.initialCapital * size * this.params.leverage;
        
        this.position = {
            type,
            entryPrice: price,
            size,
            leverage: this.params.leverage,
            entryTime: Date.now(),
            positionValue,
            currentPnL: 0,
            currentPnLPercent: 0
        };
        
        console.log(`\n🟢 OPENED ${type} POSITION`);
        console.log(`   Price: $${price.toFixed(2)}`);
        console.log(`   Size: $${positionValue.toFixed(2)} (${(size * 100).toFixed(0)}% x ${this.params.leverage}x)`);
        
        this.saveState();
    }

    async closePosition(price, reason, pnl) {
        if (!this.position) return;
        
        const trade = {
            type: this.position.type,
            entryPrice: this.position.entryPrice,
            exitPrice: price,
            entryTime: this.position.entryTime,
            exitTime: Date.now(),
            size: this.position.size,
            leverage: this.position.leverage,
            pnl,
            pnlPercent: (pnl / (this.initialCapital * this.position.size)) * 100,
            exitReason: reason
        };
        
        this.trades.push(trade);
        this.equity += pnl;
        
        const emoji = pnl >= 0 ? '✅' : '❌';
        console.log(`\n${emoji} CLOSED ${this.position.type} POSITION - ${reason}`);
        console.log(`   Entry: $${this.position.entryPrice.toFixed(2)}`);
        console.log(`   Exit:  $${price.toFixed(2)}`);
        console.log(`   PnL:   $${pnl.toFixed(2)} (${trade.pnlPercent.toFixed(2)}%)`);
        console.log(`   Equity: $${this.equity.toFixed(2)}`);
        
        this.position = null;
        this.saveState();
    }

    recordEquity(price) {
        const unrealizedPnL = this.position ? this.position.currentPnL : 0;
        this.equityHistory.push({
            timestamp: Date.now(),
            price,
            equity: this.equity + unrealizedPnL,
            hasPosition: !!this.position,
            positionType: this.position?.type || null,
            unrealizedPnL
        });
        
        // Limit history size
        if (this.equityHistory.length > 10000) {
            this.equityHistory = this.equityHistory.slice(-5000);
        }
    }

    async statusLoop() {
        while (this.isRunning) {
            this.printStatus();
            await this.sleep(30000); // Every 30 seconds
        }
    }

    printStatus() {
        const totalReturn = ((this.equity - this.initialCapital) / this.initialCapital) * 100;
        const winningTrades = this.trades.filter(t => t.pnl > 0);
        const winRate = this.trades.length > 0 ? (winningTrades.length / this.trades.length) * 100 : 0;
        
        console.log('\n─'.repeat(60));
        console.log(`📊 ${this.coin} PAPER TRADER STATUS`);
        console.log('─'.repeat(60));
        console.log(`Equity:        $${this.equity.toFixed(2)} (${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%)`);
        console.log(`Trades:        ${this.trades.length} (${winRate.toFixed(1)}% win rate)`);
        
        if (this.position) {
            const pnl = this.position.currentPnL;
            console.log(`Position:      ${this.position.type} ($${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)})`);
        } else {
            console.log(`Position:      None`);
        }
        console.log('─'.repeat(60));
    }

    stop() {
        console.log('\n⏹️  Stopping paper trader...');
        this.isRunning = false;
        this.saveState();
        console.log('✅ Paper trader stopped. State saved.');
        process.exit(0);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Indicator calculations
    calculateBollinger(closes, period, stdDev) {
        const sma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
        const squaredDiffs = closes.slice(-period).map(c => Math.pow(c - sma, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
        const stdev = Math.sqrt(variance);
        return { middle: sma, upper: sma + (stdev * stdDev), lower: sma - (stdev * stdDev) };
    }

    calculateRSI(closes, period) {
        const gains = [], losses = [];
        for (let i = 1; i < closes.length; i++) {
            const change = closes[i] - closes[i-1];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? Math.abs(change) : 0);
        }
        const rsi = [];
        let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < gains.length; i++) {
            avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
            avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
            const rs = avgGain / (avgLoss || 0.001);
            rsi.push(100 - (100 / (1 + rs)));
        }
        return rsi;
    }

    calculateADX(highs, lows, closes, period) {
        const tr = [], plusDM = [], minusDM = [];
        for (let i = 1; i < highs.length; i++) {
            tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
            const upMove = highs[i] - highs[i-1];
            const downMove = lows[i-1] - lows[i];
            plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
            minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
        }
        const adx = [];
        let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let plusDI = plusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let minusDI = minusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < tr.length; i++) {
            atr = ((atr * (period - 1)) + tr[i]) / period;
            plusDI = ((plusDI * (period - 1)) + plusDM[i]) / period;
            minusDI = ((minusDI * (period - 1)) + minusDM[i]) / period;
            const plusDIval = (plusDI / atr) * 100;
            const minusDIval = (minusDI / atr) * 100;
            const dx = (Math.abs(plusDIval - minusDIval) / (plusDIval + minusDIval || 0.001)) * 100;
            adx.push(dx);
        }
        return adx.length > 0 ? adx : [25];
    }
}

// CLI
async function main() {
    const args = process.argv.slice(2);
    let coin = 'BTC';
    let capital = 1000;
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--coin' || args[i] === '-c') coin = args[i + 1];
        if (args[i] === '--capital' || args[i] === '-$') capital = parseFloat(args[i + 1]);
    }
    
    const trader = new PaperTrader({ coin, capital });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => trader.stop());
    process.on('SIGTERM', () => trader.stop());
    
    await trader.start();
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = PaperTrader;