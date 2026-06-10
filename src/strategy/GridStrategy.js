const config = require("config");

class GridStrategy {
    constructor(logger, wayfinder) {
        this.logger = logger || console;
        this.wayfinder = wayfinder;

        const g = config.get("trading.grid") || {};
        this.gridLevels = Number(g.levels) || 8;
        this.gridSpacingPct = Number(g.spacingPct) || 0.8;
        this.baseAmount = Number(g.baseAmount) || 50;
        this.maxGridCapital = Number(g.maxGridCapital) || 2000;
        this.rangeBoundPct = Number(g.rangeBoundPct) || 5.0;

        this.active = false;
        this.coin = null;
        this.basePrice = null;
        this.gridOrders = new Map();
    }

    async startGrid(coin = "BTC") {
        if (this.active) return "Grid already running on " + this.coin;

        const price = await this.wayfinder.getLatestPrice(coin);
        if (!Number.isFinite(price) || price <= 0) return "No valid price";

        this.coin = coin;
        this.basePrice = price;
        this.active = true;
        this.gridOrders.clear();

        this.logger.info("Grid started on " + coin + " @ $" + price.toFixed(2));

        const placed = [];
        try {
            for (let i = 1; i <= this.gridLevels; i++) {
                const buyPrice = this.basePrice * (1 - (i * this.gridSpacingPct / 100));
                const sellPrice = this.basePrice * (1 + (i * this.gridSpacingPct / 100));

                const buy = await this.wayfinder.placeGridOrder(coin, "BUY", buyPrice, this.baseAmount);
                if (buy && buy.orderId) this.gridOrders.set(buy.orderId, {side:"BUY", price:buyPrice});

                const sell = await this.wayfinder.placeGridOrder(coin, "SELL", sellPrice, this.baseAmount);
                if (sell && sell.orderId) this.gridOrders.set(sell.orderId, {side:"SELL", price:sellPrice});
            }
        } catch (e) {
            await this.wayfinder.cancelAllOrders(coin).catch(() => {});
            this.active = false;
            return "Grid build failed: " + e.message;
        }

        return "Grid active on " + coin;
    }

    async stopGrid() {
        if (!this.active) return "Grid not active";
        this.active = false;
        const coin = this.coin;

        await this.wayfinder.cancelAllOrders(coin).catch(() => {});

        const pos = await this.wayfinder.getOpenPosition?.(coin);
        if (pos && Math.abs(pos.size) > 0) {
            await this.wayfinder.closePosition?.(coin);
        }

        this.gridOrders.clear();
        return "Grid stopped and flattened on " + coin;
    }

    async checkRangeBound(currentPrice) {
        if (!this.active || !this.basePrice) return false;
        const movePct = Math.abs((currentPrice - this.basePrice) / this.basePrice) * 100;
        if (movePct >= this.rangeBoundPct) {
            this.logger.warn("Range bound breached - stopping grid");
            await this.stopGrid();
            return true;
        }
        return false;
    }
}

module.exports = GridStrategy;
