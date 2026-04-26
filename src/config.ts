import { z } from "zod";

const ConfigSchema = z.object({
  // Target
  TARGET_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "TARGET_ADDRESS must be a 0x-prefixed 40-char hex address"),

  // Credentials
  PRIVATE_KEY: z
    .string()
    .regex(
      /^(0x)?[a-fA-F0-9]{64}$/,
      "PRIVATE_KEY must be a 64-char hex string (0x prefix optional)",
    ),
  FUNDER_ADDRESS: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "FUNDER_ADDRESS must be a 0x-prefixed 40-char hex address (Polymarket proxy wallet, not EOA)",
    ),
  // 0 = EOA (funder=signer). 1 = legacy Polymarket proxy. 2 = Gnosis Safe proxy (current default).
  // If unset: funder===signer -> 0, else 2.
  SIGNATURE_TYPE: z.coerce.number().int().min(0).max(2).optional(),

  // Copy settings
  MAX_BET_USDC: z.coerce.number().positive(),
  COPY_PERCENTAGE: z.coerce.number().min(1).max(100),
  MAX_PRICE_DRIFT_PCT: z.coerce.number().min(0).max(100).default(3),
  ORDER_TYPE: z.enum(["FOK", "FAK"]).default("FOK"),

  // Timing
  POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(2500),

  // Optional
  GEO_BLOCK_TOKEN: z.string().optional(),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1")
    .pipe(z.boolean()),

  // Storage
  DATA_DIR: z.string().default("./data"),

  // CLOB / chain
  CLOB_HOST: z.string().default("https://clob.polymarket.com"),
  DATA_API_HOST: z.string().default("https://data-api.polymarket.com"),
  GAMMA_API_HOST: z.string().default("https://gamma-api.polymarket.com"),
  CHAIN_ID: z.coerce.number().default(137), // Polygon
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[config] Invalid environment:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  const cfg = parsed.data;
  // Normalize PK with 0x prefix
  if (!cfg.PRIVATE_KEY.startsWith("0x")) {
    cfg.PRIVATE_KEY = "0x" + cfg.PRIVATE_KEY;
  }
  return cfg;
}
