const config = require("config");
const WayfinderCommander = require('../wayfinder/wayfinder-cmds');

/**
 * GridStrategy - Grid Trading Implementation using Wayfinder SDK
 * 
 * IMPORTANT NOTES:
 * - basePrice is fixed for the life of the grid (set at startGrid()). 
 *   Re-centering requires stopping and restarting the grid (or use autoReCenter).
 * - Grid levels are placed symmetrically around basePrice at startup.
 * - Rebalanced orders use the actual fill price, not basePrice.
 * 
 * Improvements in this version:
 * - Fixed update() race condition
 * - Added fill detection + automatic grid rebalancing
 * - Improved local order reconciliation (primary source of truth = local Map)
 * - Better PnL tracking (realized + unrealized)
 * - Stronger cleanup in stopGrid() and _cancelAllOrders()
 */
class GridStrategy {
    constructor(logger, wayfinderCmds = null, userConfig = {}) {
        this.logger = logger || console;

        this.wayfinder = wayfinderCmds || new WayfinderCommander({
            sdkPath: process.env.WAYFINDER_SDK_PATH,
            walletLabel: process.env.WAYFINDER_WALLET_LABEL || 'main',
            logger: this.logger
        });

        // Config from file (node-config) - can be overridden by constructor config
        const fileConfig = require("config").get ? require("config").get("trading.grid") || {} : {};

        // Configurable parameters (constructor config takes precedence over file config)
        this.coin = userConfig.coin || fileConfig.coin || 'BTC';
        this.updateIntervalMs = userConfig.updateIntervalMs || fileConfig.updateIntervalMs || 15000;
        this.baseAmount = Number(userConfig.baseAmount || fileConfig.baseAmount || 50);
        this.gridSpacingPct = Number(userConfig.gridSpacingPct || fileConfig.spacingPct || 0.8);
        this.gridLevels = Number(userConfig.gridLevels || fileConfig.levels || 20);
        this.rangeBoundPct = Number(userConfig.rangeBoundPct || fileConfig.rangeBoundPct || 5.0);
        this.maxGridCapital = Number(userConfig.maxGridCapital || fileConfig.maxGridCapital || 2000);
        this.autoReCenter = userConfig.autoReCenter ?? fileConfig.autoReCenter ?? false;
        this.maxFilledHistory = userConfig.maxFilledHistory || fileConfig.maxFilledHistory || 500;
        this.verboseLogging = userConfig.verboseLogging ?? fileConfig.verboseLogging ?? true;

        // State
        this.active = false;
        this.basePrice = null;
        this.gridOrders = new Map(); // oid -> { side, price, level, status }
        this.filledOrders = [];
        this.totalPnL = 0;
        this.updateInterval = null;
        this._updating = false;
        this._stopping = false;
    }

    _extractOrderId(res) {
        try {
            if (!res || res.status !== "ok" || !Array.isArray(res.effects)) return null;

            for (const effect of res.effects) {
                if (effect?.ok !== true) continue;
                const statuses = effect?.result?.response?.data?.statuses;
                if (!Array.isArray(statuses)) continue;

                for (const s of statuses) {
                    if (s?.error) {
                        this.logger.warn(`[GRID] Order rejected by HL: ${s.error}`);
                        continue;
                    }
                    if (s?.resting?.oid != null) return { oid: String(s.resting.oid), status: "resting" };
                    if (s?.filled?.oid != null) return { oid: String(s.filled.oid), status: "filled" };
                }
            }
            return null;
        } catch (e) {
            this.logger.error(`[GRID] _extractOrderId failed: ${e.message}`);
            return null;
        }
    }

