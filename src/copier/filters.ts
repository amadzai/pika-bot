import type { ClobClient } from "@polymarket/clob-client";
import { Side } from "@polymarket/clob-client";
import type { GammaMarket } from "../clients/gamma.js";

export interface MarketCheck {
  ok: boolean;
  reason?: string;
}

export function isMarketTradeable(market: GammaMarket | null): MarketCheck {
  if (!market) return { ok: false, reason: "market not found" };
  if (market.closed) return { ok: false, reason: "market closed" };
  if (!market.active) return { ok: false, reason: "market inactive" };
  if (!market.acceptingOrders) return { ok: false, reason: "not accepting orders" };
  return { ok: true };
}

export interface PriceDriftCheck {
  ok: boolean;
  currentPrice: number;
  driftPct: number;
  reason?: string;
}

export async function checkPriceDrift(
  client: ClobClient,
  tokenId: string,
  side: "BUY" | "SELL",
  targetFillPrice: number,
  maxDriftPct: number,
): Promise<PriceDriftCheck> {
  // Use the side we'd execute against. BUY = ask (we pay), SELL = bid (we receive).
  const sideEnum = side === "BUY" ? Side.BUY : Side.SELL;
  const priceResp = await client.getPrice(tokenId, sideEnum);
  // clob-client returns { price: "0.52" } typically
  const currentPrice = parsePrice(priceResp);
  if (currentPrice <= 0) {
    return { ok: false, currentPrice: 0, driftPct: 0, reason: "no current price" };
  }
  const driftPct = (Math.abs(currentPrice - targetFillPrice) / targetFillPrice) * 100;
  if (driftPct > maxDriftPct) {
    return {
      ok: false,
      currentPrice,
      driftPct,
      reason: `price drift ${driftPct.toFixed(2)}% > ${maxDriftPct}% threshold`,
    };
  }
  return { ok: true, currentPrice, driftPct };
}

function parsePrice(resp: unknown): number {
  if (typeof resp === "number") return resp;
  if (typeof resp === "string") return Number(resp);
  if (resp && typeof resp === "object" && "price" in resp) {
    const p = (resp as { price: unknown }).price;
    return typeof p === "string" ? Number(p) : typeof p === "number" ? p : 0;
  }
  return 0;
}
