import type { Good, TraderOffer, Weather } from '../types';

/** FNV-1a hash of a date string → 32-bit seed. */
export const hashDay = (dateStr: string): number => {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i += 1) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** mulberry32 PRNG — a small, fast, deterministic generator. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * The day's weather, rolled from the date string: sunny 45% · rain 30% ·
 * clear 20% · harvest moon 5%. Deterministic — the same date always rolls the
 * same weather. Uses an independent seed stream from the trader offers.
 */
export const weatherForDay = (dateStr: string): Weather => {
  const r = mulberry32(hashDay(`${dateStr}:weather`))();
  if (r < 0.45) return 'sunny';
  if (r < 0.75) return 'rain';
  if (r < 0.95) return 'clear';
  return 'harvestmoon';
};

/** Swap templates, priced slightly in the player's favour vs the market. */
const SWAP_TABLE: ReadonlyArray<{
  give: Good;
  giveQty: number;
  get: Good;
  getQty: number;
}> = [
  { give: 'logs', giveQty: 6, get: 'bricks', getQty: 4 },
  { give: 'wheat', giveQty: 8, get: 'flour', getQty: 5 },
  { give: 'stone', giveQty: 6, get: 'planks', getQty: 4 },
  { give: 'flour', giveQty: 5, get: 'planks', getQty: 4 },
  { give: 'planks', giveQty: 5, get: 'bricks', getQty: 4 },
  { give: 'wheat', giveQty: 7, get: 'logs', getQty: 5 },
  { give: 'logs', giveQty: 7, get: 'stone', getQty: 5 },
  { give: 'stone', giveQty: 8, get: 'flour', getQty: 5 },
];

const GOLDEN_ROOF_COST = 20;

/**
 * The day's global trader offers, deterministic per date string. `count` offers
 * are generated (3 by default; the Village Hall's `traderOffers` perk raises it
 * to 4). All but the last slot are good-for-good swaps; the last slot has a 15%
 * chance of being the rare golden-roof cosmetic (20 planks). The same date +
 * count always yields the same leading offers (extra slots extend the stream).
 */
export const offersForDay = (dateStr: string, count = 3): TraderOffer[] => {
  const n = Math.max(1, Math.floor(count));
  const rand = mulberry32(hashDay(`${dateStr}:trader`));
  const offers: TraderOffer[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = SWAP_TABLE[Math.floor(rand() * SWAP_TABLE.length)]!;
    offers.push({
      give: { good: t.give, qty: t.giveQty },
      get: { good: t.get, qty: t.getQty },
    });
  }
  if (rand() < 0.15) {
    offers[n - 1] = {
      give: { good: 'planks', qty: GOLDEN_ROOF_COST },
      get: { cosmetic: 'golden-roof' },
    };
  }
  return offers;
};
