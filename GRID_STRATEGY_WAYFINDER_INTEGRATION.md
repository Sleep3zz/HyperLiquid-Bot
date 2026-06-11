# GridStrategy.js - Wayfinder SDK Integration Summary

## Overview
The `GridStrategy.js` file has been updated to integrate with the Wayfinder SDK through the `WayfinderCommander` class.

## Wayfinder SDK Methods Used

### 1. `WayfinderCommander.placeLimitOrder()`
**Source:** `src/wayfinder/wayfinder-cmds.js` (lines 112-119)
```javascript
placeLimitOrder({ coin, isBuy, size, price }) {
    const cmd = `wayfinder hyperliquid_execute --action place_order --wallet_label ${this.walletLabel} --coin ${coin} --is_spot false --is_buy ${isBuy} --size ${size} --order_type limit --price ${price}`;
    return this._exec(cmd);
}
```
**Usage in GridStrategy:** Places buy and sell limit orders at grid levels

### 2. `WayfinderCommander.closePosition()`
**Source:** `src/wayfinder/wayfinder-cmds.js` (lines 142-154)
```javascript
closePosition(coin) {
    const size = Math.abs(this.getPositionSize(coin));
    if (size === 0) {
        this.logger.info(`No position in ${coin} to close`);
        return null;
    }
    
    const position = this.getPositionSize(coin);
    const isBuy = position < 0;
    
    return this.placeMarketOrder({
        coin,
        isBuy,
        size
    });
}
```
**Usage in GridStrategy:** Closes any open position when stopping the grid

### 3. `WayfinderCommander.getPrice()`
**Source:** `src/wayfinder/wayfinder-cmds.js` (lines 82-85)
```javascript
getPrice(symbol) {
    const result = this._exec(`wayfinder resource wayfinder://hyperliquid/prices/${symbol}`);
    return result ? parseFloat(result.price) : null;
}
```
**Usage in GridStrategy:** Gets current market price for grid initialization and updates

### 4. `WayfinderCommander.getPositionSize()`
**Source:** `src/wayfinder/wayfinder-cmds.js` (lines 68-72)
```javascript
getPositionSize(symbol) {
    const positions = this.getPositions();
    const position = positions.find(p => p.coin === symbol);
    return position ? parseFloat(position.szi) : 0;
}
```
**Usage in GridStrategy:** Checks if there's an open position to close

### 5. `WayfinderCommander.getUnrealizedPnl()`
**Source:** `src/wayfinder/wayfinder-cmds.js` (lines 74-78)
```javascript
getUnrealizedPnl(symbol) {
    const positions = this.getPositions();
    const position = positions.find(p => p.coin === symbol);
    return position ? parseFloat(position.unrealized_pnl) : 0;
}
```
**Usage in GridStrategy:** Tracks unrealized PnL during grid operation

### 6. `WayfinderCommander.getSummary()`
**Source:** `src/wayfinder/wayfinder-cmds.js` (lines 179-206)
```javascript
getSummary() {
    const state = this.getAccountState();
    const positions = this.getPositions();
    
    return {
        wallet: this.walletLabel,
        accountValue: state?.margin_summary?.account_value || 0,
        marginUsed: state?.margin_summary?.margin_used || 0,
        availableMargin: state?.margin_summary?.account_value - state?.margin_summary?.margin_used || 0,
        positionCount: positions.length,
        positions: positions.map(p => ({
            coin: p.coin,
            size: parseFloat(p.szi),
            entryPrice: parseFloat(p.entry_px),
            unrealizedPnl: parseFloat(p.unrealized_pnl),
            liquidationPrice: parseFloat(p.liquidation_px)
        }))
    };
}
```
**Usage in GridStrategy:** Available for account summary if needed

## File Paths

### GridStrategy.js
**Location:** `src/strategy/GridStrategy.js`

### WayfinderCommander (SDK Wrapper)
**Location:** `src/wayfinder/wayfinder-cmds.js`

### Wayfinder SDK Installation
**Location:** `/home/clawdbot/wayfinder-paths-sdk/`

## Configuration

Grid parameters are read from `config/trading.grid`:
```json
{
  "trading": {
    "grid": {
      "levels": 8,
      "spacingPct": 0.8,
      "baseAmount": 50,
      "maxGridCapital": 2000,
      "rangeBoundPct": 5.0
    }
  }
}
```

## Usage Example

```javascript
const GridStrategy = require('./src/strategy/GridStrategy');
const WayfinderCommander = require('./src/wayfinder/wayfinder-cmds');

// Create grid strategy with Wayfinder integration
const grid = new GridStrategy(console, new WayfinderCommander());

// Start grid on BTC
await grid.startGrid('BTC');

// Periodically update (check fills, range bounds)
await grid.update(currentPrice);

// Stop grid
await grid.stopGrid();
```

## Key Features Added

1. **Proper SDK Integration** - Uses `WayfinderCommander` instead of generic `wayfinder` object
2. **Better Error Handling** - Try-catch blocks around order placement
3. **Detailed Logging** - Logs each order placement with price and level
4. **Position Tracking** - Tracks open positions via SDK
5. **PnL Monitoring** - Gets unrealized PnL from SDK
6. **Status Reporting** - `getStatus()` method returns grid state

## Notes

- The Wayfinder SDK doesn't have native grid trading commands
- Grid functionality is built using limit order placement
- Cancel-all-orders would need to be implemented by tracking order IDs
- The SDK uses CLI commands under the hood via `execSync`
