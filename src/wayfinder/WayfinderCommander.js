const { execSync } = require("child_process");

/**
 * WayfinderCommander - Synchronous wrappers for Wayfinder CLI operations.
 * All methods return null (or safe defaults) on failure.
 * Callers MUST null-check results.
 */
class WayfinderCommander {
  constructor(config = {}) {
    this.sdkPath = config.sdkPath || process.env.WAYFINDER_SDK_PATH || process.cwd();
    this.walletLabel = config.walletLabel || process.env.WAYFINDER_WALLET_LABEL || "main";
    this.logger = config.logger || console;
  }

  _exec(cmd) {
    try {
      const result = execSync(cmd, {
        encoding: "utf8",
        cwd: this.sdkPath,
        timeout: 30000,
      });
      return JSON.parse(result.trim());
    } catch (error) {
      this.logger.error(`[Wayfinder] Command failed: ${cmd} → ${error.message}`);
      return null;
    }
  }

  getAccountState() {
    return this._exec(`wayfinder resource wayfinder://hyperliquid/${this.walletLabel}/state`);
  }

  getPositions() {
    const state = this.getAccountState();
    return state?.asset_positions || [];
  }

  hasPosition(symbol) {
    return this.getPositions().some((p) => p.coin === symbol);
  }

  getPositionSize(symbol) {
    const position = this.getPositions().find((p) => p.coin === symbol);
    return position ? parseFloat(position.szi) : 0;
  }

  getUnrealizedPnl(symbol) {
    const position = this.getPositions().find((p) => p.coin === symbol);
    return position ? parseFloat(position.unrealized_pnl) : 0;
  }

  getPrice(symbol) {
    const result = this._exec(`wayfinder resource wayfinder://hyperliquid/prices/${symbol}`);
    return result && result.price ? parseFloat(result.price) : null;
  }

  getFundingRate(symbol) {
    const markets = this.getAllFundingRates();
    if (!Array.isArray(markets)) return null;
    const market = markets.find((m) => m.coin === symbol);
    return market ? parseFloat(market.funding_rate) : null;
  }

  getAllFundingRates() {
    return this._exec("wayfinder resource wayfinder://hyperliquid/markets");
  }

  getOrderBook(symbol, depth = 10) {
    return this._exec(`wayfinder resource wayfinder://hyperliquid/book/${symbol}?depth=${depth}`);
  }

  getAvailableMargin() {
    const state = this.getAccountState();
    const value = Number(state?.margin_summary?.account_value);
    return Number.isFinite(value) ? value : 0;
  }

  /**
   * Place a market order.
   * Either provide size OR both usdAmount + leverage.
   */
  placeMarketOrder({ coin, isBuy, size, usdAmount, leverage }) {
    let cmd = `wayfinder hyperliquid_execute --action place_order --wallet_label ${this.walletLabel} --coin ${coin} --is_spot false --is_buy ${isBuy}`;

    if (size) {
      cmd += ` --size ${size}`;
    } else if (usdAmount && leverage) {
      cmd += ` --usd_amount ${usdAmount} --usd_amount_kind margin --leverage ${leverage}`;
    } else {
      this.logger.error("[Wayfinder] placeMarketOrder: Must provide either size or usdAmount + leverage");
      return null;
    }

    return this._exec(cmd);
  }

  placeLimitOrder({ coin, isBuy, size, price }) {
    const cmd = `wayfinder hyperliquid_execute --action place_order --wallet_label ${this.walletLabel} --coin ${coin} --is_spot false --is_buy ${isBuy} --size ${size} --order_type limit --price ${price}`;
    return this._exec(cmd);
  }

  placeStopLoss({ coin, triggerPrice, size }) {
    const positionSize = this.getPositionSize(coin);
    const isBuy = positionSize < 0; // short → buy to close
    const cmd = `wayfinder hyperliquid_execute --action place_trigger_order --wallet_label ${this.walletLabel} --coin ${coin} --tpsl sl --trigger_price ${triggerPrice} --size ${size} --is_buy ${isBuy}`;
    return this._exec(cmd);
  }

