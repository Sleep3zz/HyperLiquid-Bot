const EventEmitter = require('events');
const WayfinderCommander = require('../wayfinder/wayfinder-cmds');

/**
 * PaperTradingEngine - Simulates trading without real money
 * 
 * Tracks virtual portfolio, executes mock trades, calculates PnL
 */
class PaperTradingEngine extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.initialCapital = config.initialCapital || 1000;
        this.balance = this.initialCapital;
        this.positions = new Map(); // symbol -> position data
        this.trades = [];
        this.startTime = Date.now();
        
        // Trading fees
        this.makerFee = config.makerFee || 0.0002; // 0.02%
        this.takerFee = config.takerFee || 0.0005; // 0.05%
        
        // Risk limits
        this.maxPositionSize = config.maxPositionSize || 0.1; // 10% of capital per trade
        this.maxLeverage = config.maxLeverage || 5;
        
        this.logger = config.logger || console;
        this.wayfinder = new WayfinderCommander({ logger: this.logger });
    }

    /**
     * Get current price for symbol
     */
    async getPrice(symbol) {
        return this.wayfinder.getPrice(symbol);
    }

    /**
     * Get funding rate for symbol
     */
    async getFundingRate(symbol) {
        return this.wayfinder.getFundingRate(symbol);
    }

    /**
     * Open a position
     */
    async openPosition({ symbol, side, size, leverage = 1, stopLoss, takeProfit }) {
        const price = await this.getPrice(symbol);
        if (!price) {
            throw new Error(`Cannot get price for ${symbol}`);
        }

        // Calculate notional value
        const notional = size * price;
        const margin = notional / leverage;
        
        // Check if we have enough balance
        if (margin > this.balance) {
            throw new Error(`Insufficient balance. Need $${margin.toFixed(2)}, have $${this.balance.toFixed(2)}`);
        }

        // Check position size limit
        if (margin > this.balance * this.maxPositionSize) {
            throw new Error(`Position too large. Max ${(this.maxPositionSize * 100).toFixed(0)}% of balance`);
        }

        // Deduct margin from balance
        this.balance -= margin;

        // Create position
        const position = {
            symbol,
            side, // 'LONG' or 'SHORT'
            size,
            entryPrice: price,
            leverage,
            margin,
            notional,
            stopLoss,
            takeProfit,
            openTime: Date.now(),
            fees: notional * this.takerFee,
            unrealizedPnl: -notional * this.takerFee // Start with fee loss
        };

        this.positions.set(symbol, position);
        
        // Record trade
        this.trades.push({
            type: 'OPEN',
            symbol,
            side,
            size,
            price,
            leverage,
            margin,
            fee: position.fees,
            timestamp: Date.now()
        });

        this.emit('positionOpened', position);
        
        this.logger.info(`[PAPER] Opened ${side} ${size} ${symbol} @ $${price} (lev: ${ leverage}x)`);
        
        return position;
    }

    /**
     * Close a position
     */
    async closePosition(symbol, closePrice = null) {
        const position = this.positions.get(symbol);
        if (!position) {
            throw new Error(`No position in ${symbol}`);
        }

        const price = closePrice || await this.getPrice(symbol);
        
        // Calculate PnL
        const priceDiff = position.side === 'LONG' 
            ? price - position.entryPrice 
            : position.entryPrice - price;
        
        const pnl = priceDiff * position.size * position.leverage;
        const closeFee = position.notional * this.takerFee;
        const netPnl = pnl - position.fees - closeFee;

        // Return margin + PnL to balance
        this.balance += position.margin + netPnl;

        // Record trade
        this.trades.push({
            type: 'CLOSE',
            symbol,
            side: position.side,
            size: position.size,
            entryPrice: position.entryPrice,
            exitPrice: price,
            pnl: netPnl,
            fees: position.fees + closeFee,
            duration: Date.now() - position.openTime,
            timestamp: Date.now()
        });

        this.emit('positionClosed', { ...position, exitPrice: price, pnl: netPnl });
        
        this.logger.info(`[PAPER] Closed ${position.side} ${position.size} ${symbol} @ $${price} | PnL: $${netPnl.toFixed(2)}`);

        this.positions.delete(symbol);
        
        return { pnl: netPnl, balance: this.balance };
    }

    /**
     * Update unrealized PnL for all positions
     */
    async updatePositions() {
        for (const [symbol, position] of this.positions) {
            const currentPrice = await this.getPrice(symbol);
            if (!currentPrice) continue;

            const priceDiff = position.side === 'LONG'
                ? currentPrice - position.entryPrice
                : position.entryPrice - currentPrice;

            const unrealizedPnl = priceDiff * position.size * position.leverage - position.fees;
            position.unrealizedPnl = unrealizedPnl;
            position.currentPrice = currentPrice;

            // Check stop loss
            if (position.stopLoss) {
                const stopHit = position.side === 'LONG' 
                    ? currentPrice <= position.stopLoss
                    : currentPrice >= position.stopLoss;
                
                if (stopHit) {
                    this.logger.info(`[PAPER] Stop loss hit for ${symbol}`);
                    await this.closePosition(symbol, position.stopLoss);
                    continue;
                }
            }

            // Check take profit
            if (position.takeProfit) {
                const tpHit = position.side === 'LONG'
                    ? currentPrice >= position.takeProfit
                    : currentPrice <= position.takeProfit;
                
                if (tpHit) {
                    this.logger.info(`[PAPER] Take profit hit for ${symbol}`);
                    await this.closePosition(symbol, position.takeProfit);
                }
            }
        }
    }

    /**
     * Get portfolio summary
     */
    getPortfolio() {
        let unrealizedPnl = 0;
        let marginUsed = 0;

        for (const position of this.positions.values()) {
            unrealizedPnl += position.unrealizedPnl || 0;
            marginUsed += position.margin;
        }

        const totalValue = this.balance + marginUsed + unrealizedPnl;
        const totalReturn = ((totalValue - this.initialCapital) / this.initialCapital) * 100;

        return {
            initialCapital: this.initialCapital,
            balance: this.balance,
            marginUsed,
            unrealizedPnl,
            totalValue,
            totalReturn,
            positionCount: this.positions.size,
            tradeCount: this.trades.length,
            positions: Array.from(this.positions.values())
        };
    }

    /**
     * Print portfolio summary
     */
    printPortfolio() {
        const portfolio = this.getPortfolio();
        
        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║        Paper Trading Portfolio ($1,000)        ║');
        console.log('╚════════════════════════════════════════════════╝');
        console.log(`Balance:        $${portfolio.balance.toFixed(2)}`);
        console.log(`Margin Used:    $${portfolio.marginUsed.toFixed(2)}`);
        console.log(`Unrealized PnL: $${portfolio.unrealizedPnl.toFixed(2)}`);
        console.log(`Total Value:    $${portfolio.totalValue.toFixed(2)}`);
        console.log(`Total Return:   ${portfolio.totalReturn.toFixed(2)}%`);
        console.log(`Positions:      ${portfolio.positionCount}`);
        console.log(`Trades:         ${portfolio.tradeCount}`);
        
        if (portfolio.positions.length > 0) {
            console.log('\nOpen Positions:');
            portfolio.positions.forEach(p => {
                console.log(`  ${p.symbol}: ${p.side} ${p.size} @ $${p.entryPrice} | PnL: $${(p.unrealizedPnl || 0).toFixed(2)}`);
            });
        }
        console.log('');
    }

    /**
     * Get trade statistics
     */
    getStats() {
        const closedTrades = this.trades.filter(t => t.type === 'CLOSE');
        
        if (closedTrades.length === 0) {
            return { tradeCount: 0 };
        }

        const winningTrades = closedTrades.filter(t => t.pnl > 0);
        const losingTrades = closedTrades.filter(t => t.pnl <= 0);
        
        const totalPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
        const avgWin = winningTrades.length > 0 
            ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length 
            : 0;
        const avgLoss = losingTrades.length > 0
            ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
            : 0;

        return {
            tradeCount: closedTrades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: (winningTrades.length / closedTrades.length) * 100,
            totalPnl,
            avgWin,
            avgLoss,
            profitFactor: Math.abs(avgWin / avgLoss) || 0
        };
    }

    /**
     * Reset paper trading account
     */
    reset() {
        this.balance = this.initialCapital;
        this.positions.clear();
        this.trades = [];
        this.startTime = Date.now();
        this.logger.info('[PAPER] Account reset to $' + this.initialCapital);
    }
}

module.exports = PaperTradingEngine;
