# Hybrid Trading System (Grid + BBRSI)

This is a regime-aware hybrid trading system for Hyperliquid that intelligently switches between:

- **GridStrategy** — Best for ranging / sideways markets
- **BBRSIStrategy** — Best for trending markets

## Architecture

```
HybridPaperTrader
└── HybridStrategy
    ├── RegimeDetector (percentile-based)
    ├── GridStrategy (with dynamic capital)
    └── BBRSIStrategy
```

## Key Features

- **Intelligent Regime Detection** — Uses ADX + rolling percentiles for ATR and Bollinger Band Width
- **Asymmetric Cooldown** — Short cooldown when escaping Grid into a trend (15 min) vs long cooldown entering Grid (3 hours)
- **Global Capital Budget** — Controls allocation between strategies (e.g., 60% max to Grid, 80% max to BBRSI)
- **Circuit Breakers** — Daily loss limit + max switches per day + auto-resume
- **Email Notifications** — Alerts when circuit breakers trigger
- **Position Reconciliation** — Detects open positions on startup
- **Single Heartbeat** — Grid's internal loop is disabled when managed by Hybrid
- **Retry Logic** — Exponential backoff for critical operations
- **Metrics Tracking** — totalCycles, totalSwitches, totalErrors, lastRegime

## Quick Start (Multi-Coin)

```bash
node multi-paper-trader.js
```

This starts hybrid traders for BTC-PERP, ETH-PERP, and SOL-PERP with shared configuration.

## Single Coin Mode

```bash
node hybrid-paper-trader.js --coin=BTC-PERP --capital=2000
```

## Configuration

### Global Config (config/regime.json)

```json
{
  "adx": {
    "trending": 27,
    "ranging": 19
  },
  "atr": {
    "highVolPercentile": 75
  },
  "bbWidth": {
    "highVolPercentile": 72,
    "rangingPercentile": 28
  },
  "detector": {
    "lookback": 120,
    "requiredPersistence": 2,
    "historyLength": 8
  }
}
```

### Per-Coin Overrides (in multi-paper-trader.js)

```javascript
const COINS = [
  {
    symbol: 'BTC-PERP',
    capital: 2000,
    regimeConfig: { adxTrending: 30 } // Override for BTC only
  }
];
```

### Environment Variables

```bash
export WAYFINDER_SDK_PATH=/path/to/wayfinder-sdk
export WAYFINDER_WALLET_LABEL=main
```

## How It Works

### 1. Regime Detection

The system analyzes OHLCV data every cycle:
- **ADX > 27** → TRENDING (use BBRSI)
- **ADX < 19 AND BB Width < percentile** → RANGING (use Grid)
- **ATR or BB Width > percentile** → HIGH_VOLATILITY (HOLD)

### 2. Strategy Switching

When regime changes are confirmed (3 consecutive detections):
1. Stop current strategy cleanly
2. Wait for cooldown (asymmetric: 15 min vs 3 hours)
3. Start new strategy with allocated capital
4. During cooldown, `pauseAggressiveRisk` prevents new Grid entries

### 3. Capital Allocation

```javascript
{
  totalBudget: 10000,
  gridMaxAllocation: 0.6,    // $6000 max for Grid
  bbrsiMaxAllocation: 0.8,   // $8000 max for BBRSI
  minCapitalPerStrategy: 500
}
```

### 4. Circuit Breakers

- **Daily Loss Limit** (default 5%): Pauses trading if daily PnL <= -5%
- **Max Daily Switches** (default 8): Pauses if too many regime changes
- **Auto-Resume** (optional): Automatically resume after N minutes

### 5. Notifications

Configure email alerts in multi-paper-trader.js:

```javascript
notifications: {
  enabled: true,
  email: 'alerts@yourdomain.com',
  from: 'trading@yourdomain.com',
  smtp: { host: 'smtp.gmail.com', port: 587, auth: { user: '...', pass: '...' } }
}
```

## Testing

Run unit tests:
```bash
npm test
```

Run integration tests:
```bash
node test-hybrid-switching.js
node test-switching-paths.js
```

## Production Checklist

- [ ] Configure `config/regime.json` for your markets
- [ ] Set environment variables (WAYFINDER_SDK_PATH, etc.)
- [ ] Configure email notifications
- [ ] Adjust capital allocations per coin
- [ ] Set appropriate circuit breaker thresholds
- [ ] Test with small capital first
- [ ] Monitor metrics via `trader.getMetrics()`

## API

### HybridPaperTrader

```javascript
const trader = new HybridPaperTrader('BTC-PERP', {
  initialCapital: 2000,
  wayfinder: wayfinderAdapter,
  engine: paperTradingEngine,
  regimeConfig: { adxTrending: 30 },
  notifications: { enabled: true, email: '...' }
});

// Start trading
await trader.start();

// Get metrics
const metrics = trader.getMetrics();
// { totalCycles: 150, totalSwitches: 3, totalErrors: 0, lastRegime: 'TRENDING' }

// Stop trading
await trader.stop();

// Manual resume (if paused by circuit breaker)
trader.resumeTrading('Manual intervention');
```

### HybridStrategy

```javascript
const hybrid = new HybridStrategy(
  logger,
  wayfinder,
  './state',
  regimeConfig,    // Optional overrides
  capitalConfig    // { totalBudget, gridMaxAllocation, bbrsiMaxAllocation }
);

const result = await hybrid.update('BTC-PERP', ohlcv, price, position);
// { action: 'LONG', regime: 'TRENDING', strategy: 'BBRSI', thresholds: {...} }

const status = hybrid.getStatus('BTC-PERP');
// { activeStrategy: 'BBRSI', currentRegime: 'TRENDING', pauseAggressiveRisk: false }

const capital = hybrid.getCapitalStatus();
// { totalBudget: 10000, allocated: { GRID: 0, BBRSI: 8000 }, available: 2000 }
```

## Troubleshooting

**Grid not switching to BBRSI during strong trend:**
- Check cooldown settings (15 min vs 3 hours)
- Verify ADX threshold in regime config
- Check `pauseAggressiveRisk` status

**Too many regime switches:**
- Increase `requiredPersistence` (default 3)
- Increase lookback window (default 120)
- Adjust percentile thresholds

**Circuit breaker triggering too often:**
- Increase `maxDailySwitches` (default 8)
- Adjust `dailyLossLimit` (default 5%)
- Review strategy parameters

## Known Limitations

- **Position Netting**: When running multiple coins in a single process, positions are tracked per-coin but capital is shared. Each coin's GridStrategy respects its own `maxCapital` limit.
- **Exchange Support**: Stop-loss and take-profit orders require `reduceOnly` support from your Wayfinder/exchange adapter.
- **Data Freshness**: The DataProvider falls back to local files if live data is stale (>10 min). Ensure your data pipeline is running for best results.

## License

Private - For Sleep3zz use only