  placeTakeProfit({ coin, triggerPrice, size }) {
    const positionSize = this.getPositionSize(coin);
    const isBuy = positionSize < 0;
    const cmd = `wayfinder hyperliquid_execute --action place_trigger_order --wallet_label ${this.walletLabel} --coin ${coin} --tpsl tp --trigger_price ${triggerPrice} --size ${size} --is_buy ${isBuy}`;
    return this._exec(cmd);
  }

  cancelOrder(coin, oid) {
    if (!coin || oid == null) {
      this.logger.error(`[Wayfinder] cancelOrder: missing coin or oid (coin=${coin}, oid=${oid})`);
      return null;
    }
    const cmd = `wayfinder hyperliquid_execute --action cancel_order --wallet_label ${this.walletLabel} --coin ${coin} --order_id ${oid}`;
    return this._exec(cmd);
  }

  /**
   * Best-effort open orders fetch.
   * Note: Direct CLI resource may be limited. GridStrategy should primarily rely on its local gridOrders Map.
   */
  getOpenOrders(coin = null) {
    try {
      // Attempt common patterns — adjust if your Wayfinder version exposes a better endpoint
      const result = this._exec(`wayfinder resource wayfinder://hyperliquid/${this.walletLabel}/open_orders`);
      if (Array.isArray(result)) {
        return coin ? result.filter(o => o.coin === coin) : result;
      }
      return [];
    } catch (e) {
      this.logger.warn("[Wayfinder] getOpenOrders not fully supported via CLI — using local tracking recommended");
      return [];
    }
  }

  closePosition(coin) {
    const size = Math.abs(this.getPositionSize(coin));
    if (size === 0) {
      this.logger.info(`[Wayfinder] No position in ${coin} to close`);
      return null;
    }
    const isBuy = this.getPositionSize(coin) < 0;
    return this.placeMarketOrder({ coin, isBuy, size });
  }

  setLeverage(coin, leverage) {
    const cmd = `wayfinder hyperliquid_execute --action update_leverage --wallet_label ${this.walletLabel} --coin ${coin} --leverage ${leverage}`;
    return this._exec(cmd);
  }

  getSummary() {
    const state = this.getAccountState();
    const positions = this.getPositions();

    const acct = Number(state?.margin_summary?.account_value);
    const used = Number(state?.margin_summary?.margin_used);

    const accountValue = Number.isFinite(acct) ? acct : 0;
    const marginUsed = Number.isFinite(used) ? used : 0;

    return {
      wallet: this.walletLabel,
      accountValue,
      marginUsed,
      availableMargin: accountValue - marginUsed, // Safe because both are already guarded
      positionCount: positions.length,
      positions: positions.map((p) => ({
        coin: p.coin,
        size: parseFloat(p.szi) || 0,
        entryPrice: parseFloat(p.entry_px) || 0,
        unrealizedPnl: parseFloat(p.unrealized_pnl) || 0,
        liquidationPrice: parseFloat(p.liquidation_px) || 0,
      })),
    };
  }

  printSummary() {
    const s = this.getSummary();

    console.log("\n╔════════════════════════════════════════╗");
    console.log("║     Hyperliquid Account Summary        ║");
    console.log("╚════════════════════════════════════════╝");
    console.log(`Wallet:           ${s.wallet}`);
    console.log(`Account Value:    $${s.accountValue.toFixed(2)}`);
    console.log(`Available Margin: $${s.availableMargin.toFixed(2)}`);
    console.log(`Margin Used:      $${s.marginUsed.toFixed(2)}`);
    console.log(`Positions:        ${s.positionCount}`);

    if (s.positions.length > 0) {
      console.log("\nOpen Positions:");
      s.positions.forEach((p) => {
        const direction = p.size > 0 ? "LONG" : "SHORT";
        console.log(
          `  ${p.coin}: ${direction} ${Math.abs(p.size)} @ $${p.entryPrice.toFixed(2)} | PnL: $${p.unrealizedPnl.toFixed(2)}`
        );
      });
    }
    console.log("");
  }
}

module.exports = WayfinderCommander;