    async startGrid(coin = "BTC", price = null) {
        if (this.active) return `Grid already running on ${this.coin}`;

        const totalCapital = this.gridLevels * 2 * this.baseAmount;
        if (totalCapital > this.maxGridCapital) {
            return `Grid capital $${totalCapital} exceeds max $${this.maxGridCapital}`;
        }

        // Use provided price (for re-centering) or fetch fresh price
        if (!price) {
            try {
                price = await this.wayfinder.getPrice(coin); // NOTE: wayfinder calls are async
            } catch (e) {
                return `Failed to get price: ${e.message}`;
            }
        }
        
        if (!Number.isFinite(price) || price <= 0) {
            return "No valid price available from Wayfinder";
        }

        // Validate grid configuration
        const maxGridRange = (this.gridSpacingPct / 100) * this.gridLevels;
        if (maxGridRange > this.rangeBoundPct / 100) {
            this.logger?.warn?.(
                `[GRID] Warning: Grid range (${(maxGridRange * 100).toFixed(2)}%) exceeds range bound ` +
                `(${this.rangeBoundPct}%). Some levels may never fill.`
            );
        }

        this.coin = coin;
        this.basePrice = price; // NOTE: basePrice is set once when grid starts and does not change. Re-centering requires stopping/restarting.
        this.active = true;
        this.gridOrders.clear();
        this.filledOrders = [];
        this.totalPnL = 0;

        this.logger.info(`[GRID] Starting grid on ${coin} @ $${price.toFixed(2)}`);

        const placed = await this._buildGrid();

        if (placed.length === 0) {
            this.active = false;
            await this._cancelAllOrders();
            this.logger.error(`[GRID] No orders tracked — possible untracked LIVE orders exist. Check manually.`);
            return "Failed to place/track any grid orders — verify exchange for orphaned orders";
        }

        this._startUpdateLoop();
        return `Grid active on ${coin} with ${placed.length} tracked orders`;
    }

    async _buildGrid() {
        const placed = [];
        const placedOrders = []; // Track raw responses for rollback

        try {
            const totalCapital = this.gridLevels * 2 * this.baseAmount;
            if (totalCapital > this.maxGridCapital) {
                this.logger.error(`[GRID] Capital exceeds limit`);
                return [];
            }

            for (let i = 1; i <= this.gridLevels; i++) {
                const buyPrice = this.basePrice * (1 - (i * this.gridSpacingPct / 100));
                const sellPrice = this.basePrice * (1 + (i * this.gridSpacingPct / 100));

                if (!(buyPrice > 0) || !(sellPrice > 0)) {
                    this.logger.error(`[GRID] Invalid price at level ${i}`);
                    throw new Error(`Invalid price at level ${i}`);
                }

                // BUY
                const buySize = this.baseAmount / buyPrice;
                const buyRes = await this.wayfinder.placeLimitOrder({
                    coin: this.coin, isBuy: true, size: buySize, price: buyPrice
                });
                placedOrders.push(buyRes);
                
                const buyId = this._extractOrderId(buyRes);
                if (buyId) {
                    this.gridOrders.set(buyId.oid, { side: "BUY", price: buyPrice, level: i, size: buySize, status: buyId.status });
                    placed.push(buyId.oid);
                } else {
                    this.logger.error(`[GRID] Buy L${i} failed to return OID — aborting`);
                    throw new Error(`Buy L${i} failed to return OID`);
                }

                // SELL
                const sellSize = this.baseAmount / sellPrice;
                const sellRes = await this.wayfinder.placeLimitOrder({
                    coin: this.coin, isBuy: false, size: sellSize, price: sellPrice
                });
                placedOrders.push(sellRes);
                
                const sellId = this._extractOrderId(sellRes);
                if (sellId) {
                    this.gridOrders.set(sellId.oid, { side: "SELL", price: sellPrice, level: i, size: sellSize, status: sellId.status });
                    placed.push(sellId.oid);
                } else {
                    this.logger.error(`[GRID] Sell L${i} failed to return OID — aborting`);
                    throw new Error(`Sell L${i} failed to return OID`);
                }
            }
        } catch (e) {
            this.logger.error(`[GRID] Error building grid: ${e.message}`);
            
            // Better rollback: cancel all placed orders
            for (const order of placedOrders) {
                try {
                    const oid = this._extractOrderId(order)?.oid;
                    if (oid) {
                        await this.wayfinder.cancelOrder(this.coin, oid);
                        this.logger?.info?.(`[GRID] Rolled back order ${oid}`);
                    }
                } catch (cancelErr) {
                    this.logger?.warn?.(`[GRID] Failed to cancel during rollback: ${cancelErr.message}`);
                }
            }
            
            this.gridOrders.clear();
            this.active = false;
            return [];
        }

        return placed;
    }

