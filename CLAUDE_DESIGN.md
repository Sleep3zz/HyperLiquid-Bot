# Paper Trading System Architecture
## Designed by Claude (Architecture Task)

**Date**: 2026-06-04  
**Status**: Design Complete  
**Review**: Ready for Implementation

---

## Executive Summary

This architecture leverages HyperLiquidAlgoBot's existing proven components to create a paper trading system with minimal new code. The design prioritizes:

1. **Code Reuse**: Use existing BBRSIStrategy, MLOptimizer, RiskManager
2. **Clear Interfaces**: Well-defined contracts between components
3. **Testability**: Each component can be tested in isolation
4. **Extensibility**: Easy to add new strategies or risk models

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     PAPER TRADING SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Market     │───→│   Strategy   │───→│    Risk      │      │
│  │   Data       │    │   Adapter    │    │   Manager    │      │
│  │   (Kimi)     │    │   (Claude)   │    │  (Claude)    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         │            ┌──────┴──────┐           │               │
│         │            │  BBRSI      │           │               │
│         │            │  Strategy   │           │               │
│         │            │  (Existing) │           │               │
│         │            └─────────────┘           │               │
│         │                                      │               │
│         ↓                                      ↓               │
│  ┌────────────────────────────────────────────────────────┐   │
│  │              PaperTradingEngine                        │   │
│  │         (Virtual Portfolio Manager)                    │   │
│  │  - Position tracking                                   │   │
│  │  - PnL calculation                                     │   │
│  │  - Trade execution simulation                          │   │
│  │  - Balance management                                  │   │
│  └────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ↓                                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │              PerformanceTracker                        │   │
│  │         (Metrics & Analytics)                          │   │
│  │  - Sharpe ratio                                        │   │
│  │  - Max drawdown                                        │   │
│  │  - Win rate                                            │   │
│  │  - Equity curve                                        │   │
│  └────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ↓                                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                ML Optimizer                            │   │
│  │           (Parameter Tuning)                           │   │
│  │  - Feature importance                                  │   │
│  │  - Optimal parameters                                  │   │
│  │  - Model training                                      │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

                         ↓
              ┌──────────────────┐
              │  Event Emitter   │
              │  (Logging/Monte) │
              └──────────────────┘
```

---

## Component Specifications

### 1. MarketDataProvider (Kimi Task)
**Purpose**: Fetch real-time market data from Wayfinder

**Interface**:
```javascript
class MarketDataProvider {
    async getPrice(symbol)
    async getCandles(symbol, timeframe, limit)
    async getFundingRate(symbol)
    async getOrderBook(symbol, depth)
}
```

**Responsibilities**:
- Fetch current prices
- Retrieve historical candles
- Get funding rates
- Handle API errors gracefully
- Cache data for performance

---

### 2. StrategyAdapter (Claude Design)
**Purpose**: Bridge between BBRSIStrategy and paper trading engine

**Interface**:
```javascript
class StrategyAdapter {
    constructor(strategy, mlOptimizer)
    
    async generateSignal(marketData): SignalResult
    async getOptimizedParameters(): ParameterSet
    async calculatePositionSize(signal, portfolio): number
    
    // SignalResult structure
    {
        signal: 'LONG' | 'SHORT' | 'NONE',
        confidence: number (0-1),
        indicators: { rsi, bb, adx, price },
        takeProfit: number,
        stopLoss: number,
        reasoning: string
    }
}
```

**Responsibilities**:
- Adapt BBRSIStrategy output to paper trading format
- Integrate ML-optimized parameters
- Calculate position sizing based on confidence
- Provide signal reasoning for logging

**Integration with BBRSIStrategy**:
```javascript
// StrategyAdapter calls existing BBRSIStrategy
const bbrsiResult = await bbrsiStrategy.evaluatePosition(candleData);

// Then enriches with ML data
const mlParams = await mlOptimizer.getOptimizedParameters();
const enrichedSignal = this.enrichSignal(bbrsiResult, mlParams);
```

---

### 3. RiskManager (Claude Design)
**Purpose**: Risk assessment and position validation

**Interface**:
```javascriptnclass RiskManager {
    constructor(config)
    
    assessRisk(signal, portfolio): RiskAssessment
    validatePositionSize(size, portfolio): boolean
    calculateStopLoss(entryPrice, side): number
    calculateTakeProfit(entryPrice, side): number
    checkDrawdownLimit(currentDrawdown): boolean
    
    // RiskAssessment structure
    {
        approved: boolean,
        riskLevel: 'LOW' | 'MEDIUM' | 'HIGH',
        maxPositionSize: number,
        recommendedLeverage: number,
        reasons: string[]
    }
}
```

**Risk Rules**:
1. Max position size: 10% of portfolio
2. Max leverage: 3x (configurable)
3. Max concurrent positions: 3
4. Max daily loss: $50 (5% of capital)
5. Max drawdown: 10% from peak
6. Stop-loss: 2% from entry
7. Take-profit: 3% from entry

---

### 4. PaperTradingEngine (Core Component)
**Purpose**: Virtual portfolio and trade simulation

**Interface**:
```javascript
class PaperTradingEngine extends EventEmitter {
    constructor(config)
    
    // Position management
    async openPosition(params): Position
    async closePosition(symbol): ClosedPosition
    async updatePosition(symbol, currentPrice): Position
    getPosition(symbol): Position | null
    getAllPositions(): Position[]
    
    // Portfolio queries
    getPortfolio(): PortfolioState
    getBalance(): number
    getMarginUsed(): number
    getAvailableBalance(): number
    
    // Trade history
    getTrades(): Trade[]
    getStats(): PerformanceStats
    
    // Events emitted
    'positionOpened', 'positionClosed', 'portfolioUpdate'
}

