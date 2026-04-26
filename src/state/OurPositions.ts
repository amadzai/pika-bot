import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { logger } from "../logger.js";

interface Position {
  tokenId: string;
  shares: number;
  conditionId: string;
  outcome: string;
  updatedAt: number;
}

export class OurPositions {
  private readonly filePath: string;
  private readonly map = new Map<string, Position>();

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "our-positions.json");
  }

  async load(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const file = Bun.file(this.filePath);
    if (!(await file.exists())) {
      logger.info("[positions] no prior state, starting fresh");
      return;
    }

    try {
      const raw = (await file.json()) as Record<string, Position>;
      for (const [k, v] of Object.entries(raw)) this.map.set(k, v);
      logger.info("[positions] loaded", { count: this.map.size });
    } catch (err) {
      logger.error("[positions] failed to parse, starting fresh", { err: String(err) });
    }
  }

  has(tokenId: string): boolean {
    const p = this.map.get(tokenId);
    return !!p && p.shares > 0;
  }

  getShares(tokenId: string): number {
    return this.map.get(tokenId)?.shares ?? 0;
  }

  async apply(args: {
    tokenId: string;
    conditionId: string;
    outcome: string;
    side: "BUY" | "SELL";
    shares: number;
  }): Promise<void> {
    const existing = this.map.get(args.tokenId);
    const delta = args.side === "BUY" ? args.shares : -args.shares;
    const nextShares = Math.max(0, (existing?.shares ?? 0) + delta);

    if (nextShares === 0) {
      this.map.delete(args.tokenId);
    } else {
      this.map.set(args.tokenId, {
        tokenId: args.tokenId,
        shares: nextShares,
        conditionId: args.conditionId,
        outcome: args.outcome,
        updatedAt: Date.now(),
      });
    }
    await this.flush();
  }

  private async flush(): Promise<void> {
    const obj: Record<string, Position> = {};
    for (const [k, v] of this.map) obj[k] = v;
    await Bun.write(this.filePath, JSON.stringify(obj, null, 2));
  }
}
