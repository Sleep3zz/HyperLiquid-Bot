# HyperLiquidAlgoBot + Wayfinder SDK Integration

Complete integration guide for connecting the HyperLiquidAlgoBot with Wayfinder SDK skills for enhanced perp trading capabilities.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    HyperLiquidAlgoBot                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   BBRSI      │  │   ML Optim   │  │  Backtester  │          │
│  │  Strategy    │  │  (Python)    │  │              │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                  │
│         └─────────────────┴──────────────────┘                  │
│                         │                                       │
│              ┌──────────┴──────────┐                          │
│              │  Wayfinder Bridge   │  ← NEW: Integration Layer │
│              └──────────┬──────────┘                          │
└─────────────────────────┼───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
    ┌─────▼─────┐  ┌──────▼──────┐  ┌────▼────┐
    │ wayfinder │  │  wayfinder  │  │ wayfinder│
    │hyperliquid│  │ strategies  │  │delta-lab │
    └───────────┘  └─────────────┘  └─────────┘
```

## Integration Components

### 1. Wayfinder Bridge Module (New)

Located at: `src/wayfinder/bridge.js`

This module connects the bot's trading signals to Wayfinder SDK execution:

```javascript
const { execSync } = require('child_process');

class WayfinderBridge {
    constructor(config = {}) {
        this.walletLabel = config.walletLabel || 'main';
        this.sdkPath = config.sdkPath || process.env.WAYFINDER_SDK_PATH;
        this.dryRun = config.dryRun || false;
    }

    /**
     * Execute a perp trade via Wayfinder SDK
     */
    async executePerpTrade({ coin, isBuy, size, usdAmount, leverage, orderType = 'market', price, reduceOnly = false }) {
        const isSpot = false;
        
        let cmd = `poetry run wayfinder hyperliquid_execute --action place_order \\
            --wallet_label ${this.walletLabel} \\
            --coin ${coin} \\
            --is_spot ${isSpot} \\
            --is_buy ${isBuy}`;
        
        if (size) {
            cmd += ` --size ${size}`;
        } else if (usdAmount) {
            cmd += ` --usd_amount ${usdAmount} --usd_amount_kind margin --leverage ${leverage}`;
        }
        
        if (orderType === 'limit' && price) {
            cmd += ` --order_type limit --price ${price}`;
        }
        
        if (reduceOnly) {
            cmd += ` --reduce_only`;
        }
        
        if (this.dryRun) {
            console.log('[DRY RUN]', cmd);
            return { status: 'dry_run', command: cmd };
        }
        
        try {
            const result = execSync(cmd, { encoding: 'utf8', cwd: this.sdkPath });
            return JSON.parse(result);
        } catch (error) {
            console.error('Wayfinder trade execution failed:', error);
            throw error;
        }
    }

    /**
     * Get current positions and PnL
     */
    async getPositionState() {
        const cmd = `poetry run wayfinder resource wayfinder://hyperliquid/${this.walletLabel}/state`;
        const result = execSync(cmd, { encoding: 'utf8', cwd: this.sdkPath });
        return JSON.parse(result);
    }

    /**
     * Get real-time funding rates
     */
    async getFundingRates() {
        const cmd = `poetry run wayfinder resource wayfinder://hyperliquid/markets`;
        const result = execSync(cmd, { encoding: 'utf8', cwd: this.sdkPath });
        return JSON.parse(result);
    }

    /**
     * Place stop-loss or take-profit trigger order
     */
    async placeTriggerOrder({ coin, tpsl, triggerPrice, size, isBuy }) {
        const cmd = `poetry run wayfinder hyperliquid_execute --action place_trigger_order \\
            --wallet_label ${this.walletLabel} \\
            --coin ${coin} \\
            --tpsl ${tpsl} \\
            --trigger_price ${triggerPrice} \\
            --size ${size} \\
            --is_buy ${isBuy}`;
        
        const result = execSync(cmd, { encoding: 'utf8', cwd: this.sdkPath });
        return JSON.parse(result);
    }
}

