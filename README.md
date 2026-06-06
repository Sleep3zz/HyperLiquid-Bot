# HyperLiquidAlgoBot

An advanced algorithmic trading bot for the HyperLiquid DEX, featuring Bollinger Bands + RSI + ADX strategy, comprehensive backtesting framework, and machine learning optimization capabilities.

## Features

### 🎯 Trading Strategies
- **BBRSI Strategy**: Bollinger Bands + RSI + ADX combined
  - Long: RSI < 30 + Price < Lower Band + ADX > 25
  - Short: RSI > 70 + Price > Upper Band + ADX > 25
- **ML-Enhanced Strategy**: XGBoost/Random Forest optimized parameters

### 📊 Backtesting System
- **Multi-Symbol Testing**: BTC, ETH, SOL, HYPE, ARB, OP, LINK, AVAX, NEAR, UNI
- **Multiple Timeframes**: 1m, 15m, 1h, 4h
- **Performance Metrics**: Sharpe ratio, max drawdown, win rate, profit factor
- **ML Optimization**: Automated parameter tuning

### 🎮 Paper Trading
- **Virtual Portfolio**: $1,000 initial capital
- **Real-time Simulation**: Test strategies without real money
- **Risk Management**: 2% stop-loss, 3% take-profit, max 3 positions

### 📈 Visualization
- Equity curve charts
- Trade performance analysis
- Drawdown visualization
- Interactive HTML reports

## Quick Start

### Installation
```bash
npm install
pip install numpy pandas scikit-learn xgboost shap matplotlib
```

### Configuration
Create `.env`:
```bash
PRIVATE_KEY=your_hyperliquid_private_key
```

### Run Backtest
```bash
# Single market
node src/backtesting/run.js --market BTC-PERP --timeframe 15m

# With ML optimization
node src/backtesting/run.js --market BTC-PERP --use-ml

# Top 10 coins
node top10-backtest.js
```

### Paper Trading
```bash
node paper-trade.js
```

## Project Structure

```
HyperLiquidAlgoBot/
├── config/
│   ├── default.json          # Trading settings
│   └── backtest.json         # Backtest configuration
├── src/
│   ├── backtesting/
│   │   ├── Backtester.js     # Core backtest engine
│   │   ├── ml_optimizer.js   # ML optimization
│   │   └── run.js            # Backtest runner
│   ├── strategy/
│   │   ├── BBRSIStrategy.js  # Main strategy
│   │   └── indicators/       # Technical indicators
│   └── hyperliquid/          # Exchange integration
├── paper-trade.js            # Paper trading entry
└── top10-backtest.js         # Multi-coin backtest
```

## Backtesting

### Performance Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| Total Return | Overall P&L | > 0% |
| Win Rate | % winning trades | > 50% |
| Profit Factor | Gross profit / loss | > 1.5 |
| Max Drawdown | Largest peak-to-trough | < 20% |
| Sharpe Ratio | Risk-adjusted return | > 1.0 |

### ML Optimization
```bash
# Train model for BTC-PERP 15m
node src/backtesting/ml_optimize.js --market BTC-PERP --timeframe 15m --model xgboost

# Use optimized model in backtest
node src/backtesting/run.js --market BTC-PERP --use-ml
```

## Risk Management

- **Max Position Size**: 10% of portfolio
- **Max Leverage**: 3x
- **Stop Loss**: 2% from entry
- **Take Profit**: 3% from entry
- **Max Concurrent Positions**: 3
- **Max Daily Loss**: $50 (5%)

## Workflow

```
Backtest → Optimize (ML) → Paper Trade → Live Trade
```

## Strategy Ideas / Backlog

See [GitHub Issues](../../issues) for:
- Strategy enhancements
- Bug reports
- Risk management improvements
- Feature requests

## License

MIT

## Disclaimer

This bot is for educational purposes. Cryptocurrency trading carries significant risks. Always test thoroughly before using real funds.
