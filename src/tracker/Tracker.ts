import { EventEmitter } from "node:events";
import { DataApiClient, type DataApiTradeActivity } from "../clients/dataApi.js";
import { SeenTrades } from "../state/SeenTrades.js";
import { logger } from "../logger.js";

export type TrackerEvents = {
  newTrade: [DataApiTradeActivity];
};

export class Tracker extends EventEmitter<TrackerEvents> {
  private timer: Timer | null = null;
  private running = false;
  private bootstrapped = false;

  constructor(
    private readonly dataApi: DataApiClient,
    private readonly seen: SeenTrades,
    private readonly targetAddress: string,
    private readonly pollIntervalMs: number,
  ) {
    super();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("[tracker] starting", {
      target: this.targetAddress,
      intervalMs: this.pollIntervalMs,
    });
    // Kick off immediately, then set interval
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      const trades = await this.dataApi.getActivity(this.targetAddress, 50);

      // On first run, mark ALL existing trades as seen without emitting.
      // Prevents replaying ancient trades on first bot startup.
      if (!this.bootstrapped) {
        for (const t of trades) {
          await this.seen.markPending(t.transactionHash);
          await this.seen.markExecuted(t.transactionHash);
        }
        this.bootstrapped = true;
        logger.info("[tracker] bootstrapped", { seenBacklog: trades.length });
        return;
      }

      // Reverse so oldest new trades emit first (Data API returns newest first)
      const newTrades: DataApiTradeActivity[] = [];
      for (const t of trades) {
        if (!this.seen.has(t.transactionHash)) newTrades.push(t);
      }
      newTrades.reverse();

      for (const trade of newTrades) {
        logger.info("[tracker] new trade detected", {
          tx: trade.transactionHash,
          side: trade.side,
          outcome: trade.outcome,
          size: trade.size,
          price: trade.price,
          title: trade.title,
        });
        this.emit("newTrade", trade);
      }
    } catch (err) {
      logger.error("[tracker] poll error", { err: String(err) });
    }
  }
}
