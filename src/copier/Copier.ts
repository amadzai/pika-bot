import { Side, OrderType, type ClobClient } from "@polymarket/clob-client";
import type { DataApiTradeActivity } from "../clients/dataApi.js";
import type { GammaClient } from "../clients/gamma.js";
import { SeenTrades } from "../state/SeenTrades.js";
import { OurPositions } from "../state/OurPositions.js";
import { isMarketTradeable, checkPriceDrift } from "./filters.js";
import { calculateSize } from "./sizing.js";
import { logger } from "../logger.js";
import type { Config } from "../config.js";

export class Copier {
  constructor(
    private readonly clob: ClobClient,
    private readonly gamma: GammaClient,
    private readonly seen: SeenTrades,
    private readonly positions: OurPositions,
    private readonly cfg: Config,
  ) {}

  async onNewTrade(trade: DataApiTradeActivity): Promise<void> {
    const tradeId = trade.transactionHash;
    const ctx = {
      tx: tradeId,
      side: trade.side,
      outcome: trade.outcome,
      size: trade.size,
      price: trade.price,
      title: trade.title ?? trade.slug,
    };

    // At-most-once: persist BEFORE executing. If we crash after this,
    // we miss this trade on restart (safer than doubling).
    await this.seen.markPending(tradeId);

    try {
      // 1. Resolve market metadata
      const market = await this.gamma.getMarketByConditionId(trade.conditionId);
      const marketCheck = isMarketTradeable(market);
      if (!marketCheck.ok || !market) {
        logger.warn("[copier] skip: market unavailable", { ...ctx, reason: marketCheck.reason });
        await this.seen.markExecuted(tradeId);
        return;
      }

      const tokenId = trade.asset; // Data API provides token id directly
      if (!tokenId) {
        logger.warn("[copier] skip: no tokenId in trade", ctx);
        await this.seen.markExecuted(tradeId);
        return;
      }

      // 2. Sell-mirroring guard: don't sell what we don't hold
      if (trade.side === "SELL" && !this.positions.has(tokenId)) {
        logger.info("[copier] skip: target sold token we don't hold", ctx);
        await this.seen.markExecuted(tradeId);
        return;
      }

      // 3. Price drift check
      const drift = await checkPriceDrift(
        this.clob,
        tokenId,
        trade.side,
        trade.price,
        this.cfg.MAX_PRICE_DRIFT_PCT,
      );
      if (!drift.ok) {
        logger.warn("[copier] skip: drift", {
          ...ctx,
          reason: drift.reason,
          currentPrice: drift.currentPrice,
        });
        await this.seen.markExecuted(tradeId);
        return;
      }

      // 4. Sizing
      const sizing = calculateSize({
        targetSize: trade.size,
        currentPrice: drift.currentPrice,
        copyPct: this.cfg.COPY_PERCENTAGE,
        maxBetUsdc: this.cfg.MAX_BET_USDC,
        tickSize: market.orderPriceMinTickSize,
        minOrderSize: market.orderMinSize,
      });

      if (sizing.belowMinimum || sizing.shares <= 0) {
        logger.warn("[copier] skip: size below minimum", {
          ...ctx,
          computedShares: sizing.shares,
          minOrderSize: market.orderMinSize,
        });
        await this.seen.markExecuted(tradeId);
        return;
      }

      // SELL: cap shares by what we actually hold
      let finalShares = sizing.shares;
      if (trade.side === "SELL") {
        const held = this.positions.getShares(tokenId);
        finalShares = Math.min(finalShares, held);
        if (finalShares < market.orderMinSize) {
          logger.warn("[copier] skip: sell size capped below min", {
            ...ctx,
            held,
            minOrderSize: market.orderMinSize,
          });
          await this.seen.markExecuted(tradeId);
          return;
        }
      }

      // 5. Execute (or dry-run)
      if (this.cfg.DRY_RUN) {
        logger.info("[copier] DRY_RUN would execute", {
          ...ctx,
          shares: finalShares,
          usdcCost: sizing.usdcCost,
          currentPrice: drift.currentPrice,
          negRisk: market.negRisk,
        });
        await this.positions.apply({
          tokenId,
          conditionId: market.conditionId,
          outcome: trade.outcome,
          side: trade.side,
          shares: finalShares,
        });
        await this.seen.markExecuted(tradeId);
        return;
      }

      const orderType = this.cfg.ORDER_TYPE === "FAK" ? OrderType.FAK : OrderType.FOK;
      const side = trade.side === "BUY" ? Side.BUY : Side.SELL;

      // For BUY: amount = USDC to spend. For SELL: amount = shares to sell.
      const amount =
        trade.side === "BUY" ? Number((finalShares * drift.currentPrice).toFixed(2)) : finalShares;

      const order = (await this.clob.createAndPostMarketOrder(
        { tokenID: tokenId, amount, side, orderType },
        {
          tickSize: String(market.orderPriceMinTickSize) as "0.01" | "0.001" | "0.0001" | "0.1",
          negRisk: market.negRisk,
        },
        orderType,
      )) as {
        success?: boolean;
        errorMsg?: string;
        orderID?: string;
        status?: string | number;
        orderHashes?: string[];
      };

      const posted = order.success === true && !order.errorMsg;

      if (!posted) {
        logger.error("[copier] order rejected", {
          ...ctx,
          errorMsg: order.errorMsg,
          status: order.status,
          shares: finalShares,
          amount,
        });
        await this.seen.markExecuted(tradeId);
        return;
      }

      logger.info("[copier] order posted", {
        ...ctx,
        orderId: order.orderID,
        orderHashes: order.orderHashes,
        shares: finalShares,
        amount,
      });

      await this.positions.apply({
        tokenId,
        conditionId: market.conditionId,
        outcome: trade.outcome,
        side: trade.side,
        shares: finalShares,
      });
      await this.seen.markExecuted(tradeId);
    } catch (err) {
      logger.error("[copier] execution failed", {
        ...ctx,
        err: err instanceof Error ? err.message : String(err),
      });
      // Do NOT markExecuted — leave as pending so we can inspect in logs,
      // but don't retry (already in seen set, won't re-emit).
    }
  }
}