// Data Structures
Position {
    id: string,
    symbol: string,
    side: 'LONG' | 'SHORT',
    size: number,
    entryPrice: number,
    currentPrice: number,
    leverage: number,
    margin: number,
    unrealizedPnl: number,
    stopLoss: number,
    takeProfit: number,
    openTime: timestamp
}

PortfolioState {
    initialCapital: number,
    balance: number,
    marginUsed: number,
    unrealizedPnl: number,
    totalValue: number,
    totalReturn: number,
    positions: Position[],
    timestamp: timestamp
}
```

**Responsibilities**:
- Track virtual balance and positions
- Calculate PnL (realized and unrealized)
- Simulate trade execution
- Enforce position limits
- Emit events for monitoring
- Handle fees and slippage

**PnL Calculation**:
```javascript
// Long position
unrealizedPnL = (currentPrice - entryPrice) * size * leverage - fees

// Short position  
unrealizedPnL = (entryPrice - currentPrice) * size * leverage - fees
```

---

### 5. PerformanceTracker (Claude Design)
**Purpose**: Calculate and track performance metrics

**Interface**:
```javascript
class PerformanceTracker {
    constructor(engine)
    
    calculateSharpeRatio(returns): number
    calculateMaxDrawdown(equityCurve): { maxDrawdown, peak, trough }
    calculateWinRate(trades): number
    calculateProfitFactor(trades): number
    calculateSortinoRatio(returns): number
    
    generateReport(): PerformanceReport
    
    // PerformanceReport structure
    {
        period: string,
        initialCapital: number,
        finalEquity: number,
        totalReturn: number,
        sharpeRatio: number,
        maxDrawdown: number,
        winRate: number,
        profitFactor: number,
        totalTrades: number,
        avgTrade: number,
        avgWin: number,
        avgLoss: number,
        largestWin: number,
        largestLoss: number
    }
}
```

**Metrics Calculated**:
- **Sharpe Ratio**: (Return - Risk Free Rate) / Standard Deviation
- **Max Drawdown**: Largest peak-to-trough decline
- **Win Rate**: % of winning trades
- **Profit Factor**: Gross Profit / Gross Loss
- **Sortino Ratio**: Similar to Sharpe but only downside deviation

---

## Data Flow

### Trade Execution Flow

```
1. MarketDataProvider fetches price
              ↓
2. StrategyAdapter generates signal
   (using BBRSIStrategy + ML params)
              ↓
3. RiskManager assesses risk
              ↓
4. [IF APPROVED] PaperTradingEngine opens position
              ↓
5. PerformanceTracker updates metrics
              ↓
6. Events emitted for monitoring
```

### Position Update Flow

```
1. Price update received
              ↓
2. PaperTradingEngine updates unrealized PnL
              ↓
3. Check stop-loss / take-profit
              ↓
4. [IF TRIGGERED] Close position
              ↓
5. Update balance and realized PnL
              ↓
6. PerformanceTracker recalculates metrics
```

---

## Integration Points

### With BBRSIStrategy
```javascript
const strategy = new BBRSIStrategy(logger);
const adapter = new StrategyAdapter(strategy, mlOptimizer);

// In trading loop
const signal = await adapter.generateSignal(marketData);
```

### With MLOptimizer
```javascript
const mlOptimizer = new MLOptimizer({
    modelType: 'xgboost',
    market: 'BTC-PERP'
});

// Load pre-trained model
await mlOptimizer.loadModel('BTC-PERP_15m_xgboost.pkl');

// Use in strategy adapter
const optimizedParams = await mlOptimizer.predictOptimalParameters(features);
```

### With Wayfinder
```javascriptnconst wayfinder = new WayfinderCommander();
const dataProvider = new MarketDataProvider(wayfinder);

// Fetch live data
const price = await dataProvider.getPrice('BTC');
const candles = await dataProvider.getCandles('BTC-PERP', '15m', 100);
```

---

## Configuration

```json
{
    "paperTrading": {
        "initialCapital": 1000,
        "mode": "dry_run",
        "maxPositionSize": 0.1,
        "maxLeverage": 3,
        "maxPositions": 3,
        "tradingFee": 0.001,
        "slippage": 0.001
    },
    "risk": {
        "stopLossPct": 2.0,
        "takeProfitPct": 3.0,
        "maxDailyLoss": 50,
        "maxDrawdown": 10
    },
    "ml": {
        "enabled": true,
        "modelType": "xgboost",
        "confidenceThreshold": 0.6
    }
}
```

---

## Implementation Priority

1. **P0 - Core**: PaperTradingEngine (position/portfolio management)
2. **P0 - Data**: MarketDataProvider (Wayfinder integration)
3. **P1 - Strategy**: StrategyAdapter (BBRSI integration)
4. **P1 - Risk**: RiskManager (position validation)
5. **P2 - Analytics**: PerformanceTracker (metrics)
6. **P2 - ML**: MLOptimizer integration

---

## Testing Strategy

1. **Unit Tests**: Each component in isolation
2. **Integration Tests**: Component interactions
3. **Backtest Validation**: Compare with historical results
4. **Paper Trading**: 30-day dry run before live

---

## Next Steps for Implementation

1. **Kimi**: Implement MarketDataProvider (data fetching)
2. **Kimi**: Implement PaperTradingEngine core (position tracking)
3. **Claude**: Review and refine StrategyAdapter
4. **Claude**: Design RiskManager rules
5. **Kimi**: Implement PerformanceTracker calculations
6. **Claude**: Integration testing and validation

---

**Architecture Status**: ✅ Design Complete  
**Ready for**: Implementation Phase  
**Estimated Implementation Time**: 4-6 hours
