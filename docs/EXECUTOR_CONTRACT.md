# Executor → BBRSIStrategy Contract

The strategy is stateful. The executor MUST call back after every fill,
or the safety system silently breaks. This is not optional.

## After ANY position-closing fill (TP, SL, trailing, force-close, manual)
Call:
 strategy.notifyExit(side, entryPrice, exitPrice, fillTs, fundingPaidPercent)

- side: "LONG" | "SHORT" (the side that was CLOSED)
- entryPrice: the original entry price
- exitPrice: actual fill price (NOT the signal price)
- fillTs: exchange fill timestamp (ms)
- fundingPaidPercent: cumulative funding paid while in position (default 0)

WHY IT MATTERS:
- Updates dailyRealizedPnl → daily-loss circuit-breaker sees closed losses
- Clears _forceCloseEmittedFor latch → allows a NEW position to be opened
- Resets trailHighWater + positionFingerprint

FAILURE MODE IF SKIPPED:
- Daily-loss breaker blind to realized losses → over-trades a losing day
- Force-close latch stuck → re-opened position's force-close suppressed

## On every evaluation tick, currentPnl MUST be the LIVE unrealized PnL %
 strategy.evaluatePosition(candles, side, equity, entryPrice, currentPnl)

- currentPnl = (unrealized PnL / equity) * 100 (signed; negative = loss)
- If you pass 0 while holding a losing position, the breaker cannot fire
 on unrealized drawdown. This is the #1 silent production failure.

## equity MUST be real account equity (never a placeholder)
- Flows directly into position sizing. A hardcoded value over-leverages.
- If unavailable, DO NOT TRADE — return a refusal, run DRY_RUN only.

## WayfinderAgent Methods Available

From `model-router/src/agents/wayfinder-agent.js`:

### Price Data
- `getLatestPrice(coin = 'BTC')` → number | null
- `getHistoricalCandles(coin, interval, limit, startTime, endTime)` → Array<{t,o,h,l,c,v}> | null
- `get90DayCandles(coin, interval)` → Array (chunked fetch)

### Market Data
- `fetchAllPricesRest()` → Object (all market prices)
- `_postInfo(body, attempts)` → axios response

### Note on Position/Account Methods
The current WayfinderAgent does NOT include:
- getAccountEquity()
- getOpenPosition()
- placeOrder()
- placeGridOrder()
- cancelAllOrders()
- closePosition()

These would need to be added via:
1. HyperLiquid SDK bridge
2. Direct API calls
3. Separate executor module

## Integration Pattern

```javascript
// Executor calls strategy
const signal = strategy.evaluatePosition(candles, side, equity, entryPrice, currentPnl);

// If signal is EXIT, executor places order, then:
strategy.notifyExit(side, entryPrice, exitFillPrice, Date.now(), fundingPaid);

// For next evaluation, get fresh data:
const newCandles = await wayfinder.getHistoricalCandles(coin, '15m', 100);
const currentPrice = wayfinder.getLatestPrice(coin);
// Calculate currentPnl from position + currentPrice
```
