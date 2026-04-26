import type { Config } from "../config.js";

export interface GammaMarket {
  conditionId: string;
  slug: string;
  question: string;
  outcomes: string; // JSON-encoded array, e.g. '["Yes", "No"]'
  clobTokenIds: string; // JSON-encoded array of token IDs
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  orderPriceMinTickSize: number;
  orderMinSize: number;
  negRisk: boolean;
  lastTradePrice?: number;
}

export class GammaClient {
  private readonly host: string;
  private readonly cache = new Map<string, { data: GammaMarket; fetchedAt: number }>();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(cfg: Config) {
    this.host = cfg.GAMMA_API_HOST;
  }

  async getMarketByConditionId(conditionId: string): Promise<GammaMarket | null> {
    const cached = this.cache.get(conditionId);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.data;
    }

    const url = new URL("/markets", this.host);
    url.searchParams.set("condition_ids", conditionId);
    url.searchParams.set("limit", "1");

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new Error(`Gamma API ${res.status}: ${await res.text()}`);
    }
    const arr = (await res.json()) as GammaMarket[];
    const market = arr[0] ?? null;
    if (market) this.cache.set(conditionId, { data: market, fetchedAt: Date.now() });
    return market;
  }

  resolveTokenId(market: GammaMarket, outcomeIndex: number): string | null {
    try {
      const ids = JSON.parse(market.clobTokenIds) as string[];
      return ids[outcomeIndex] ?? null;
    } catch {
      return null;
    }
  }
}
