const WebSocket = require('ws');
const EventEmitter = require('events');

/**
 * HyperliquidWebSocketPriceFeed - Real-time price monitoring
 * 
 * Connects directly to Hyperliquid WebSocket for live prices
 * No dependency on Wayfinder SDK adapters
 */
class HyperliquidWebSocketPriceFeed extends EventEmitter {
    constructor(config = {}) {
        super();
        this.wsUrl = config.wsUrl || 'wss://api.hyperliquid.xyz/ws';
        this.reconnectInterval = config.reconnectInterval || 5000;
        this.heartbeatInterval = config.heartbeatInterval || 30000;
        this.logger = config.logger || console;
        
        this.ws = null;
        this.isConnected = false;
        this.prices = new Map();
        this.subscriptions = new Set();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
    }

    /**
     * Connect to Hyperliquid WebSocket
     */
    connect() {
        this.logger.info('[HL WS] Connecting to Hyperliquid WebSocket...');
        
        try {
            this.ws = new WebSocket(this.wsUrl);
            
            this.ws.on('open', () => this.onOpen());
            this.ws.on('message', (data) => this.onMessage(data));
            this.ws.on('error', (error) => this.onError(error));
            this.ws.on('close', () => this.onClose());
            
        } catch (error) {
            this.logger.error('[HL WS] Connection error:', error.message);
            this.scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket open
     */
    onOpen() {
        this.logger.info('[HL WS] Connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Resubscribe to all symbols
        this.subscriptions.forEach(symbol => this.subscribe(symbol));
        
        this.emit('connected');
    }

    /**
     * Handle incoming messages
     */
    onMessage(data) {
        try {
            const message = JSON.parse(data);
            
            // Handle different message types
            if (message.channel === 'allMids') {
                this.handleAllMids(message.data);
            } else if (message.channel === 'trades') {
                this.handleTrades(message.data);
            } else if (message.channel === 'l2Book') {
                this.handleOrderBook(message.data);
            } else if (message.channel === 'subscriptionResponse') {
                this.logger.info('[HL WS] Subscription confirmed:', message);
            }
        } catch (error) {
            this.logger.error('[HL WS] Message parse error:', error.message);
        }
    }

    /**
     * Handle allMids (mid prices) update
     */
    handleAllMids(data) {
        if (!data || !data.mids) return;
        
        for (const [coin, price] of Object.entries(data.mids)) {
            const oldPrice = this.prices.get(coin);
            const newPrice = parseFloat(price);
            
            this.prices.set(coin, {
                price: newPrice,
                timestamp: Date.now(),
                source: 'websocket'
            });
            
            // Emit price update
            this.emit('price', { coin, price: newPrice, oldPrice: oldPrice?.price });
            
            // Emit significant price changes (>0.5%)
            if (oldPrice && Math.abs(newPrice - oldPrice.price) / oldPrice.price > 0.005) {
                this.emit('priceChange', { 
                    coin, 
                    price: newPrice, 
                    change: ((newPrice - oldPrice.price) / oldPrice.price * 100).toFixed(2) 
                });
            }
        }
    }

    /**
     * Handle trades
     */
    handleTrades(data) {
        if (!Array.isArray(data)) return;
        
        data.forEach(trade => {
            this.emit('trade', {
                coin: trade.coin,
                price: parseFloat(trade.px),
                size: parseFloat(trade.sz),
                side: trade.side,
                time: trade.time
            });
        });
    }

    /**
     * Handle order book
     */
    handleOrderBook(data) {
        if (!data || !data.coin) return;
        
        this.emit('orderbook', {
            coin: data.coin,
            bids: data.levels[0],
            asks: data.levels[1],
            timestamp: Date.now()
        });
    }

    /**
     * Handle errors
     */
    onError(error) {
        this.logger.error('[HL WS] WebSocket error:', error.message);
        this.emit('error', error);
    }

    /**
     * Handle connection close
     */
    onClose() {
        this.logger.warn('[HL WS] Connection closed');
        this.isConnected = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
        this.emit('disconnected');
    }

    /**
     * Subscribe to a coin's price feed
     */
    subscribe(coin) {
        this.subscriptions.add(coin);
        
        if (!this.isConnected) {
            this.logger.info(`[HL WS] Queued subscription for ${coin}`);
            return;
        }
        
        const message = {
            method: 'subscribe',
            subscription: { type: 'allMids' }
        };
        
        this.ws.send(JSON.stringify(message));
        this.logger.info(`[HL WS] Subscribed to ${coin}`);
    }

    /**
     * Unsubscribe from a coin
     */
    unsubscribe(coin) {
        this.subscriptions.delete(coin);
        
        if (!this.isConnected) return;
        
        // Note: Hyperliquid doesn't support individual unsubscribes
        // We just stop tracking it locally
        this.logger.info(`[HL WS] Unsubscribed from ${coin}`);
    }

    /**
     * Get current price for a coin
     */
    getPrice(coin) {
        const data = this.prices.get(coin);
        if (!data) return null;
        
        // Check if price is stale (> 60 seconds)
        if (Date.now() - data.timestamp > 60000) {
            this.logger.warn(`[HL WS] Price for ${coin} is stale`);
            return null;
        }
        
        return data.price;
    }

    /**
     * Get all available prices
     */
    getAllPrices() {
        const result = {};
        for (const [coin, data] of this.prices) {
            if (Date.now() - data.timestamp < 60000) {
                result[coin] = data.price;
            }
        }
        return result;
    }

    /**
     * Start heartbeat to keep connection alive
     */
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected && this.ws) {
                this.ws.send(JSON.stringify({ method: 'ping' }));
            }
        }, this.heartbeatInterval);
    }

    /**
     * Stop heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * Schedule reconnection
     */
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.logger.error('[HL WS] Max reconnection attempts reached');
            this.emit('maxReconnectAttempts');
            return;
        }
        
        this.reconnectAttempts++;
        this.logger.info(`[HL WS] Reconnecting in ${this.reconnectInterval}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => this.connect(), this.reconnectInterval);
    }

    /**
     * Disconnect gracefully
     */
    disconnect() {
        this.logger.info('[HL WS] Disconnecting...');
        this.stopHeartbeat();
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
    }

    /**
     * Check if price is fresh
     */
    isPriceFresh(coin, maxAgeMs = 30000) {
        const data = this.prices.get(coin);
        if (!data) return false;
        return Date.now() - data.timestamp < maxAgeMs;
    }
}

module.exports = HyperliquidWebSocketPriceFeed;