module.exports = WayfinderBridge;
```

### 2. ML Functions for Perp Trading

The bot's ML optimization system (`ml_optimizer.js`) can be leveraged for perp trading:

#### Available ML Models

| Model | Use Case | Best For |
|-------|----------|----------|
| **Random Forest** | Feature importance, parameter optimization | Identifying which indicators matter most |
| **XGBoost** | High-performance prediction | Best accuracy for entry/exit timing |
| **Neural Network** | Complex pattern recognition | Non-linear market regime detection |

#### Technical Indicators as Features

The ML system extracts these features from market data:

```javascript
const technicalIndicators = [
    "rsi",              // RSI value, slope, divergence
    "bollinger_bands",  // Band width, %B, price distance to bands
    "adx",              // ADX value, DI+, DI-
    "macd",             // MACD line, signal, histogram
    "ema",              // Fast/slow EMA, ratio
    "atr",              // ATR value, % of price
    "obv",              // On-balance volume, slope
    "vwap",             // VWAP, price distance
    "price_change"      // Daily/weekly returns, volatility
];
```

#### Optimizable Parameters

```javascript
const parameterRanges = {
    // Indicator parameters
    rsiPeriod: { min: 5, max: 30, step: 1, type: "int" },
    rsiOverbought: { min: 65, max: 85, step: 1, type: "int" },
    rsiOversold: { min: 15, max: 35, step: 1, type: "int" },
    bbPeriod: { min: 10, max: 50, step: 2, type: "int" },
    bbStdDev: { min: 1.5, max: 3.5, step: 0.1, type: "float" },
    adxPeriod: { min: 7, max: 30, step: 1, type: "int" },
    adxThreshold: { min: 15, max: 35, step: 1, type: "int" },
    // Risk management
    leverage: { min: 1, max: 10, step: 1, type: "int" },
    positionSize: { min: 0.05, max: 0.5, step: 0.05, type: "float" },
    profitTarget: { min: 1.1, max: 3.0, step: 0.1, type: "float" }
};
```

### 3. Enhanced Strategy with Delta Lab Data

```javascript
const DeltaLabClient = require('./deltalab-client');

class EnhancedBBRSIStrategy extends BBRSIStrategy {
    constructor(logger, options = {}) {
        super(logger);
        this.deltaLab = new DeltaLabClient();
        this.useFundingData = options.useFundingData || false;
        this.fundingThreshold = options.fundingThreshold || 0.001; // 0.1%
    }

    async evaluatePosition(data) {
        // Get base signal from parent strategy
        const result = await super.evaluatePosition(data);
        
        // Enhance with funding rate data if enabled
        if (this.useFundingData && result.signal !== 'NONE') {
            const fundingData = await this.deltaLab.getFundingRate(this.market);
            
            // Filter signals based on funding rate
            // Avoid going long when funding is very positive (expensive)
            // Avoid going short when funding is very negative (expensive)
            if (result.signal === 'LONG' && fundingData.rate > this.fundingThreshold) {
                this.logger.info(`Filtering LONG signal due to high funding rate: ${fundingData.rate}`);
                result.signal = 'NONE';
                result.filteredReason = 'high_funding';
            } else if (result.signal === 'SHORT' && fundingData.rate < -this.fundingThreshold) {
                this.logger.info(`Filtering SHORT signal due to negative funding rate: ${fundingData.rate}`);
                result.signal = 'NONE';
                result.filteredReason = 'negative_funding';
            }
        }
        
        return result;
    }
}
```

### 4. Delta Lab Client for Market Data

```javascript
const { execSync } = require('child_process');

class DeltaLabClient {
    constructor(config = {}) {
        this.sdkPath = config.sdkPath || process.env.WAYFINDER_SDK_PATH;
    }

    /**
     * Get funding rates for perp symbols
     */
    async getFundingRates(symbol = null) {
        const cmd = `poetry run wayfinder resource wayfinder://hyperliquid/markets`;
        const result = execSync(cmd, { encoding: 'utf8', cwd: this.sdkPath });
        const markets = JSON.parse(result);
        
        if (symbol) {
            return markets.find(m => m.symbol === symbol);
        }
        return markets;
    }

    /**
     * Screen for best funding rate opportunities
     */
    async screenFundingOpportunities(lookbackDays = 7) {
        const cmd = `poetry run wayfinder resource wayfinder://delta-lab/perps?lookback_days=${lookbackDays}`;
        const result = execSync(cmd, { encoding: 'utf8', cwd: this.sdkPath });
        return JSON.parse(result);
    }

    /**
     * Get historical perp data for backtesting
     */
    async getPerpHistory(symbol, timeframe, start, end) {
        const cmd = `poetry run wayfinder resource wayfinder://delta-lab/perps/${symbol}/history?timeframe=${timeframe}&start=${start}&end=${end}`;
        const result = execSync(cmd, { encoding: 'utf8', cwd: this.sdkPath });
        return JSON.parse(result);
    }
}

module.exports = DeltaLabClient;
```

## Synergies with Wayfinder Strategies

### Basis Trading Strategy Integration

The bot's ML can enhance the basis trading strategy:

```javascript
class MLBasisTrading {
    constructor() {
        this.mlOptimizer = new MLOptimizer({
            targetMetric: 'funding_rate_capture',
            modelType: 'xgboost'
        });
    }

