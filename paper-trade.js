#!/usr/bin/env node
/**
 * Paper Trading Runner
 * 
 * Starts paper trading with $1,000 using Quant Desk Pipeline
 * Model Router distributes tasks between Claude and Kimi
 */

const QuantDeskPipeline = require('./src/paper-trading/quant-desk');
const SpreadRadar = require('./src/paper-trading/spread-radar');
const ModelRouter = require('../model-router/router');
const winston = require('winston');

// Setup logging
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'paper-trading.log' })
    ]
});

// Model Router for task distribution
const router = new ModelRouter();

// Task routing helper
function routeTask(taskDescription, data = {}) {
    const routing = router.analyze(taskDescription);
    logger.info(`[ROUTER] Task: "${taskDescription}" → ${routing.model.toUpperCase()} (${(routing.confidence * 100).toFixed(0)}%)`);
    return routing.model;
}

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     HYPERLIQUID ALGO BOT - PAPER TRADING MODE              ║');
    console.log('║     Initial Capital: $1,000                                ║');
    console.log('║     Model Routing: ENABLED (Claude ↔ Kimi)               ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Route setup task
    const setupRoute = routeTask('Initialize paper trading engine with Quant Desk Pipeline');
    logger.info(`[${setupRoute.toUpperCase()}] Initializing components...`);

    // Initialize Quant Desk Pipeline
    const quantDesk = new QuantDeskPipeline({
        initialCapital: 1000,
        symbols: ['BTC', 'ETH'],
        checkInterval: 60000, // 1 minute
        maxPositionSize: 0.1,
        maxLeverage: 3,
        logger
    });

    // Initialize Spread Radar
    const spreadRadar = new SpreadRadar({
        symbols: ['BTC', 'ETH', 'SOL', 'HYPE'],
        updateInterval: 30000, // 30 seconds
        logger
    });

    // Route monitoring task
    const monitorRoute = routeTask('Monitor trading performance and generate reports');
    logger.info(`[${monitorRoute.toUpperCase()}] Monitoring will be handled by ${monitorRoute}`);

    // Route data collection task
    const dataRoute = routeTask('Collect market data and prices from Hyperliquid');
    logger.info(`[${dataRoute.toUpperCase()}] Data collection assigned to ${dataRoute}`);

    // Start components
    logger.info('Starting Spread Radar...');
    await spreadRadar.start();

    logger.info('Starting Quant Desk Pipeline...');
    await quantDesk.start();

    console.log('\n📊 Paper Trading Active');
    console.log('   Initial Capital: $1,000');
    console.log('   Mode: DRY RUN (no real money)');
    console.log('   Check Interval: 60 seconds');
    console.log('   Symbols: BTC, ETH');
    console.log('   Model Routing: Active (Claude ↔ Kimi)');
    console.log('\nPress Ctrl+C to stop\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n\nStopping paper trading...');
        
        const stopRoute = routeTask('Generate final performance report and shutdown');
        logger.info(`[${stopRoute.toUpperCase()}] Handling shutdown...`);
        
        await quantDesk.stop();
        await spreadRadar.stop();
        
        // Final summary
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║              PAPER TRADING FINAL SUMMARY                   ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        quantDesk.engine.printPortfolio();
        
        const stats = quantDesk.engine.getStats();
        console.log('Performance Stats:');
        console.log(`  Total Trades: ${stats.tradeCount || 0}`);
        console.log(`  Win Rate: ${stats.winRate?.toFixed(1) || 0}%`);
        console.log(`  Total PnL: $${stats.totalPnl?.toFixed(2) || 0}`);
        console.log(`  Profit Factor: ${stats.profitFactor?.toFixed(2) || 0}`);
        console.log('');
        
        process.exit(0);
    });
}

main().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
});
