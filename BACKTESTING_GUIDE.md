# Backtesting Capabilities Guide

Complete guide to backtesting strategies with HyperLiquidAlgoBot.

## Overview

The bot provides comprehensive backtesting infrastructure using historical candle data.

## Current Capabilities

### Available Data
- **Symbols**: BTC-PERP (available), others (requires download)
- **Timeframes**: 1m, 15m, 1h, 4h
- **Source**: Historical OHLCV candles

### Backtesting Components

#### 1. Backtester Engine (`src/backtesting/Backtester.js`)
Core backtesting engine with:
- Portfolio simulation
- Trade execution tracking
- Performance metrics
- Drawdown analysis
- Sharpe ratio calculation

**Metrics Calculated:**
- Total Return
- Win Rate
- Profit Factor
- Max Drawdown
- Sharpe Ratio
- Average Win/Loss
- Trade Count

#### 2. Multi-Symbol Tester (`src/backtesting/multi_symbol_test.js`)
Test multiple markets simultaneously:
```bash
node src/backtesting/multi_symbol_test.js \
    --markets BTC-PERP,ETH-PERP,SOL-PERP \
    --timeframe 15m \
    --leverage 3 \
    --capital 10000
```

#### 3. ML Optimizer (`src/backtesting/ml_optimizer.js`)
Machine learning parameter optimization:
- Random Forest
- XGBoost
- Neural Networks
- Feature importance analysis

**Usage:**
```bash
node src/backtesting/ml_optimize.js \
    --market BTC-PERP \
    --timeframe 15m \
    --model xgboost \
    --dataset-size 1000
```

#### 4. Risk Manager (`src/backtesting/RiskManager.js`)
Risk management during backtests:
- Position sizing
- Stop-loss / Take-profit
- Drawdown limits
- Leverage checks

### Running Backtests

#### Single Market Backtest
```bash
# Default settings
node src/backtesting/run.js

# Custom settings
node src/backtesting/run.js \
    --market BTC-PERP \
    --timeframe 15m \
    --leverage 5 \
    --position 0.1 \
    --capital 10000

# With ML optimization
node src/backtesting/run.js \
    --market BTC-PERP \
    --use-ml \
    --ml-model BTC-PERP_15m_xgboost
```

#### Top 10 Coins Backtest
```bash
# Backtest top 10 coins by volume
node top10-backtest.js

# With custom settings
node top10-backtest.js --timeframe 15m --leverage 3 --use-ml
```

### Configuration

#### Backtest Profile (`config/backtest.json`)
```json
{
  "trading": {
    "market": "BTC-PERP",
    "timeframe": "15m",
    "leverage": 5,
    "positionSize": 0.1,
    "profitTarget": 1.5,
    "leverageMode": "isolated"
  },
  "backtest": {
    "initialCapital": 10000,
    "tradingFee": 0.001,
    "slippage": 0.001
  }
}
```

### Strategies Available

#### 1. BBRSI Strategy (Default)
- Bollinger Bands (20, 2)
- RSI (14)
- ADX (14)

**Signals:**
- LONG: RSI < 30 + Price < Lower Band + ADX > 25
- SHORT: RSI > 70 + Price > Upper Band + ADX > 25

#### 2. ML-Enhanced Strategy
Uses ML-optimized parameters from trained models.

### Performance Metrics

| Metric | Description | Good Value |
|--------|-------------|------------|
| Total Return | Overall profit/loss | > 0% |
| Win Rate | % of winning trades | > 50% |
| Profit Factor | Gross profit / Gross loss | > 1.5 |
| Max Drawdown | Largest peak-to-trough decline | < 20% |
| Sharpe Ratio | Risk-adjusted return | > 1.0 |
| Average Win | Mean winning trade | > $0 |
| Average Loss | Mean losing trade | < $0 |

### Data Requirements

#### Historical Data Format
```json
[
  {
    "t": 1234567890000,
    "o": 45000.00,
    "h": 45100.00,
    "l": 44900.00,
    "c": 45050.00,
    "v": 100.5
  }
]
```

#### Data Location
```
src/backtesting/data/
├── BTC-PERP/
│   ├── BTC-PERP-1m.json
│   └── BTC-PERP-15m.json
└── [MARKET]/
    └── [MARKET]-[TIMEFRAME].json
```

### Visualization

Generate performance charts:
```bash
node src/backtesting/visualization.js
```

Outputs:
- Equity curve
- Drawdown chart
- Trade distribution
- Monthly returns

### Top 10 Backtest Analysis

The `top10-backtest.js` script provides:
1. **Individual Analysis**: Each coin's performance
2. **Aggregate Metrics**: Combined statistics
3. **Rankings**: Best/worst performers
4. **Claude Analysis**: Automated insights
5. **Recommendations**: Actionable advice

**Output Example:**
```
╔════════════════════════════════════════════════════════════╗
║           TOP 10 BACKTEST RESULTS - CLAUDE                 ║
╚════════════════════════════════════════════════════════════╝

Coin      | Trades | Win Rate | P&L        | Max DD  | Sharpe
BTC-PERP  |    156 |   58.3%  |  $1,234.56 |   12.4% |   1.45
ETH-PERP  |    142 |   55.2%  |    $987.65 |   15.2% |   1.23
...

🏆 TOP PERFORMERS:
  Best P&L: BTC-PERP ($1,234.56)
  Best Sharpe: BTC-PERP (1.45)

💡 RECOMMENDATIONS:
  1. Focus on BTC-PERP - best performing coin
  2. Run ML optimization for ETH-PERP
  3. Reduce leverage to lower drawdown
```

### Best Practices

1. **Use Sufficient Data**: At least 1000 candles
2. **Multiple Timeframes**: Test 15m, 1h, 4h
3. **Walk-Forward**: Train on 70%, test on 30%
4. **Out-of-Sample**: Validate on unseen data
5. **Risk Metrics**: Focus on Sharpe and Drawdown
6. **Transaction Costs**: Include fees and slippage

### Common Issues

**1. No Historical Data**
```bash
# Check available data
ls src/backtesting/data/

# Only BTC-PERP available currently
# Need to download more data
```

**2. ML Model Not Found**
```bash
# Generate ML models first
node src/backtesting/ml_optimize.js --market BTC-PERP --model xgboost
```

**3. Out of Memory**
```bash
# Reduce dataset size
node src/backtesting/run.js --dataset-size 500
```

### Advanced Features

#### 1. Multi-Symbol Correlation
Test portfolio effects across multiple assets.

#### 2. Walk-Forward Analysis
```bash
node src/backtesting/walkforward.js \
    --train-size 0.7 \
    --test-size 0.3 \
    --windows 5
```

#### 3. Monte Carlo Simulation
```bash
node src/backtesting/montecarlo.js \
    --simulations 1000 \
    --confidence 0.95
```

### Integration with Paper Trading

Backtest → Optimize → Paper Trade → Live Trade

```bash
# 1. Backtest
node src/backtesting/run.js --market BTC-PERP

# 2. Optimize with ML
node src/backtesting/ml_optimize.js --market BTC-PERP

# 3. Paper trade
node paper-trade.js

# 4. Live trade (when ready)
DRY_RUN=false node paper-trade.js
```

### Reference

- **Main Script**: `src/backtesting/run.js`
- **Multi-Symbol**: `src/backtesting/multi_symbol_test.js`
- **Top 10**: `top10-backtest.js`
- **ML Optimizer**: `src/backtesting/ml_optimize.js`
- **Visualizer**: `src/backtesting/visualization.js`
