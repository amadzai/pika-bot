import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { logger } from "../logger.js";

const PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Entry {
  seenAt: number;
  executed: boolean;
}

export class SeenTrades {
  private readonly filePath: string;
  private readonly map = new Map<string, Entry>();

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "seen-trades.json");
  }

  async load(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const file = Bun.file(this.filePath);
    if (!(await file.exists())) {
      logger.info("[seen-trades] no prior state, starting fresh");
      return;
    }

    try {
      const raw = (await file.json()) as Record<string, Entry>;
      const now = Date.now();
      let pruned = 0;
      for (const [id, entry] of Object.entries(raw)) {
        if (now - entry.seenAt > PRUNE_AGE_MS) {
          pruned++;
          continue;
        }
        this.map.set(id, entry);
      }
      logger.info("[seen-trades] loaded", { loaded: this.map.size, pruned });
    } catch (err) {
      logger.error("[seen-trades] failed to parse, starting fresh", { err: String(err) });
    }
  }

  has(tradeId: string): boolean {
    return this.map.has(tradeId);
  }

  /** Mark pending and flush immediately. At-most-once safety guard. */
  async markPending(tradeId: string): Promise<void> {
    this.map.set(tradeId, { seenAt: Date.now(), executed: false });
    await this.flush();
  }

  async markExecuted(tradeId: string): Promise<void> {
    const entry = this.map.get(tradeId);
    if (!entry) return;
    entry.executed = true;
    await this.flush();
  }

  private async flush(): Promise<void> {
    const obj: Record<string, Entry> = {};
    for (const [k, v] of this.map) obj[k] = v;
    await Bun.write(this.filePath, JSON.stringify(obj, null, 2));
  }
}