    async stopGrid() {
        if (this._stopping) return;
        this._stopping = true;
        this.active = false;

        try {
            this._stopUpdateLoop(); // Stop the update loop first
            await this._cancelAllOrders();

            // === Close remaining position and capture realized PnL ===
            const position = Number(await this.wayfinder.getPositionSize(this.coin)) || 0;

            if (Math.abs(position) > 0.0001) {
                try {
                    // Get fills before closing
                    const beforeFills = await this._withRetry(() => this.wayfinder.getUserFills(this.coin)) || [];
                    const beforeIds = new Set(
                        beforeFills.map(f => String(f.tid ?? f.oid))
                    );

                    const closeRes = await this.wayfinder.closePosition(this.coin);

                    // Validate response
                    if (closeRes && (closeRes.status === 'ok' || closeRes.success === true)) {
                        this.logger?.info?.(`[GRID] Closed remaining position: ${position}`);

                        // Try to get new fills (with short retry in case of eventual consistency)
                        let afterFills = [];
                        let attempts = 0;
                        const maxAttempts = 3;
                        let captured = false;

                        while (attempts < maxAttempts) {
                            afterFills = await this._withRetry(() => this.wayfinder.getUserFills(this.coin)) || [];
                            const newFills = afterFills.filter(f => !beforeIds.has(String(f.tid ?? f.oid)));

                            if (newFills.length > 0) {
                                let closePnL = 0;
                                for (const f of newFills) {
                                    closePnL += Number(f.closedPnl ?? 0) - Number(f.fee ?? 0);
                                }

                                this.totalPnL += closePnL;
                                this.logger?.info?.(
                                    `[GRID] Position close realized: $${closePnL.toFixed(2)} | Total: $${this.totalPnL.toFixed(2)}`
                                );
                                captured = true;
                                break;
                            }

                            attempts++;
                            if (attempts < maxAttempts) {
                                await new Promise(r => setTimeout(r, 800)); // short delay
                            }
                        }

                        if (!captured) {
                            this.logger?.warn?.(`[GRID] Could not capture close PnL after ${maxAttempts} attempts`);
                        }
                    } else {
                        this.logger?.warn?.(`[GRID] closePosition did not confirm success`, closeRes);
                    }
                } catch (err) {
                    this.logger?.error?.(`[GRID] Error closing position: ${err.message}`);
                }
            }

            this.gridOrders.clear();
            this.logger?.info?.('[GRID] Grid stopped cleanly');
        } catch (e) {
            this.logger?.error?.(`[GRID] Error stopping grid: ${e.message}`);
        } finally {
            this._stopping = false;
        }
    }

    async _cancelAllOrders() {
        let cancelled = 0;
        const failedIds = [];

        for (const [oid, order] of this.gridOrders) {
            try {
                const res = await this._withRetry(() => this.wayfinder.cancelOrder(this.coin, oid));

                if (res && (res.status === 'ok' || res.success === true)) {
                    this.logger?.info?.(`[GRID] Order ${oid} cancelled successfully`);
                    this.gridOrders.delete(oid);
                    cancelled++;
                } else {
                    this.logger?.warn?.(`[GRID] Failed to cancel order ${oid}`, res);
                    failedIds.push(oid);
                }
            } catch (e) {
                this.logger?.error?.(`[GRID] Exception cancelling order ${oid}: ${e.message}`);
                failedIds.push(oid);
            }
        }

        if (failedIds.length > 0) {
            this.logger.warn(`[GRID] ${failedIds.length} orders could not be cancelled: ${failedIds.join(", ")}`);
        }

        return { cancelled, failed: failedIds.length, failedIds };
    }

