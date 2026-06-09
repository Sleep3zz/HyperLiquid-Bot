#!/usr/bin/env node
/**
 * Parameter Manager - Loads and applies optimal coin configurations
 * 
 * Usage in bot:
 *   const params = ParameterManager.getOptimalParams('BTC');
 *   const allParams = ParameterManager.getAllOptimalParams();
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const OPTIMAL_DIR = path.join(DATA_DIR, 'optimal');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

class ParameterManager {
    constructor() {
        // Ensure directories exist
        [OPTIMAL_DIR, HISTORY_DIR].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    /**
     * Get optimal parameters for a specific coin
     */
    static getOptimalParams(coin) {
        const optimalFile = path.join(OPTIMAL_DIR, `${coin.toUpperCase()}-optimal.json`);
        
        if (!fs.existsSync(optimalFile)) {
            console.warn(`[ParameterManager] No optimal config found for ${coin}, using defaults`);
            return this.getDefaultParams(coin);
        }
        
        try {
            const config = JSON.parse(fs.readFileSync(optimalFile, 'utf8'));
            return {
                coin: config.coin,
                configName: config.recommended,
                ...config.params,
                lastUpdated: config.updatedAt,
                expectedReturn: config.expectedReturn,
                expectedSharpe: config.expectedSharpe
            };
        } catch (err) {
            console.error(`[ParameterManager] Error loading ${coin} config:`, err.message);
            return this.getDefaultParams(coin);
        }
    }

    /**
     * Get optimal parameters for all coins
     */
    static getAllOptimalParams() {
        const configs = {};
        
        if (!fs.existsSync(OPTIMAL_DIR)) {
            return configs;
        }
        
        const files = fs.readdirSync(OPTIMAL_DIR).filter(f => f.endsWith('-optimal.json'));
        
        for (const file of files) {
            const coin = file.replace('-optimal.json', '');
            configs[coin] = this.getOptimalParams(coin);
        }
        
        return configs;
    }

    /**
     * Get default parameters (fallback)
     */
    static getDefaultParams(coin) {
        return {
            coin: coin.toUpperCase(),
            configName: 'Default',
            leverage: 3,
            positionSize: 0.10,
            profitTarget: 1.5,
            stopLoss: 1.0,
            bbPeriod: 20,
            bbStdDev: 2.0,
            rsiPeriod: 14,
            rsiOverbought: 70,
            rsiOversold: 30,
            adxPeriod: 14,
            adxTrendThreshold: 25,
            lastUpdated: null,
            expectedReturn: 0,
            expectedSharpe: 0
        };
    }

    /**
     * Save parameter history for tracking changes over time
     */
    static saveParamHistory(coin, params, metrics) {
        if (!fs.existsSync(HISTORY_DIR)) {
            fs.mkdirSync(HISTORY_DIR, { recursive: true });
        }
        
        const historyFile = path.join(HISTORY_DIR, `${coin.toUpperCase()}-history.json`);
        
        let history = [];
        if (fs.existsSync(historyFile)) {
            history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        }
        
        history.push({
            timestamp: new Date().toISOString(),
            params,
            metrics
        });
        
        // Keep only last 52 weeks
        if (history.length > 52) {
            history = history.slice(-52);
        }
        
        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
        return history;
    }

    /**
     * Get parameter history for a coin
     */
    static getParamHistory(coin) {
        const historyFile = path.join(HISTORY_DIR, `${coin.toUpperCase()}-history.json`);
        
        if (!fs.existsSync(historyFile)) {
            return [];
        }
        
        return JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    }

    /**
     * Compare current params with previous week
     */
    static getParamChanges(coin) {
        const history = this.getParamHistory(coin);
        
        if (history.length < 2) {
            return { hasChanges: false, changes: {} };
        }
        
        const current = history[history.length - 1];
        const previous = history[history.length - 2];
        
        const changes = {};
        const fields = ['leverage', 'positionSize', 'profitTarget', 'stopLoss', 'configName'];
        
        for (const field of fields) {
            if (current.params[field] !== previous.params[field]) {
                changes[field] = {
                    from: previous.params[field],
                    to: current.params[field]
                };
            }
        }
        
        return {
            hasChanges: Object.keys(changes).length > 0,
            changes,
            current,
            previous
        };
    }

    /**
     * Generate bot configuration file
     */
    static generateBotConfig(outputPath = null) {
        const allParams = this.getAllOptimalParams();
        
        const config = {
            generatedAt: new Date().toISOString(),
            coins: allParams,
            summary: {
                totalCoins: Object.keys(allParams).length,
                avgLeverage: Object.values(allParams).reduce((a, b) => a + b.leverage, 0) / Object.keys(allParams).length,
                avgPositionSize: Object.values(allParams).reduce((a, b) => a + b.positionSize, 0) / Object.keys(allParams).length
            }
        };
        
        const configPath = outputPath || path.join(DATA_DIR, 'bot-config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        console.log(`[ParameterManager] Bot config saved: ${configPath}`);
        return config;
    }

    /**
     * Validate that all required coins have configs
     */
    static validateConfigs(requiredCoins) {
        const missing = [];
        const outdated = [];
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        
        for (const coin of requiredCoins) {
            const params = this.getOptimalParams(coin);
            
            if (!params.lastUpdated) {
                missing.push(coin);
            } else {
                const updatedTime = new Date(params.lastUpdated).getTime();
                if (now - updatedTime > oneWeek) {
                    outdated.push({
                        coin,
                        lastUpdated: params.lastUpdated,
                        daysOld: Math.floor((now - updatedTime) / (24 * 60 * 60 * 1000))
                    });
                }
            }
        }
        
        return {
            valid: missing.length === 0 && outdated.length === 0,
            missing,
            outdated,
            total: requiredCoins.length
        };
    }

    /**
     * Get trading recommendation for a coin
     */
    static getRecommendation(coin) {
        const params = this.getOptimalParams(coin);
        const changes = this.getParamChanges(coin);
        
        let recommendation = 'HOLD';
        let confidence = 'medium';
        
        if (params.expectedSharpe > 0.5 && params.expectedReturn > 0) {
            recommendation = 'TRADE';
            confidence = params.expectedSharpe > 1 ? 'high' : 'medium';
        } else if (params.expectedReturn <= 0) {
            recommendation = 'AVOID';
            confidence = 'high';
        }
        
        if (changes.hasChanges && changes.changes.leverage) {
            if (changes.changes.leverage.to > changes.changes.leverage.from) {
                recommendation = params.expectedReturn > 0 ? 'INCREASE' : 'REDUCE_RISK';
            }
        }
        
        return {
            coin,
            recommendation,
            confidence,
            params,
            changes: changes.hasChanges ? changes.changes : null
        };
    }

    /**
     * Display current status of all coins
     */
    static displayStatus(coins = null) {
        const targetCoins = coins || Object.keys(this.getAllOptimalParams());
        
        console.log('\n' + '='.repeat(90));
        console.log('OPTIMAL PARAMETER STATUS');
        console.log('='.repeat(90));
        console.log(`${'Coin'.padEnd(8)} ${'Config'.padEnd(18)} ${'Lev'.padEnd(6)} ${'Pos'.padEnd(8)} ${'TP/SL'.padEnd(12)} ${'Return'.padEnd(12)} ${'Sharpe'.padEnd(10)} ${'Updated'.padEnd(12)}`);
        console.log('-'.repeat(90));
        
        for (const coin of targetCoins) {
            const p = this.getOptimalParams(coin);
            const age = p.lastUpdated 
                ? Math.floor((Date.now() - new Date(p.lastUpdated).getTime()) / (24 * 60 * 60 * 1000))
                : 'N/A';
            
            console.log(
                `${coin.padEnd(8)} ` +
                `${p.configName.padEnd(18)} ` +
                `${p.leverage}x`.padEnd(6) +
                `${(p.positionSize * 100).toFixed(0)}%`.padEnd(8) +
                `${p.profitTarget}/${p.stopLoss}%`.padEnd(12) +
                `${p.expectedReturn >= 0 ? '+' : ''}${p.expectedReturn.toFixed(2)}%`.padEnd(12) +
                `${p.expectedSharpe.toFixed(2)}`.padEnd(10) +
                `${typeof age === 'number' ? age + 'd' : age}`.padEnd(12)
            );
        }
        
        console.log('='.repeat(90) + '\n');
    }
}

