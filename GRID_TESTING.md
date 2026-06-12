# GridStrategy Testnet Validation Notes

## How to Use
Keep this open while testing. Focus on one scenario at a time.

---

## Scenario A: Full Round-Trip

**Watch for:** Clean Realized PnL updates after sell fills.

**Check:** totalPnL increases correctly after both legs complete.

**Red Flag:** totalPnL stays at 0 or jumps unexpectedly.

**Expected Logs:**
```
[GRID] Fill: SELL @ $65432.00 | Realized: $12.34 (after fee) | Total: $45.67
```

---

## Scenario B: Range Breach + Position Close (Most Important)

**Watch for:**
- Grid stops cleanly
- `Closed remaining position` log appears
- `Position close realized` (or fallback) log appears

**Red Flag:** Warning "Could not capture close PnL" appears frequently.

**Expected Logs:**
```
[GRID] Range breached! 5.20% move
[GRID] Closed remaining position: 0.015
[GRID] Position close realized: $45.67 | Total PnL: $123.45
```

Or with fallback:
```
[GRID] Could not capture close PnL after 6 attempts — using fallback
[GRID] Position close (fallback): $43.21
```

---

## Scenario C: Partial Fill

**Watch for:** Partial fill detection logs (if `debugMode = true`).

**Check:** Grid continues operating normally with partial fills.

**Expected Logs:**
```
[DEBUG] Partial fill on oid-123: 45.0%
[GRID] Partial fill detected on oid-123 (45.0% filled)
```

---

## Scenario D: Normal Stop

**Watch for:** `_stopUpdateLoop()` log + no more price updates after stopping.

**Check:** No orphaned orders remain on the exchange.

**Expected Logs:**
```
[GRID] Order 12345 cancelled successfully
[GRID] Grid stopped cleanly
```

**Verify:** No more `getPrice` calls in logs after stop.

---

## Scenario E: Auto Re-center

**Watch for:** Grid restarts after breach when `autoReCenter = true`.

**Red Flag:** Multiple rapid start/stop cycles (flapping).

**Expected Logs:**
```
[GRID] Range breached! 5.20% move
[GRID] Auto re-centering grid...
[GRID] Starting grid on BTC @ $68000.00
```

---

## General Things to Monitor

### Capital Limits
- Any warnings from `_rebalanceGrid()` about capital limits
- Expected: `[GRID] Skipping rebalance — would exceed max capital`

### Status Values
- Whether `getStatus()` returns reasonable values
- Check: `capitalUsed` should be close to `openOrders × baseAmount`

### PnL Anomalies
- Sudden spikes or drops in totalPnL without corresponding fills
- Compare with exchange's realized PnL

### Debug Mode
Enable for detailed logging:
```javascript
const grid = new GridStrategy(logger, wayfinder, {
    debugMode: true  // Extra debug logs
});
```

Disable in production:
```javascript
const grid = new GridStrategy(logger, wayfinder, {
    debugMode: false  // Cleaner logs
});
```

---

## Quick Validation Checklist

- [ ] Full round-trip fills update totalPnL correctly
- [ ] Range breach stops grid cleanly
- [ ] Position close PnL captured (or fallback triggers)
- [ ] Partial fills detected without corruption
- [ ] Normal stop cancels all orders
- [ ] Update interval stops (no more getPrice calls)
- [ ] Auto re-center works (if enabled)
- [ ] Capital limit enforcement works
- [ ] Retry logic handles transient errors
- [ ] totalPnL matches exchange realized PnL

---

## PnL Reconciliation

After testing, compare:

| Source | Value |
|--------|-------|
| GridStrategy totalPnL | $XXX.XX |
| Hyperliquid Realized PnL | $XXX.XX |
| Difference | $X.XX |

Small differences expected due to:
- Slippage
- Fee calculation timing
- Unrealized vs realized timing

Large differences indicate a bug.
