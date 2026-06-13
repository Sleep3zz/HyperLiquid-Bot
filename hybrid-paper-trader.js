const HybridStrategy = require('./src/strategy/HybridStrategy');
const DataProvider = require('./src/data/data-provider');
const { writeHybridState } = require('./src/hybrid-state-writer');
const nodemailer = require('nodemailer'); // Optional: npm install nodemailer

// Optional: Socket.io client for real-time dashboard updates
let ioClient;
try {
    const { io } = require('socket.io-client');
    ioClient = io('http://localhost:3456', {
        transports: ['websocket'],
        autoConnect: true
    });
    ioClient.on('connect', () => console.log(`[${coinFromCli}] Connected to dashboard`));
    ioClient.on('connect_error', () => {}); // Silently fail if dashboard not running
} catch (e) {
    // Socket.io-client not installed or dashboard not available
}

// ==================== Prometheus Metrics (Optional) ====================
let client;
try {
    client = require('prom-client');
} catch (e) {
    // prom-client not installed — metrics disabled
    client = null;
}

// ==================== CLI Argument Parsing ====================
const args = process.argv.slice(2);

function getArg(name) {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg ? arg.split('=')[1] : null;
}

function parseJsonArg(name, defaultValue = {}) {
    const raw = getArg(name);
    if (!raw) return defaultValue;
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`Invalid JSON for --${name}, using defaults`);
        return defaultValue;
    }
}

const coinFromCli = getArg('coin') || 'BTC-PERP';
const capitalFromCli = parseFloat(getArg('capital')) || 1000;
const dataDirFromCli = getArg('data-dir') || './data';
const regimeConfigFromCli = parseJsonArg('regime-config', {});
const notificationsFromCli = parseJsonArg('notifications', { enabled: false });

class HybridPaperTrader {
    constructor(coin = 'BTC-PERP', options = {}) {
        this.coin = coin;
        this.logger = options.logger || console;
        this.initialCapital = options.initialCapital || 1000;

        this.config = {
            checkInterval: options.checkInterval || 60000,
            maxLeverage: options.maxLeverage || 5,
            riskPerTrade: options.riskPerTrade || 0.02,
            timeframe: options.timeframe || '15m',
            dailyLossLimit: options.dailyLossLimit || 0.05,
            maxDailySwitches: options.maxDailySwitches || 8,
            autoResumeAfterMinutes: options.autoResumeAfterMinutes || 0,
            // === Notification Config ===
            notifications: {
                enabled: options.notifications?.enabled ?? false,
                email: options.notifications?.email || null, // recipient email
                from: options.notifications?.from || 'alerts@yourdomain.com',
                smtp: options.notifications?.smtp || null, // SMTP config object
            },
            regimeConfig: options.regimeConfig || {}, // NEW: Per-coin regime detection config
            ...options
        };

        this.wayfinder = options.wayfinder;
        this.dataProvider = options.dataProvider || new DataProvider('./data', this.wayfinder);
        this.engine = options.engine;

        this.hybrid = new HybridStrategy(
            this.logger,
            this.wayfinder,
            `./state/${coin.toLowerCase().replace(/-/g, '_')}`,
            this.config.regimeConfig // Pass regime config
        );

        // Circuit breaker state
        this.dailyStartEquity = this.initialCapital;
        this.dailyPnL = 0;
        this.dailySwitches = 0;
        this.lastResetDay = new Date().getUTCDate();
        this.tradingPaused = false;
        this.pauseReason = null;
        this.pauseTimestamp = null;
        this.lastRegime = null;
        this.lastActiveStrategy = null;

        this.isRunning = false;
        this.intervalId = null;

        // Setup email transporter if configured
        this.transporter = null;
        if (this.config.notifications.enabled && this.config.notifications.smtp) {
            this.transporter = nodemailer.createTransport(this.config.notifications.smtp);
        }

        // Metrics tracking
        this.metrics = {
            totalCycles: 0,
            totalSwitches: 0,
            totalErrors: 0,
            lastRegime: null
        };

        // === Prometheus Metrics (simple stub) ===
        this.metricsEnabled = !!client;
        if (this.metricsEnabled) {
            this.registry = new client.Registry();
            client.collectDefaultMetrics({ register: this.registry });

            this.metricRegime = new client.Gauge({
                name: 'hybrid_regime',
                help: 'Current market regime (0=UNKNOWN, 1=RANGING, 2=TRENDING, 3=HIGH_VOL, 4=TRANSITIONING)',
                labelNames: ['coin'],
                registers: [this.registry]
            });

            this.metricDailyPnL = new client.Gauge({
                name: 'hybrid_daily_pnl',
                help: 'Current daily PnL in quote currency',
                labelNames: ['coin'],
                registers: [this.registry]
            });

            this.metricDailySwitches = new client.Counter({
                name: 'hybrid_daily_switches_total',
                help: 'Number of strategy switches today',
                labelNames: ['coin'],
                registers: [this.registry]
            });

            this.metricTradingPaused = new client.Gauge({
                name: 'hybrid_trading_paused',
                help: 'Whether trading is currently paused by circuit breaker (1=true)',
                labelNames: ['coin'],
                registers: [this.registry]
            });

            this.metricCycles = new client.Counter({
                name: 'hybrid_cycles_total',
                help: 'Total number of run cycles',
                labelNames: ['coin'],
                registers: [this.registry]
            });
        }
    }