    /**
     * Predict optimal basis trade entry/exit using ML
     */
    async predictBasisOpportunity(fundingData) {
        // Features: funding rate trend, volatility, historical capture rates
        const features = this.extractBasisFeatures(fundingData);
        const prediction = await this.mlOptimizer.predict(features);
        
        return {
            shouldEnter: prediction.probability > 0.7,
            expectedCapture: prediction.expectedReturn,
            confidence: prediction.confidence
        };
    }
}
```

## Configuration

### Environment Variables

Create `.env` file in bot root:

```bash
# Hyperliquid credentials (existing)
AGENT_PRIVATE_KEY_TEST=your_key
AGENT_ADDRESS=your_address
NETWORK_TYPE=testnet

# Wayfinder SDK path (new)
WAYFINDER_SDK_PATH=/path/to/wayfinder-sdk
WAYFINDER_WALLET_LABEL=main

# ML Configuration
ML_MODEL_TYPE=xgboost
ML_DATASET_SIZE=1000
ML_TARGET_METRIC=totalProfitLoss

# Trading Configuration
USE_FUNDING_DATA=true
FUNDING_THRESHOLD=0.001
MAX_LEVERAGE=10
RISK_PER_TRADE=0.05
```

### Strategy Configuration

Update `config/default.json`:

```json
{
    "trading": {
        "market": "BTC-PERP",
        "timeframe": "15m",
        "leverage": 5,
        "positionSize": 0.1,
        "profitTarget": 1.5,
        "useWayfinder": true,
        "walletLabel": "main"
    },
    "indicators": {
        "rsi": { "period": 14, "overbought": 75, "oversold": 25 },
        "bollinger": { "period": 20, "stdDev": 2 },
        "adx": { "period": 14, "threshold": 25 }
    },
    "ml": {
        "enabled": true,
        "modelType": "xgboost",
        "retrainInterval": 86400,
        "useFeatureImportance": true
    },
    "risk": {
        "maxLeverage": 10,
        "maxPositionSize": 0.5,
        "fundingThreshold": 0.001,
        "useStopLoss": true,
        "stopLossPct": 2.0
    }
}
```

## Usage Examples

### 1. Run ML-Optimized Backtest

```bash
# Generate dataset and train model
node src/backtesting/ml_optimize.js --market BTC-PERP --timeframe 15m --model xgboost --dataset-size 500

# Run backtest with ML-optimized parameters
node src/backtesting/run.js --config backtest --use-ml --ml-model BTC-PERP_15m_xgboost
```

### 2. Live Trading with Wayfinder

```bash
# Start live trading bot with Wayfinder integration
npm run live -- --use-wayfinder --wallet-label main

# Dry run mode (no real trades)
npm run live -- --use-wayfinder --dry-run
```

### 3. Funding Rate Analysis

```bash
# Get current funding rates
node src/analysis/funding.js --market BTC-PERP

# Screen for opportunities
node src/analysis/funding.js --screen --min-rate 0.001
```

## Additional Skills to Install

### Recommended Skills for Enhanced Trading

```bash
# Install via ClawHub
clawhub install wayfinder-delta-lab    # Market data & funding rates
clawhub install wayfinder-strategies   # Basis trading, yield strategies
clawhub install wayfinder-coding-interface  # Custom script development

# Clone for customization
git clone https://github.com/peterskoett/self-improving-agent.git ~/.openclaw/skills/self-improving-agent
git clone https://github.com/wayfinder/capability-evolver.git ~/.openclaw/skills/capability-evolver
```

### Skill Synergies

| Skill | Integration Point | Benefit |
|-------|------------------|---------|
| **wayfinder-delta-lab** | Market data feed | Historical funding rates, perp screening |
| **wayfinder-strategies** | Basis trading | Delta-neutral funding capture |
| **wayfinder-coding-interface** | Custom adapters | Write custom Python strategies |
| **self-improving-agent** | Learning capture | Log trades, errors, improvements |
| **capability-evolver** | Strategy evolution | Auto-optimize parameters over time |

## Next Steps

1. **Install Wayfinder SDK** and configure credentials
2. **Implement the WayfinderBridge** module for trade execution
3. **Connect ML optimizer** to live funding rate data from Delta Lab
4. **Test in dry-run mode** before live trading
5. **Enable self-improving-agent** to capture learnings from live trades
6. **Run capability-evolver** periodically to evolve strategy parameters

## Repository

**Private GitHub Repo:** https://github.com/Sleep3zz/HyperLiquidAlgoBot

All configurations and integrations should be committed and pushed to this repo.