    /* Best-effort reconciliation using local state + API fills
     */
    async reconcileOrders() {
        if (!this.active || this.gridOrders.size === 0) return;

        let openOrders, recentFills;

        try {
            openOrders = await this._withRetry(() => this.wayfinder.getOpenOrders(this.coin));
            recentFills = await this._withRetry(() => this.wayfinder.getUserFills(this.coin));

            // DEBUG: Log sample fill to confirm field names (remove after testing)
            if (recentFills?.length > 0) {
                this.logger.debug("[DEBUG] Sample fill:", JSON.stringify(recentFills[0]));
            }
        } catch (e) {
            this.logger?.warn?.(`[GRID] Reconciliation skipped — API error: ${e.message}`);
            return;
        }

        if (!Array.isArray(openOrders)) {
            this.logger?.warn?.(`[GRID] Open orders response invalid — skipping reconciliation`);
            return;
        }

        const openOids = new Set(openOrders.map(o => String(o.oid)));
        const filledByOid = new Map(
            (Array.isArray(recentFills) ? recentFills : [])
                .map(f => [String(f.oid), f])
        );

        const gracePeriodMs = (this.updateIntervalMs || 15000) * 2;

        for (const [oid, order] of this.gridOrders) {
            if (order.status === "filled") continue;

            if (openOids.has(oid)) {
                // Order is back on the book → clear any missing timestamp
                if (order.missingSince) delete order.missingSince;
                continue;
            }

            const fill = filledByOid.get(oid);

            if (fill) {
                // Confirmed fill with real data
                const enriched = {
                    ...order,
                    price: Number(fill.px) || order.price,
                    fillSize: Number(fill.sz) || Number(fill.filledSize), // use real size
                    fee: Number(fill.fee) || 0
                };
                this._handleFilledOrder(oid, enriched);
            } else {
                // Order is missing from both book and recent fills.
                // Give it one more cycle before treating it as cancelled.
                if (!order.missingSince) {
                    order.missingSince = Date.now();
                    continue; // skip this cycle
                }

                // If it's been missing for more than grace period (~2 cycles), treat as cancelled
                if (Date.now() - order.missingSince > gracePeriodMs) {
                    this.logger.warn(`[GRID] Order ${oid} missing too long — treating as cancelled`);
                    this.gridOrders.delete(oid);
                }
            }
        }

        // === Partial Fill Handling ===
        for (const [oid, order] of this.gridOrders) {
            if (order.status === "filled") continue;

            const openOrder = openOrders.find(o => String(o.oid) === oid);
            if (openOrder) {
                const filledSoFar = Number(openOrder.filledSize || openOrder.sz || 0);
                const remainingSize = Number(openOrder.remainingSize || 0);
                const totalSize = filledSoFar + remainingSize;

                if (filledSoFar > 0 && remainingSize > 0) {
                    const fillRatio = filledSoFar / totalSize;

                    // Store partial fill info on the order
                    order.partialFilled = fillRatio;
                    order.filledSize = filledSoFar;

                    if (fillRatio > 0.1) {
                        this.logger.info(
                            `[GRID] Partial fill detected on ${oid} ` +
                            `(${(fillRatio * 100).toFixed(1)}% filled)`
                        );
                    }
                }
            }
        }
    }