    /**
     * Convert regime string to numeric value for metrics
     */
    _regimeToNumber(regime) {
        const map = {
            'UNKNOWN': 0,
            'RANGING': 1,
            'TRENDING': 2,
            'HIGH_VOLATILITY': 3,
            'TRANSITIONING': 4
        };
        return map[regime] || 0;
    }

    /**
     * Expose Prometheus metrics (useful for /metrics endpoint)
     */
    async getPrometheusMetrics() {
        if (!this.metricsEnabled) return '# Prometheus metrics disabled (prom-client not installed)\n';
        return this.registry.metrics();
    }

    /**
     * Retry wrapper with exponential backoff
     */
    async _withRetry(fn, maxRetries = 3, baseDelay = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (attempt === maxRetries) throw error;
                const delay = baseDelay * Math.pow(2, attempt - 1);
                this.logger.warn(`[${this.coin}] Retry ${attempt}/${maxRetries} after error: ${error.message}`);
                await new Promise(res => setTimeout(res, delay));
            }
        }
    }

    /**
     * Get current metrics
     */
    getMetrics() {
        return {
            coin: this.coin,
            dailyPnL: this.dailyPnL,
            dailySwitches: this.dailySwitches,
            totalSwitches: this.metrics.totalSwitches,
            tradingPaused: this.tradingPaused,
            pauseReason: this.pauseReason,
            lastRegime: this.lastRegime,
            activeStrategy: this.hybrid?.getStatus(this.coin)?.activeStrategy,
            prometheusEnabled: this.metricsEnabled
        };
    }

    // ==================== NOTIFICATION SYSTEM ====================
    async _sendNotification(subject, message) {
        if (!this.config.notifications.enabled || !this.transporter) {
            this.logger.info(`[Notification] ${subject} - ${message}`);
            return;
        }

        try {
            await this.transporter.sendMail({
                from: this.config.notifications.from,
                to: this.config.notifications.email,
                subject: `[${this.coin}] ${subject}`,
                text: message,
                html: `<pre>${message}</pre>`
            });
            this.logger.info(`[Notification] Email sent: ${subject}`);
        } catch (err) {
            this.logger.error(`Failed to send notification:`, err.message);
        }
    }

    _pauseTrading(reason) {
        this.tradingPaused = true;
        this.pauseReason = reason;
        this.pauseTimestamp = Date.now();

        const message = 
`Circuit Breaker Triggered on ${this.coin}

Reason: ${reason}
Daily PnL: $${this.dailyPnL.toFixed(2)}
Daily Switches: ${this.dailySwitches}
Timestamp: ${new Date().toISOString()}

Trading has been paused.`;

        this.logger.error(`[${this.coin}] CIRCUIT BREAKER: ${reason}`);
        this._sendNotification("Circuit Breaker Triggered", message);
    }

    resumeTrading(reason = "Manual resume") {
        if (!this.tradingPaused) return;

        this.tradingPaused = false;
        this.pauseReason = null;
        this.pauseTimestamp = null;

        const message = `Trading resumed on ${this.coin}\nReason: ${reason}`;
        this.logger.info(`[${this.coin}] Trading RESUMED: ${reason}`);
        this._sendNotification("Trading Resumed", message);
    }

    _resetDailyStatsIfNeeded() {
        const currentDay = new Date().getUTCDate();
        if (currentDay !== this.lastResetDay) {
            this.dailyStartEquity = this._getCurrentEquity();
            this.dailyPnL = 0;
            this.dailySwitches = 0;
            this.tradingPaused = false;
            this.pauseReason = null;
            this.lastResetDay = currentDay;
            this.logger.info(`[${this.coin}] Daily stats reset. Starting equity: $${this.dailyStartEquity.toFixed(2)}`);
        }
    }

    _getCurrentEquity() {
        if (this.engine && typeof this.engine.getPortfolio === 'function') {
            const portfolio = this.engine.getPortfolio();
            return portfolio?.equity || this.initialCapital;
        }
        return this.initialCapital;
    }

    _updateDailyPnL() {
        const currentEquity = this._getCurrentEquity();
        this.dailyPnL = currentEquity - this.dailyStartEquity;
    }

    async fetchOHLCV(symbol, limit = 150) {
        return await this.dataProvider.getCandles(symbol, this.config.timeframe, limit);
    }

    async runCycle() {
        this._resetDailyStatsIfNeeded();
        this._updateDailyPnL();
        this.metrics.totalCycles++;

        if (this.tradingPaused && this.config.autoResumeAfterMinutes > 0) {
            const minutesPaused = (Date.now() - this.pauseTimestamp) / (1000 * 60);
            if (minutesPaused >= this.config.autoResumeAfterMinutes) {
                this.resumeTrading("Auto-resume after timeout");
            }
        }

        if (this.tradingPaused) {
            this.logger.warn(`[${this.coin}] Trading PAUSED (${this.pauseReason})`);
            return;
        }

        try {
            const currentPrice = await this._withRetry(() => this.wayfinder.getPrice(this.coin));
            if (!currentPrice) return;

            const ohlcv = await this._withRetry(() => this.fetchOHLCV(this.coin));
            const currentPosition = this.engine?.getPosition?.(this.coin) || null;

            const result = await this.hybrid.update(this.coin, ohlcv, currentPrice, currentPosition);
            const status = this.hybrid.getStatus(this.coin);

            // Track switches (based on strategy changes, not regime)
            if (result.strategy && result.strategy !== this.lastActiveStrategy) {
                this.dailySwitches++;
                this.metrics.totalSwitches++;
                if (this.metricsEnabled) {
                    this.metricDailySwitches.inc({ coin: this.coin });
                }
                this.lastActiveStrategy = result.strategy;
            }
            this.lastRegime = result.regime;
            this.metrics.lastRegime = result.regime;

            // Update Prometheus metrics
            if (this.metricsEnabled) {
                const regimeValue = this._regimeToNumber(result.regime);
                this.metricRegime.set({ coin: this.coin }, regimeValue);
                this.metricDailyPnL.set({ coin: this.coin }, this.dailyPnL);
                this.metricTradingPaused.set({ coin: this.coin }, this.tradingPaused ? 1 : 0);
                this.metricCycles.inc({ coin: this.coin });
            }

            // Persist hybrid state for dashboard
            writeHybridState(this.coin, {
                regime: result.regime,
                activeStrategy: result.strategy,
                dailySwitches: this.dailySwitches,
                paused: this.tradingPaused,
                pauseReason: this.pauseReason
            });

            // Emit real-time update via WebSocket
            if (ioClient && ioClient.connected) {
                ioClient.emit('hybrid-update', {
                    coin: this.coin,
                    regime: result.regime,
                    activeStrategy: result.strategy,
                    dailySwitches: this.dailySwitches,
                    paused: this.tradingPaused,
                    pauseReason: this.pauseReason
                });
            }

            // === Enhanced Logging with Dynamic Thresholds ===
            let thresholdLog = '';
            if (result.thresholds) {
                thresholdLog = ` | ATR> ${result.thresholds.atrHighVol?.toFixed(2)} | ` +
                    `BB High> ${result.thresholds.bbHighVol?.toFixed(2)} | ` +
                    `BB Range< ${result.thresholds.bbRanging?.toFixed(2)}`;
            }

            this.logger.info(
                `[${this.coin}] ${result.regime} | ${result.strategy || 'N/A'} | ${result.action}` +
                `${thresholdLog} | Paused: ${status?.pauseAggressiveRisk || false} | ` +
                `Daily PnL: $${this.dailyPnL.toFixed(2)} | Switches: ${this.dailySwitches}`
            );

            // === Circuit Breaker Checks ===
            const lossLimit = this.initialCapital * this.config.dailyLossLimit;

            if (this.dailyPnL <= -lossLimit) {
                this._pauseTrading(`Daily loss limit reached ($${this.dailyPnL.toFixed(2)})`);
                return;
            }

            if (this.dailySwitches >= this.config.maxDailySwitches) {
                this._pauseTrading(`Max daily switches reached (${this.dailySwitches})`);
                return;
            }

            // Execute trade
            if (result.action && result.action !== 'HOLD' && result.action !== 'NONE') {
                if (status?.pauseAggressiveRisk && result.strategy === 'GRID') {
                    this.logger.warn(`[${this.coin}] Skipping execution - Grid risk paused`);
                } else {
                    await this.executeHybridSignal(result, currentPrice);
                }
            }

        } catch (err) {
            this.metrics.totalErrors++;
            this.logger.error(`[${this.coin}] Cycle error:`, err.message);
        }
    }

    async executeHybridSignal(result, currentPrice) {
        const { action, strategy } = result;

        let size = 0.01;
        if (strategy === 'GRID') {
            size = (this.initialCapital * 0.04) / currentPrice;
        } else if (strategy === 'BBRSI') {
            size = (this.initialCapital * this.config.riskPerTrade) / currentPrice;
        }

        try {
            if ((action === 'LONG' || action === 'SHORT') && this.engine?.openPosition) {
                await this.engine.openPosition({
                    symbol: this.coin,
                    side: action,
                    size,
                    leverage: this.config.maxLeverage
                });
            } else if (action.startsWith('CLOSE') && this.engine?.closePosition) {
                await this.engine.closePosition(this.coin);
            }
        } catch (err) {
            this.logger.error(`Execution error:`, err.message);
        }
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // === Position Reconciliation on Startup ===
        try {
            const existingPosition = await this.wayfinder.getPosition(this.coin);

            if (existingPosition && Math.abs(existingPosition.size || 0) > 0.0001) {
                this.logger.warn(
                    `[${this.coin}] Found existing position on startup: ` +
                    `${existingPosition.side} ${existingPosition.size} @ ${existingPosition.entryPrice}`
                );

                // Optional: You can decide to close it, keep it, or let the strategy manage it
                // Example: Force close on startup (uncomment if desired)
                // await this.engine?.closePosition?.(this.coin);
            } else {
                this.logger.info(`[${this.coin}] No existing position found on startup`);
            }
        } catch (err) {
            this.logger.error(`[${this.coin}] Failed to reconcile position on startup:`, err.message);
        }

        // Initialize daily equity
        this.dailyStartEquity = this._getCurrentEquity();

        this.logger.info(`[HybridPaperTrader] Starting for ${this.coin}`);
        this.runCycle();

        this.intervalId = setInterval(() => this.runCycle(), this.config.checkInterval);
    }

    async stop() {
        this.isRunning = false;
        if (this.intervalId) clearInterval(this.intervalId);

        try {
            await this.hybrid.shutdown?.();
            if (this.engine?.closeAllPositions) {
                await this.engine.closeAllPositions(); // optional safety
            }
        } catch (err) {
            this.logger.error(`[${this.coin}] Error during shutdown:`, err.message);
        }

        this.logger.info(`[${this.coin}] Stopped cleanly. Final Daily PnL: $${this.dailyPnL.toFixed(2)}`);
    }
}

