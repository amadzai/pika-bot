import { ClobClient, Chain, Side, OrderType, type ApiKeyCreds } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { logger } from "../logger.js";
import type { Config } from "../config.js";

export { Side, OrderType };
export type { ApiKeyCreds };

export async function initClobClient(cfg: Config): Promise<ClobClient> {
  const signer = new Wallet(cfg.PRIVATE_KEY);
  logger.info("[clob] initializing client", {
    signerAddress: signer.address,
    funder: cfg.FUNDER_ADDRESS,
  });

  // L1 phase: bootstrap client with just the signer to derive API creds
  const bootstrap = new ClobClient(cfg.CLOB_HOST, cfg.CHAIN_ID as Chain, signer);
  const creds = await bootstrap.createOrDeriveApiKey();
  logger.info("[clob] API key derived", { apiKey: creds.key.slice(0, 8) + "..." });

  // L2 phase: full client with credentials + funder for order signing
  // 0 = EOA. 1 = legacy Polymarket proxy. 2 = Gnosis Safe proxy (current default).
  const autoType = cfg.FUNDER_ADDRESS.toLowerCase() === signer.address.toLowerCase() ? 0 : 2;
  const signatureType = cfg.SIGNATURE_TYPE ?? autoType;
  logger.info("[clob] signature type", {
    signatureType,
    auto: cfg.SIGNATURE_TYPE === undefined,
  });

  const client = new ClobClient(
    cfg.CLOB_HOST,
    cfg.CHAIN_ID as Chain,
    signer,
    creds,
    signatureType,
    cfg.FUNDER_ADDRESS,
    cfg.GEO_BLOCK_TOKEN,
  );

  return client;
}