    _handleFilledOrder(oid, orderInfo) {
        this.gridOrders.delete(oid);

        const fillPrice = Number(orderInfo.price) || 0;
        const size = Number(orderInfo.fillSize) || (this.baseAmount / fillPrice);
        const fee = Number(orderInfo.fee) || 0;

        let realized = 0;
        if (orderInfo.entryPrice && orderInfo.entryPrice > 0) {
            if (orderInfo.side === "SELL") {
                realized = (fillPrice - orderInfo.entryPrice) * size;
            } else {
                realized = (orderInfo.entryPrice - fillPrice) * size;
            }
        }

        // Subtract fees from realized PnL
        realized -= fee;

        this.totalPnL += realized;

        this.filledOrders.push({
            ...orderInfo,
            oid,
            fillPrice,
            size,
            fee,
            realizedPnl: realized,
            filledAt: Date.now()
        });

        // Limit filledOrders history to prevent unbounded growth
        if (this.filledOrders.length > this.maxFilledHistory) {
            this.filledOrders = this.filledOrders.slice(-Math.floor(this.maxFilledHistory * 0.6)); // keep last 60%
        }

        this.logger.info(
            `[GRID] Fill: ${orderInfo.side} @ $${fillPrice.toFixed(2)} | ` +
            `Realized: $${realized.toFixed(2)} (after fee) | Total: $${this.totalPnL.toFixed(2)}`
        );

        this._rebalanceGrid(orderInfo).catch(e =>
            this.logger.error(`[GRID] Rebalance error: ${e.message}`)
        );
    }

    async _rebalanceGrid(filledOrder) {
        if (!this.active) return;

        const { side, level, price: fillPrice } = filledOrder;
        const step = this.gridSpacingPct / 100;

        // Place counter-order ONE step away from the actual fill price
        let newPrice, isBuy;

        if (side === "BUY") {
            newPrice = fillPrice * (1 + step); // Sell higher
            isBuy = false;
        } else {
            newPrice = fillPrice * (1 - step); // Buy lower
            isBuy = true;
        }

        if (!(newPrice > 0)) return;

        // Prevent duplicate orders at nearly the same price
        const duplicate = [...this.gridOrders.values()].some(o =>
            o.side === (isBuy ? "BUY" : "SELL") &&
            Math.abs(o.price - newPrice) / newPrice < 1e-5
        );

        if (duplicate) {
            this.logger?.warn?.(`[GRID] Skipping rebalance — order already exists near $${newPrice.toFixed(2)}`);
            return;
        }

        const size = this.baseAmount / newPrice;

        // Enforce capital limit
        const projectedCapital = this.getCurrentCapitalUsage() + (size * newPrice);
        if (projectedCapital > this.maxGridCapital) {
            this.logger?.warn?.(
                `[GRID] Skipping rebalance — would exceed max capital ` +
                `($${projectedCapital.toFixed(2)} > $${this.maxGridCapital})`
            );
            return;
        }

        try {
            const res = await this.wayfinder.placeLimitOrder({
                coin: this.coin,
                isBuy,
                size,
                price: newPrice
            });

            const newId = this._extractOrderId(res);
            if (newId) {
                this.gridOrders.set(newId.oid, {
                    side: isBuy ? "BUY" : "SELL",
                    price: newPrice,
                    level,
                    size, // ← Store size for accurate capital tracking
                    entryPrice: fillPrice, // ← Important for PnL tracking
                    status: newId.status || "open"
                });

                this.logger?.info?.(
                    `[GRID] Rebalanced: ${isBuy ? "BUY" : "SELL"} @ $${newPrice.toFixed(2)} ` +
                    `(paired from $${fillPrice.toFixed(2)})`
                );
            } else {
                this.logger?.error?.(`[GRID] Rebalance placed but no OID returned at $${newPrice.toFixed(2)}`);
            }
        } catch (e) {
            this.logger?.error?.(`[GRID] Rebalance order failed: ${e.message}`);
        }
    }

