import type { Config } from "../config.js";

// Polymarket Data API returns activity entries for any wallet, no auth.
// Response shape (subset) for type=TRADE:
export interface DataApiTradeActivity {
  proxyWallet: string; // Maker address (target's proxy)
  timestamp: number; // Unix seconds
  conditionId: string; // Market identifier
  type: "TRADE";
  size: number; // Shares
  usdcSize: number; // USDC value
  transactionHash: string; // Unique trade id
  price: number; // 0..1
  asset: string; // Token ID (ERC-1155 asset id)
  side: "BUY" | "SELL";
  outcomeIndex: number; // 0 or 1
  outcome: string; // "Yes" / "No"
  title?: string;
  slug?: string;
  name?: string;
}

export class DataApiClient {
  private readonly host: string;

  constructor(cfg: Config) {
    this.host = cfg.DATA_API_HOST;
  }

  async getActivity(user: string, limit = 50): Promise<DataApiTradeActivity[]> {
    const url = new URL("/activity", this.host);
    url.searchParams.set("user", user);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("type", "TRADE");

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new Error(`Data API /activity ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as DataApiTradeActivity[];
    return data;
  }
}
