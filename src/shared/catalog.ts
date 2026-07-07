import type { BuildingCategory, BuildingId, Tier } from './types';

export type BuildingSpec = {
  id: BuildingId;
  name: string;
  category: BuildingCategory;
  unlockLevel: number;
  cost: number;
  ratePerMin: number;
  cap: number;
  buildSeconds: number;
};

export const CATALOG: Record<BuildingId, BuildingSpec> = {
  cottage: {
    id: 'cottage',
    name: 'Cottage',
    category: 'coins',
    unlockLevel: 1,
    cost: 40,
    ratePerMin: 3,
    cap: 90,
    buildSeconds: 20,
  },
  bakery: {
    id: 'bakery',
    name: 'Bakery',
    category: 'coins',
    unlockLevel: 1,
    cost: 90,
    ratePerMin: 6,
    cap: 180,
    buildSeconds: 45,
  },
  garden: {
    id: 'garden',
    name: 'Herb Garden',
    category: 'supplies',
    unlockLevel: 1,
    cost: 60,
    ratePerMin: 2,
    cap: 60,
    buildSeconds: 30,
  },
  market: {
    id: 'market',
    name: 'Market Stall',
    category: 'coins',
    unlockLevel: 2,
    cost: 200,
    ratePerMin: 11,
    cap: 330,
    buildSeconds: 90,
  },
  sawmill: {
    id: 'sawmill',
    name: 'Sawmill',
    category: 'supplies',
    unlockLevel: 3,
    cost: 260,
    ratePerMin: 4,
    cap: 120,
    buildSeconds: 120,
  },
  tavern: {
    id: 'tavern',
    name: 'Tavern',
    category: 'coins',
    unlockLevel: 4,
    cost: 450,
    ratePerMin: 20,
    cap: 600,
    buildSeconds: 180,
  },
  lantern: {
    id: 'lantern',
    name: 'Lantern Post',
    category: 'decor',
    unlockLevel: 2,
    cost: 120,
    ratePerMin: 0,
    cap: 0,
    buildSeconds: 15,
  },
  topiary: {
    id: 'topiary',
    name: 'Topiary',
    category: 'decor',
    unlockLevel: 4,
    cost: 300,
    ratePerMin: 0,
    cap: 0,
    buildSeconds: 30,
  },
  mill: {
    id: 'mill',
    name: 'Windmill',
    category: 'coins',
    unlockLevel: 6,
    cost: 900,
    ratePerMin: 34,
    cap: 1000,
    buildSeconds: 300,
  },
  forge: {
    id: 'forge',
    name: 'Forge',
    category: 'supplies',
    unlockLevel: 7,
    cost: 800,
    ratePerMin: 7,
    cap: 210,
    buildSeconds: 300,
  },
  manor: {
    id: 'manor',
    name: 'Manor',
    category: 'coins',
    unlockLevel: 9,
    cost: 1600,
    ratePerMin: 55,
    cap: 1650,
    buildSeconds: 480,
  },
  fountain: {
    id: 'fountain',
    name: 'Mossy Fountain',
    category: 'decor',
    unlockLevel: 8,
    cost: 700,
    ratePerMin: 0,
    cap: 0,
    buildSeconds: 60,
  },
};

export type TierStats = {
  cost: number;
  ratePerMin: number;
  cap: number;
  buildSeconds: number;
};

const TIER_MULTIPLIERS: Record<
  Tier,
  { cost: number; ratePerMin: number; cap: number; buildSeconds: number }
> = {
  1: { cost: 1, ratePerMin: 1, cap: 1, buildSeconds: 1 },
  2: { cost: 2.5, ratePerMin: 2.2, cap: 2, buildSeconds: 2 },
  3: { cost: 6, ratePerMin: 4, cap: 3.5, buildSeconds: 4 },
};

export const tierStats = (spec: BuildingSpec, tier: Tier): TierStats => {
  const m = TIER_MULTIPLIERS[tier];
  return {
    cost: Math.round(spec.cost * m.cost),
    ratePerMin: Math.round(spec.ratePerMin * m.ratePerMin),
    cap: Math.round(spec.cap * m.cap),
    buildSeconds: Math.round(spec.buildSeconds * m.buildSeconds),
  };
};

export const LANDMARK_THRESHOLDS: number[] = [300, 900, 2000, 4000, 7500];
export const GRID_SIZE: number = 18;
export const MAX_LEVEL: number = 15;
export const PLOT_LEVELS: number[] = [1, 3, 5, 8, 12];
/** Neighbour boosts a player may hand out per UTC day. */
export const BOOST_DAILY_LIMIT: number = 5;
