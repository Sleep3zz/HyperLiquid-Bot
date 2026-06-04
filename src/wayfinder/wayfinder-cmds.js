const { execSync } = require('child_process');
const path = require('path');

/**
 * WayfinderCommander - Pre-built wayfinder commands for HyperLiquidAlgoBot
 * 
 * Provides convenient wrappers for common Wayfinder operations
 */
class WayfinderCommander {
    constructor(config = {}) {
        this.sdkPath = config.sdkPath || process.env.WAYFINDER_SDK_PATH || process.cwd();
        this.walletLabel = config.walletLabel || process.env.WAYFINDER_WALLET_LABEL || 'main';
        this.logger = config.logger || console;
    }

    /**
     * Execute a wayfinder command
     */
    _exec(cmd) {
        try {
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                cwd: this.sdkPath,
                timeout: 30000 
            });
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Command failed:', error.message);
            return null;
        }
    }

    /**
     * Get account state
     */
    getAccountState() {
        return this._exec(`wayfinder resource wayfinder://hyperliquid/${this.walletLabel}/state`);
    }

    /**
     * Get all positions
     */
    getPositions() {
        const state = this.getAccountState();
        return state?.asset_positions || [];
    }

    /**
     * Check if has position in symbol
     */
    hasPosition(symbol) {
        const positions = this.getPositions();
        return positions.some(p => p.coin === symbol);
    }

    /**
     * Get position size
     */
    getPositionSize(symbol) {
        const positions = this.getPositions();
        const position = positions.find(p => p.coin === symbol);
        return position ? parseFloat(position.szi) : 0;
    }

    /**
     * Get unrealized PnL
     */
    getUnrealizedPnl(symbol) {
        const positions = this.getPositions();
        const position = positions.find(p => p.coin === symbol);
        return position ? parseFloat(position.unrealized_pnl) : 0;
    }

    /**
     * Get current price
     */
    getPrice(symbol) {
        const result = this._exec(`wayfinder resource wayfinder://hyperliquid/prices/${symbol}`);
        return result ? parseFloat(result.price) : null;
    }

    /**
     * Get funding rate
     */
    getFundingRate(symbol) {
        const result = this._exec('wayfinder resource wayfinder://hyperliquid/markets');
        if (!Array.isArray(result)) return null;
        const market = result.find(m => m.coin === symbol);
        return market ? market.funding_rate : null;
    }

    /**
     * Get all funding rates
     */
    getAllFundingRates() {
        return this._exec('wayfinder resource wayfinder://hyperliquid/markets');
    }

    /**
     * Get order book
     */
    getOrderBook(symbol, depth = 10) {
        return this._exec(`wayfinder resource wayfinder://hyperliquid/book/${symbol}?depth=${depth}`);
    }

    /**
     * Get available margin
     */
    getAvailableMargin() {
        const state = this.getAccountState();
        return state?.margin_summary?.account_value || 0;
    }

    /**
     * Place market order
     */
    placeMarketOrder({ coin, isBuy, size, usdAmount, leverage }) {
        let cmd = `wayfinder hyperliquid_execute --action place_order --wallet_label ${this.walletLabel} --coin ${coin} --is_spot false --is_buy ${isBuy}`;
        
        if (size) {
            cmd += ` --size ${size}`;
        } else if (usdAmount && leverage) {
            cmd += ` --usd_amount ${usdAmount} --usd_amount_kind margin --leverage ${leverage}`;
        }
        
        return this._exec(cmd);
    }

    /**
     * Place limit order
     */
    placeLimitOrder({ coin, isBuy, size, price }) {
        const cmd = `wayfinder hyperliquid_execute --action place_order --wallet_label ${this.walletLabel} --coin ${coin} --is_spot false --is_buy ${isBuy} --size ${size} --order_type limit --price ${price}`;
        return this._exec(cmd);
    }

    /**
     * Place stop-loss
     */
    placeStopLoss({ coin, triggerPrice, size }) {
        const position = this.getPositionSize(coin);
        const isBuy = position < 0; // If short, buy to close
        
        const cmd = `wayfinder hyperliquid_execute --action place_trigger_order --wallet_label ${this.walletLabel} --coin ${coin} --tpsl sl --trigger_price ${triggerPrice} --size ${size} --is_buy ${isBuy}`;
        return this._exec(cmd);
    }

    /**
     * Place take-profit
     */
    placeTakeProfit({ coin, triggerPrice, size }) {
        const position = this.getPositionSize(coin);
        const isBuy = position < 0; // If short, buy to close
        
        const cmd = `wayfinder hyperliquid_execute --action place_trigger_order --wallet_label ${this.walletLabel} --coin ${coin} --tpsl tp --trigger_price ${triggerPrice} --size ${size} --is_buy ${isBuy}`;
        return this._exec(cmd);
    }

    /**
     * Close position
     */
    closePosition(coin) {
        const size = Math.abs(this.getPositionSize(coin));
        if (size === 0) {
            this.logger.info(`No position in ${coin} to close`);
            return null;
        }
        
        const position = this.getPositionSize(coin);
        const isBuy = position < 0;
        
        return this.placeMarketOrder({
            coin,
            isBuy,
            size
        });
    }

    /**
     * Update leverage
     */
    setLeverage(coin, leverage) {
        const cmd = `wayfinder hyperliquid_execute --action update_leverage --wallet_label ${this.walletLabel} --coin ${coin} --leverage ${leverage}`;
        return this._exec(cmd);
    }

    /**
     * Get summary
     */
    getSummary() {
        const state = this.getAccountState();
        const positions = this.getPositions();
        
        return {
            wallet: this.walletLabel,
            accountValue: state?.margin_summary?.account_value || 0,
            marginUsed: state?.margin_summary?.margin_used || 0,
            availableMargin: state?.margin_summary?.account_value - state?.margin_summary?.margin_used || 0,
            positionCount: positions.length,
            positions: positions.map(p => ({
                coin: p.coin,
                size: parseFloat(p.szi),
                entryPrice: parseFloat(p.entry_px),
                unrealizedPnl: parseFloat(p.unrealized_pnl),
                liquidationPrice: parseFloat(p.liquidation_px)
            }))
        };
    }

    /**
     * Print formatted summary
     */
    printSummary() {
        const summary = this.getSummary();
        
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║      Hyperliquid Account Summary       ║');
        console.log('╚════════════════════════════════════════╝');
        console.log(`Wallet: ${summary.wallet}`);
        console.log(`Account Value: $${summary.accountValue.toFixed(2)}`);
        console.log(`Available Margin: $${summary.availableMargin.toFixed(2)}`);
        console.log(`Margin Used: $${summary.marginUsed.toFixed(2)}`);
        console.log(`Positions: ${summary.positionCount}`);
        
        if (summary.positions.length > 0) {
            console.log('\nOpen Positions:');
            summary.positions.forEach(p => {
                const direction = p.size > 0 ? 'LONG' : 'SHORT';
                console.log(`  ${p.coin}: ${direction} ${Math.abs(p.size)} @ $${p.entryPrice.toFixed(2)} | PnL: $${p.unrealizedPnl.toFixed(2)}`);
            });
        }
        console.log('');
    }
}

