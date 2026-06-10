/**
 * DRY_RUN BBRSI evaluation route. Places NO orders unless BBRSI_DRY_RUN=false
 * AND the WayfinderAgent dryRun arg is explicitly false (double gate).
 *
 * Wired to CONFIRMED WayfinderAgent shapes (sed 309-357):
 * equity() -> Number USD
 * position(coin, equity) -> { side, entryPrice, currentPnl(%-of-EQUITY), size,
 * _notionalPnlPct, _liqPrice, _leverage }
 * candles() -> array
 *
 * CRITICAL: currentPnl fed to the breaker is %-of-EQUITY, computed in the
 * adapter from unrealizedPnl/equity. The agent's unrealizedPnlPercent is
 * %-of-NOTIONAL and is kept only as _notionalPnlPct for diagnostics.
 */
const { WayfinderAdapter } = require("./wayfinderAdapter");

async function runBbrsi(strategy, wayfinder, opts = {}) {
    const logger = opts.logger || console;
    const coin = opts.coin || "BTC";
    const interval = opts.interval || "15m";
    const DRY_RUN = process.env.BBRSI_DRY_RUN !== "false"; // live ONLY if explicitly "false"

    const adapter = new WayfinderAdapter(wayfinder, logger);

    // 1) Candles
    const candles = await adapter.candles(coin, interval, 300);
    if (!candles || candles.length < 22) {
        return { ok: false, reason: "insufficient candles for " + coin + "/" + interval };
    }

    // 2) Real equity FIRST — needed to compute %-of-equity PnL, and to size.
    const equity = await adapter.equity();
    if (!Number.isFinite(equity) || equity <= 0) {
        logger.warn("[BBRSI] real equity unavailable - refusing (DRY or LIVE).");
        return { ok: false, reason: "real equity unavailable; refusing to size" };
    }

    // 3) Position — pass equity so currentPnl is %-of-EQUITY (breaker units).
    const pos = await adapter.position(coin, equity);

    // FAIL CLOSED: holding a position but currentPnl couldn't be derived.
    if (pos.side && pos.currentPnl === null) {
        logger.error(
            "[BBRSI] holding " + pos.side + " but currentPnl is null - breaker blind. REFUSING."
        );
        return { ok: false, reason: "currentPnl underivable while in position" };
    }
    if (pos.side && pos.entryPrice === null) {
        return { ok: false, reason: "open " + pos.side + " has no entryPrice" };
    }

    const currentPnl = pos.currentPnl === null ? 0 : pos.currentPnl; // flat => 0 is correct

    // 4) Evaluate
    let result;
    try {
        result = await strategy.evaluatePosition(
            candles,
            pos.side,
            equity,
            pos.entryPrice,
            currentPnl
        );
    } catch (e) {
        logger.error("[BBRSI] evaluatePosition threw: " + e.message);
        return { ok: false, reason: "eval error: " + e.message };
    }

    const sig = (result && result.signal) || "NONE";

    // 5) Diagnostic line. Show BOTH the %-of-equity currentPnl (what the breaker
    // sees) AND the agent's %-of-notional, so the leverage gap is visible.
    logger.info(
        "[BBRSI " + (DRY_RUN ? "DRY_RUN" : "LIVE") + "] " +
        coin + "/" + interval +
        " sig=" + sig +
        " reason=" + (result && result.reason) +
        " | equity=$" + equity.toFixed(2) +
        " pos=" + (pos.side || "FLAT") +
        (pos.side
            ? " @" + pos.entryPrice +
              " uPnL(eq)=" + currentPnl.toFixed(2) + "%" +
              " uPnL(notional)=" +
              (Number.isFinite(pos._notionalPnlPct) ? pos._notionalPnlPct.toFixed(2) : "n/a") + "%" +
              " lev=" + (Number.isFinite(pos._leverage) ? pos._leverage : "?") + "x"
            : "")
    );

    // 6) DRY_RUN: log intent, place nothing, return the decision.
    if (DRY_RUN) {
        if (sig === "LONG" || sig === "SHORT") {
            logger.info(
                "[BBRSI DRY_RUN] WOULD OPEN " + sig + " " + coin +
                " size=" + (result.positionSize ?? "?") +
                " stop=" + (result.stopLoss ?? "?") +
                " tp=" + (result.takeProfit ?? "?")
            );
        } else if (sig === "CLOSE_LONG" || sig === "CLOSE_SHORT") {
            logger.info(
                "[BBRSI DRY_RUN] WOULD CLOSE " + coin +
                " reason=" + (result && result.reason)
            );
        }
        return { ok: true, dryRun: true, signal: sig, result, equity, position: pos };
    }

    // 7) LIVE path — intentionally NOT wired to execution yet.
    // Before enabling, the executor MUST (per docs/EXECUTOR_CONTRACT.md):
    // - place/close via wayfinder.*(..., /* dryRun */ false)
    // - after a CLOSE fill, call:
    //   strategy.notifyExit(fillTs, /* realizedPnl */ undefined, {
    //       side: pos.side, entryPrice: pos.entryPrice, exitPrice: fillPrice
    //   })
    //   so dailyRealizedPnl updates and the force-close latch clears.
    logger.warn(
        "[BBRSI] LIVE signal " + sig + " for " + coin +
        " - executor not wired; placing nothing. See EXECUTOR_CONTRACT.md."
    );
    return { ok: true, dryRun: false, signal: sig, result, executorWired: false };
}

module.exports = { runBbrsi };
