import {
  PriceTier,
  PricingConfig,
  DEFAULT_PRICING_CONFIG,
} from "./types.js";

const TIER_ORDER: PriceTier[] = [
  PriceTier.Base,
  PriceTier.Warm,
  PriceTier.Hot,
  PriceTier.Scorching,
];

function tierIndex(tier: PriceTier): number {
  return TIER_ORDER.indexOf(tier);
}

/**
 * Determine the price tier for a given numeric distance.
 * Tiers are evaluated from tightest (smallest maxDistance) to widest.
 */
export function determinePriceTier(
  numericDistance: bigint,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): PriceTier {
  // Sort tiers by maxDistance ascending so we match the tightest bracket first
  const sorted = [...config.tiers].sort((a, b) =>
    a.maxDistance < b.maxDistance ? -1 : a.maxDistance > b.maxDistance ? 1 : 0,
  );

  for (const t of sorted) {
    if (numericDistance <= t.maxDistance) {
      return t.tier;
    }
  }
  return PriceTier.Base;
}

/**
 * Compute the buy-in (in wei) for a given numeric distance.
 */
export function computeBuyIn(
  numericDistance: bigint,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): bigint {
  const tier = determinePriceTier(numericDistance, config);
  const tierDef = config.tiers.find((t) => t.tier === tier)!;
  return config.baseBuyIn * BigInt(tierDef.multiplier);
}

/**
 * Check whether the price should escalate.
 * Price only goes UP, never drops.
 */
export function shouldUpdatePrice(
  currentTier: PriceTier,
  newDistance: bigint,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): boolean {
  const newTier = determinePriceTier(newDistance, config);
  return tierIndex(newTier) > tierIndex(currentTier);
}

/**
 * Get the multiplier for a given tier.
 */
export function getMultiplier(
  tier: PriceTier,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): number {
  return config.tiers.find((t) => t.tier === tier)?.multiplier ?? 1;
}