// CLI usage
if (require.main === module) {
    const commander = new WayfinderCommander();
    
    const args = process.argv.slice(2);
    const command = args[0];
    
    switch (command) {
        case 'summary':
            commander.printSummary();
            break;
        case 'positions':
            console.log(JSON.stringify(commander.getPositions(), null, 2));
            break;
        case 'price':
            if (args[1]) {
                console.log(`${args[1]}: $${commander.getPrice(args[1])}`);
            } else {
                console.log('Usage: node wayfinder-cmds.js price <symbol>');
            }
            break;
        case 'funding':
            if (args[1]) {
                const rate = commander.getFundingRate(args[1]);
                console.log(`${args[1]} funding: ${(rate * 100).toFixed(4)}%`);
            } else {
                console.log('Usage: node wayfinder-cmds.js funding <symbol>');
            }
            break;
        case 'close':
            if (args[1]) {
                commander.closePosition(args[1]);
            } else {
                console.log('Usage: node wayfinder-cmds.js close <symbol>');
            }
            break;
        default:
            console.log('Wayfinder Commander for HyperLiquidAlgoBot');
            console.log('');
            console.log('Usage: node wayfinder-cmds.js <command>');
            console.log('');
            console.log('Commands:');
            console.log('  summary      Show account summary');
            console.log('  positions    List all positions');
            console.log('  price <sym>  Get price for symbol');
            console.log('  funding <sym> Get funding rate for symbol');
            console.log('  close <sym>  Close position for symbol');
    }
}

module.exports = WayfinderCommander;
