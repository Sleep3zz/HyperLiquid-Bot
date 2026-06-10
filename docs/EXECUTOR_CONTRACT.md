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

### Account & Position Methods (Now Available in WayfinderAgent)

The WayfinderAgent now includes full account/position/order support:

**Authentication:**
- `setWallet(address)` - Set wallet address for authenticated requests

**Account Data:**
- `getAccountEquity()` → `number|null` - Total account value in USD
- `getOpenPosition(coin)` → `{side, size, entryPrice, unrealizedPnl, ...}|null`
- `getAllPositions()` → `Array<Position>` - All open positions

**Order Management (DRY_RUN by default):**
- `placeOrder({coin, side, size, price, dryRun})` → `OrderResult`
- `placeGridOrder(coin, side, price, amount, dryRun)` → `OrderResult`
- `cancelAllOrders(coin, dryRun)` → `CancelResult`
- `closePosition(coin, dryRun)` → `CloseResult`

**Safety Note:** All order methods default to `dryRun=true`. Set `dryRun=false` ONLY when ready for live trading with proper private key signing.

## Integration Pattern

```javascript
// Setup
const wayfinder = new WayfinderAgent({ autoConnect: false });
wayfinder.setWallet('0x...'); // Set your wallet address

// 1. Get account data
const equity = await wayfinder.getAccountEquity();
const position = await wayfinder.getOpenPosition('BTC');

// 2. Get market data
const candles = await wayfinder.getHistoricalCandles('BTC', '15m', 100);
const currentPrice = wayfinder.getLatestPrice('BTC');

// 3. Calculate current PnL if in position
let currentPnl = 0;
if (position) {
    const direction = position.side === 'LONG' ? 1 : -1;
    const priceChange = (currentPrice - position.entryPrice) / position.entryPrice;
    currentPnl = priceChange * direction * 100; // Percentage
}

// 4. Evaluate strategy
const signal = strategy.evaluatePosition(
    candles,
    position?.side || null,
    equity,
    position?.entryPrice || 0,
    currentPnl
);

// 5. Execute signal
if (signal.signal === 'EXIT' || signal.signal === 'FORCE_CLOSE') {
    // Close position
    const result = await wayfinder.closePosition('BTC', true); // dryRun=true
    
    // Notify strategy of exit
    if (result.success) {
        strategy.notifyExit(
            position.side,
            position.entryPrice,
            currentPrice,
            Date.now(),
            0 // fundingPaidPercent
        );
    }
}

// For new entries, use placeOrder or placeGridOrder
if (signal.signal === 'LONG' && !position) {
    await wayfinder.placeOrder({
        coin: 'BTC',
        side: 'BUY',
        size: signal.size || 0.01,
        price: 0, // Market order
        dryRun: true
    });
}
```