// CLI
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    
    switch (command) {
        case 'status':
            ParameterManager.displayStatus();
            break;
        case 'config':
            ParameterManager.generateBotConfig();
            break;
        case 'get':
            const coin = args[1];
            if (coin) {
                console.log(JSON.stringify(ParameterManager.getOptimalParams(coin), null, 2));
            } else {
                console.log(JSON.stringify(ParameterManager.getAllOptimalParams(), null, 2));
            }
            break;
        case 'validate':
            const coins = (args[1] || 'BTC,ETH,SOL,HYPE,ARB,OP,LINK,AVAX,NEAR,UNI').split(',');
            const validation = ParameterManager.validateConfigs(coins);
            console.log(JSON.stringify(validation, null, 2));
            break;
        case 'recommend':
            const recCoin = args[1];
            if (recCoin) {
                console.log(JSON.stringify(ParameterManager.getRecommendation(recCoin), null, 2));
            } else {
                const allCoins = Object.keys(ParameterManager.getAllOptimalParams());
                const recs = allCoins.map(c => ParameterManager.getRecommendation(c));
                console.log(JSON.stringify(recs, null, 2));
            }
            break;
        default:
            console.log('Usage:');
            console.log('  node param-manager.js status          # Show all coin statuses');
            console.log('  node param-manager.js config          # Generate bot-config.json');
            console.log('  node param-manager.js get [COIN]      # Get params for coin (or all)');
            console.log('  node param-manager.js validate [COINS]# Validate configs');
            console.log('  node param-manager.js recommend [COIN]# Get trading recommendation');
    }
}

module.exports = ParameterManager;