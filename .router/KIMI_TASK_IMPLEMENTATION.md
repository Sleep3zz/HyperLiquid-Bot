# MODEL ROUTER TASK ASSIGNMENT
## Implementation Tasks for Kimi

**Task ID**: IMPL-2024-0604-001  
**Assigned to**: Kimi  
**Priority**: High  
**Status**: Ready to Start  
**Design Reference**: CLAUDE_DESIGN.md

---

## Task 1: MarketDataProvider
**Complexity**: Low  
**Estimated Time**: 30 minutes

**Requirements**:
- Fetch prices from Wayfinder
- Retrieve historical candles
- Handle API errors
- Basic caching

**Interface** (from CLAUDE_DESIGN.md):
```javascript
class MarketDataProvider {
    async getPrice(symbol)
    async getCandles(symbol, timeframe, limit)
    async getFundingRate(symbol)
}
```

**Deliverable**: `src/paper-trading/MarketDataProvider.js`

---

## Task 2: PaperTradingEngine Core
**Complexity**: Medium  
**Estimated Time**: 1 hour

**Requirements**:
- Position tracking
- PnL calculation
- Virtual balance management
- Event emission

**Interface** (from CLAUDE_DESIGN.md):
```javascript
class PaperTradingEngine extends EventEmitter {
    async openPosition(params): Position
    async closePosition(symbol): ClosedPosition
    getPortfolio(): PortfolioState
    getBalance(): number
}
```

**Deliverable**: `src/paper-trading/PaperTradingEngine.js`

---

## Task 3: PerformanceTracker
**Complexity**: Medium  
**Estimated Time**: 45 minutes

**Requirements**:
- Calculate Sharpe ratio
- Calculate max drawdown
- Calculate win rate
- Generate performance report

**Formulas** (from CLAUDE_DESIGN.md):
- Sharpe: (Return - Risk Free Rate) / Std Dev
- Drawdown: Peak - Trough / Peak
- Win Rate: Wins / Total Trades

**Deliverable**: `src/paper-trading/PerformanceTracker.js`

---

## Implementation Notes

1. Use existing code patterns from `src/backtesting/Backtester.js`
2. Follow the interfaces defined in CLAUDE_DESIGN.md
3. Add JSDoc comments
4. Handle errors gracefully
5. Use winston for logging

---

## Acceptance Criteria

- [ ] All methods implemented per interface
- [ ] Unit tests pass
- [ ] No hardcoded values (use config)
- [ ] Error handling in place
- [ ] Logging at appropriate levels
