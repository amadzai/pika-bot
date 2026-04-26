export interface SizingInput {
  targetSize: number; // Shares target traded
  currentPrice: number; // Current market price (0..1)
  copyPct: number; // 1..100
  maxBetUsdc: number; // Cap USDC per trade
  tickSize: number; // Market tick, e.g. 0.01
  minOrderSize: number; // Market minimum order size
}

export interface SizingResult {
  shares: number;
  usdcCost: number;
  belowMinimum: boolean;
}

export function calculateSize(input: SizingInput): SizingResult {
  const rawShares = input.targetSize * (input.copyPct / 100);
  const maxShares = input.maxBetUsdc / input.currentPrice;
  const capped = Math.min(rawShares, maxShares);

  // Round DOWN to tick compliance. Use share-level rounding at 2-decimal
  // precision (Polymarket share sizes are typically to 2 decimals).
  const shares = Math.floor(capped * 100) / 100;
  const usdcCost = shares * input.currentPrice;
  const belowMinimum = shares < input.minOrderSize;

  return { shares, usdcCost, belowMinimum };
}