module.exports = HybridPaperTrader;

// CLI execution
if (require.main === module) {
    // Initialize Wayfinder adapter for paper trading
    const WayfinderAdapter = require('./src/wayfinder/adapter-final');
    const wayfinder = new WayfinderAdapter({ logger: console });

    const trader = new HybridPaperTrader(coinFromCli, {
        initialCapital: capitalFromCli,
        dataProvider: new DataProvider(dataDirFromCli, wayfinder),
        regimeConfig: regimeConfigFromCli,
        notifications: notificationsFromCli,
        wayfinder: wayfinder // Pass wayfinder instance
    });

    trader.start();

    // Optional: HTTP server for Prometheus metrics (disabled by default to avoid port conflicts)
    // Metrics are available via the main dashboard API at /api/traders/:coin
    /*
    const http = require('http');
    const server = http.createServer(async (req, res) => {
        if (req.url === '/metrics') {
            res.setHeader('Content-Type', 'text/plain');
            res.end(await trader.getPrometheusMetrics());
        } else {
            res.end('Hybrid Trader running');
        }
    });

    // Use unique port per coin to avoid conflicts
    const metricsPort = 9090 + (coinFromCli.charCodeAt(0) % 100);
    server.listen(metricsPort, () => {
        console.log(`[Hybrid] Prometheus metrics available at http://localhost:${metricsPort}/metrics`);
    });
    */

    process.on('SIGINT', async () => {
        // server?.close();
        await trader.stop();
        process.exit(0);
    });
}