    async update(currentPrice) {
        if (!this.active || this._updating || this._stopping) return;

        this._updating = true;
        let breached = false;

        try {
            breached = await this.checkRangeBound(currentPrice);

            if (!breached) {
                await this.reconcileOrders();

                const position = Number(await this._withRetry(() => this.wayfinder.getPositionSize(this.coin))) || 0;
                const unrealizedPnl = Number(await this._withRetry(() => this.wayfinder.getUnrealizedPnl(this.coin))) || 0;

                const logFn = this.verboseLogging ? this.logger.info : this.logger.debug;

                logFn(
                    `[GRID] ${this.coin} @ $${currentPrice.toFixed(2)} | ` +
                    `Pos: ${position.toFixed(4)} | Unrealized: $${unrealizedPnl.toFixed(2)} | ` +
                    `Realized: $${this.totalPnL.toFixed(2)}`
                );
            }
        } catch (e) {
            this.logger?.error?.(`[GRID] update() error: ${e.message}`);
        } finally {
            this._updating = false; // Release lock BEFORE we call stopGrid
        }

        // Handle breach *outside* the lock
        if (breached) {
            await this.stopGrid();

            if (this.autoReCenter) {
                this.logger.info('[GRID] Auto re-centering grid...');
                await this.startGrid(this.coin, currentPrice);
            }
        }
    }

    async checkRangeBound(currentPrice) {
        if (!this.active || !this.basePrice) return false;

        const movePct = Math.abs((currentPrice - this.basePrice) / this.basePrice) * 100;

        if (movePct >= this.rangeBoundPct) {
            this.logger.warn(`[GRID] Range breached! ${movePct.toFixed(2)}% move`);
            return true; // Just detect — do NOT call stopGrid here
        }
        return false;
    }

    _startUpdateLoop() {
        if (this.updateInterval) clearInterval(this.updateInterval);

        this.updateInterval = setInterval(async () => {
            try {
                const price = await this._withRetry(() => this.wayfinder.getPrice(this.coin));
                if (price) {
                    await this.update(price); // Let update() own the _updating lock
                }
            } catch (e) {
                this.logger?.error?.(`[GRID] Update loop error: ${e.message}`);
            }
        }, this.updateIntervalMs);
    }

    _stopUpdateLoop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * Get grid status summary
     * @returns {Promise<Object>} Grid status
     */
    async getStatus() {
        const position = Number(await this._withRetry(() => this.wayfinder.getPositionSize(this.coin))) || 0;
        const unrealizedPnl = Number(await this._withRetry(() => this.wayfinder.getUnrealizedPnl(this.coin))) || 0;

        return {
            active: this.active,
            coin: this.coin,
            basePrice: this.basePrice,
            gridLevels: this.gridLevels,
            spacingPct: this.gridSpacingPct,
            openOrders: this.gridOrders.size,
            filledOrders: this.filledOrders.length,
            totalPnL: this.totalPnL,
            capitalUsed: this.getCurrentCapitalUsage?.() || 0,
            currentPosition: position,
            unrealizedPnL: unrealizedPnl,
            lastUpdate: Date.now()
        };
    }

    /**
     * Get current capital usage (H5 fix)
     * Tracks capital usage after rebalancing
     * @returns {number} Total capital currently used by grid orders
     */
    getCurrentCapitalUsage() {
        let total = 0;

        for (const order of this.gridOrders.values()) {
            // Use actual order price if available, otherwise fall back to baseAmount
            const price = order.price || 0;
            const size = order.size || (this.baseAmount / price);

            if (price > 0 && size > 0) {
                total += size * price;
            } else {
                total += this.baseAmount;
            }
        }

        return total;
    }

    /**
     * Retry wrapper with exponential backoff
     * @param {Function} fn - Async function to retry
     * @param {number} maxRetries - Maximum retry attempts
     * @param {number} baseDelayMs - Base delay in milliseconds
     * @returns {Promise<any>} - Result of fn()
     */
    async _withRetry(fn, maxRetries = 3, baseDelayMs = 800) {
        if (maxRetries < 1) {
            throw new Error("maxRetries must be at least 1");
        }

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                const delay = baseDelayMs * attempt;
                this.logger?.warn?.(
                    `[GRID] Retry ${attempt}/${maxRetries} after error: ${error.message}. Waiting ${delay}ms...`
                );
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}

module.exports = GridStrategy;
