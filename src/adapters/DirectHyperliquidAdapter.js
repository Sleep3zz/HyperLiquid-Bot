#!/usr/bin/env node
/**
 * Direct Hyperliquid Testnet Adapter
 * Bypasses Wayfinder until their adapter is fixed
 */

const https = require('https');

class DirectHyperliquidAdapter {
    constructor(config = {}) {
        this.logger = config.logger || console;
        this.walletAddress = config.walletAddress || process.env.HL_WALLET_ADDRESS;
        this.isTestnet = config.testnet !== false;
        this.baseUrl = this.isTestnet 
            ? 'https://api.hyperliquid-testnet.xyz'
            : 'https://api.hyperliquid.xyz';
    }

    async _post(endpoint, payload) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(payload);
            const options = {
                hostname: new URL(this.baseUrl).hostname,
                path: endpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => responseData += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(responseData));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    async getPrice(coin) {
        try {
            const response = await this._post('/info', { type: 'allMids' });
            const price = response?.find(m => m.coin === coin)?.mid;
            return price ? parseFloat(price) : null;
        } catch (e) {
            this.logger.error(`[HL-Direct] Error getting price: ${e.message}`);
            return null;
        }
    }

    async getPositionSize(coin) {
        if (!this.walletAddress) return 0;
        try {
            const response = await this._post('/info', {
                type: 'clearinghouseState',
                user: this.walletAddress
            });
            const position = response?.assetPositions?.find(p => p.coin === coin);
            return position ? parseFloat(position.szi) : 0;
        } catch (e) {
            this.logger.error(`[HL-Direct] Error getting position: ${e.message}`);
            return 0;
        }
    }

    async getUnrealizedPnl(coin) {
        if (!this.walletAddress) return 0;
        try {
            const response = await this._post('/info', {
                type: 'clearinghouseState',
                user: this.walletAddress
            });
            const position = response?.assetPositions?.find(p => p.coin === coin);
            return position ? parseFloat(position.unrealizedPnl) : 0;
        } catch (e) {
            this.logger.error(`[HL-Direct] Error getting unrealized PnL: ${e.message}`);
            return 0;
        }
    }

    async getOpenOrders(coin) {
        if (!this.walletAddress) return [];
        try {
            const response = await this._post('/info', {
                type: 'openOrders',
                user: this.walletAddress
            };
            return response?.filter(o => o.coin === coin) || [];
        } catch (e) {
            this.logger.error(`[HL-Direct] Error getting open orders: ${e.message}`);
            return [];
        }
    }

    async getUserFills(coin) {
        if (!this.walletAddress) return [];
        try {
            const response = await this._post('/info', {
                type: 'userFills',
                user: this.walletAddress
            });
            return response?.filter(f => f.coin === coin) || [];
        } catch (e) {
            this.logger.error(`[HL-Direct] Error getting fills: ${e.message}`);
            return [];
        }
    }

    // Placeholder - requires private key signing
    async placeLimitOrder({ coin, isBuy, size, price }) {
        this.logger.warn('[HL-Direct] placeLimitOrder requires signed transaction - use Wayfinder or implement signing');
        return null;
    }

    async cancelOrder(coin, oid) {
        this.logger.warn('[HL-Direct] cancelOrder requires signed transaction - use Wayfinder or implement signing');
        return null;
    }

    async closePosition(coin) {
        this.logger.warn('[HL-Direct] closePosition requires signed transaction - use Wayfinder or implement signing');
        return null;
    }
}

module.exports = DirectHyperliquidAdapter;

// Quick test
if (require.main === module) {
    const adapter = new DirectHyperliquidAdapter({
        walletAddress: process.env.HL_WALLET_ADDRESS,
        testnet: true
    });
    
    async function test() {
        console.log('Testing direct Hyperliquid connection...');
        const price = await adapter.getPrice('BTC');
        console.log('BTC Price:', price);
    }
    
    test().catch(console.error);
}
