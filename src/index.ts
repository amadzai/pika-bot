import { loadConfig } from "./config.js";
import { initClobClient } from "./clients/clob.js";
import { DataApiClient } from "./clients/dataApi.js";
import { GammaClient } from "./clients/gamma.js";
import { SeenTrades } from "./state/SeenTrades.js";
import { OurPositions } from "./state/OurPositions.js";
import { Tracker } from "./tracker/Tracker.js";
import { Copier } from "./copier/Copier.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.info("[pika-bot] starting", {
    target: cfg.TARGET_ADDRESS,
    maxBetUsdc: cfg.MAX_BET_USDC,
    copyPct: cfg.COPY_PERCENTAGE,
    driftPct: cfg.MAX_PRICE_DRIFT_PCT,
    orderType: cfg.ORDER_TYPE,
    pollMs: cfg.POLL_INTERVAL_MS,
    dryRun: cfg.DRY_RUN,
  });

  const clob = await initClobClient(cfg);
  const dataApi = new DataApiClient(cfg);
  const gamma = new GammaClient(cfg);

  const seen = new SeenTrades(cfg.DATA_DIR);
  await seen.load();
  const positions = new OurPositions(cfg.DATA_DIR);
  await positions.load();

  const copier = new Copier(clob, gamma, seen, positions, cfg);
  const tracker = new Tracker(dataApi, seen, cfg.TARGET_ADDRESS, cfg.POLL_INTERVAL_MS);

  tracker.on("newTrade", (trade) => {
    void copier.onNewTrade(trade);
  });

  tracker.start();

  // Graceful shutdown
  const shutdown = (sig: string) => {
    logger.info(`[pika-bot] received ${sig}, shutting down`);
    tracker.stop();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error("[pika-bot] unhandled rejection", { reason: String(reason) });
  });
  process.on("uncaughtException", (err) => {
    logger.error("[pika-bot] uncaught exception", { err: err.message, stack: err.stack });
  });
}

void main().catch((err) => {
  logger.error("[pika-bot] fatal", {
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
