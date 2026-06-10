/**
 * Adapter over model-router's WayfinderAgent.
 * Return shapes CONFIRMED (sed 309-357):
 * getAccountEquity() -> bare Number (USD) or null
 * getOpenPosition() -> normalized:
 * { coin, side:"LONG"|"SHORT", size, entryPrice, positionValue,
 * unrealizedPnl (USD), unrealizedPnlPercent (% of NOTIONAL, not equity!),
 * leverage, liquidationPrice }
 *
 * CRITICAL: the agent's unrealizedPnlPercent is % of NOTIONAL.
 * The breaker needs % of EQUITY. We compute it here from unrealizedPnl/equity.
 */
class WayfinderAdapter {
    constructor(wayfinder, logger = console) {
        this.wf = wayfinder;
        this.logger = logger;
    }

    // getAccountEquity() returns a bare Number (USD) or null. CONFIRMED.
    async equity() {
        try {
            const e = await this.wf.getAccountEquity();
            const n = Number(e);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch (err) {
            this.logger.error("equity() failed: " + err.message);
            return null;
        }
    }

    // getLatestPrice is SYNC (line 264). Do NOT await.
    price(coin) {
        try {
            const p = Number(this.wf.getLatestPrice(coin));
            return Number.isFinite(p) && p > 0 ? p : null;
        } catch {
            return null;
        }
    }

    /**
     * Returns { side, entryPrice, currentPnl, size } where
     * currentPnl = unrealized PnL as SIGNED % of EQUITY (breaker units).
     *
     * Pass `equity` in so we convert the agent's USD unrealizedPnl correctly.
     * If equity is missing, currentPnl = null (caller must refuse to trade).
     */
    async position(coin, equity) {
        try {
            const p = await this.wf.getOpenPosition(coin);
            if (!p) return { side: null, entryPrice: null, currentPnl: 0, size: 0 };

            // CONFIRMED keys from the normalized return object:
            const side = p.side === "LONG" || p.side === "SHORT" ? p.side : null;
            const entryPrice = Number(p.entryPrice);
            const uPnlUsd = Number(p.unrealizedPnl);
            const size = Number(p.size);

            // currentPnl = % of EQUITY (NOT the agent's % of notional).
            let currentPnl = null;
            if (Number.isFinite(uPnlUsd) && Number.isFinite(equity) && equity > 0) {
                currentPnl = (uPnlUsd / equity) * 100;
            } else {
                this.logger.warn(
                    "position(): cannot compute %-of-equity currentPnl for " + coin +
                    " (uPnlUsd=" + uPnlUsd + " equity=" + equity + ") - breaker would be blind"
                );
            }

            return {
                side,
                entryPrice: Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : null,
                currentPnl, // null = could not derive -> refuse to trade
                size: Number.isFinite(size) ? size : 0,
                // keep the agent's notional-% for logging/comparison only:
                _notionalPnlPct: Number(p.unrealizedPnlPercent),
                _liqPrice: Number(p.liquidationPrice),
                _leverage: Number(p.leverage),
            };
        } catch (err) {
            this.logger.error("position() failed: " + err.message);
            return { side: null, entryPrice: null, currentPnl: null, size: 0 };
        }
    }

    async candles(coin, interval, limit) {
        try {
            const c = await this.wf.getHistoricalCandles(coin, interval, limit);
            return Array.isArray(c) ? c : null;
        } catch (err) {
            this.logger.error("candles() failed: " + err.message);
            return null;
        }
    }
}

module.exports = { WayfinderAdapter };
