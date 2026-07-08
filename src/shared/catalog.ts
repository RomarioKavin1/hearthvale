import type { BuildingId, BuildingRole, Good, Tier, VillageTheme } from './types';

export type BuildingSpec = {
  id: BuildingId;
  name: string;
  role: BuildingRole;
  unlockLevel: number;
  cost: number;
  ratePerMin: number;
  cap: number;
  buildSeconds: number;
  /** Raw producers: the good produced each cycle. */
  good?: Good;
  /** Processors: the input good consumed from the stockpile and how much per
   * output unit (recipe run). */
  input?: { good: Good; per: number };
  /** Processors: what a recipe run yields — a processed good, or `coins`. */
  output?: Good | 'coins';
  /** Bakery only: coins minted per flour consumed (output === 'coins'). */
  coinsPerFlour?: number;
};

export const CATALOG: Record<BuildingId, BuildingSpec> = {
  cottage: {
    id: 'cottage',
    name: 'Cottage',
    role: 'coins',
    unlockLevel: 1,
    cost: 40,
    ratePerMin: 2,
    cap: 60,
    buildSeconds: 20,
  },
  wheatfield: {
    id: 'wheatfield',
    name: 'Wheat Field',
    role: 'raw',
    unlockLevel: 1,
    cost: 60,
    ratePerMin: 3,
    cap: 90,
    buildSeconds: 30,
    good: 'wheat',
  },
  grove: {
    id: 'grove',
    name: "Forester's Grove",
    role: 'raw',
    unlockLevel: 1,
    cost: 80,
    ratePerMin: 2.5,
    cap: 75,
    buildSeconds: 40,
    good: 'logs',
  },
  quarry: {
    id: 'quarry',
    name: 'Quarry',
    role: 'raw',
    unlockLevel: 2,
    cost: 150,
    ratePerMin: 2,
    cap: 60,
    buildSeconds: 90,
    good: 'stone',
  },
  windmill: {
    id: 'windmill',
    name: 'Windmill',
    role: 'processor',
    unlockLevel: 2,
    cost: 220,
    ratePerMin: 1.5,
    cap: 45,
    buildSeconds: 120,
    input: { good: 'wheat', per: 2 },
    output: 'flour',
  },
  sawmill: {
    id: 'sawmill',
    name: 'Sawmill',
    role: 'processor',
    unlockLevel: 3,
    cost: 300,
    ratePerMin: 1.2,
    cap: 36,
    buildSeconds: 150,
    input: { good: 'logs', per: 2 },
    output: 'planks',
  },
  kiln: {
    id: 'kiln',
    name: "Mason's Kiln",
    role: 'processor',
    unlockLevel: 4,
    cost: 400,
    ratePerMin: 1,
    cap: 30,
    buildSeconds: 180,
    input: { good: 'stone', per: 2 },
    output: 'bricks',
  },
  bakery: {
    id: 'bakery',
    name: 'Bakery',
    role: 'processor',
    unlockLevel: 3,
    cost: 350,
    ratePerMin: 1,
    cap: 480,
    buildSeconds: 150,
    input: { good: 'flour', per: 1 },
    output: 'coins',
    coinsPerFlour: 12,
  },
  well: {
    id: 'well',
    name: 'Old Well',
    role: 'decor',
    unlockLevel: 2,
    cost: 120,
    ratePerMin: 0,
    cap: 0,
    buildSeconds: 15,
  },
  trees: {
    id: 'trees',
    name: 'Tree Grove',
    role: 'decor',
    unlockLevel: 1,
    cost: 60,
    ratePerMin: 0,
    cap: 0,
    buildSeconds: 10,
  },
  fountain: {
    id: 'fountain',
    name: 'Stone Fountain',
    role: 'decor',
    unlockLevel: 6,
    cost: 700,
    ratePerMin: 0,
    cap: 0,
    buildSeconds: 60,
  },
  manor: {
    id: 'manor',
    name: 'Manor',
    role: 'coins',
    unlockLevel: 9,
    cost: 1600,
    ratePerMin: 45,
    cap: 1350,
    buildSeconds: 480,
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
    // Producers keep a fractional rate through the multiplier so processors
    // like the windmill (1.5/min) don't round to an integer prematurely.
    ratePerMin: spec.ratePerMin * m.ratePerMin,
    cap: Math.round(spec.cap * m.cap),
    buildSeconds: Math.round(spec.buildSeconds * m.buildSeconds),
  };
};

/**
 * Total coins a building at `tier` has cost its owner: the sum of every
 * `tierStats().cost` from tier 1 up to (and including) `tier`. A tier-3 tower
 * therefore reflects the tier-1 build plus both upgrade payments. Pure — the
 * demolish refund is derived from this.
 */
export const investedCost = (spec: BuildingSpec, tier: Tier): number => {
  const tiers: Tier[] = [1, 2, 3];
  let total = 0;
  for (const t of tiers) {
    if (t <= tier) total += tierStats(spec, t).cost;
  }
  return total;
};

/** Fraction of a building's invested cost refunded when it is demolished. */
export const DEMOLISH_REFUND: number = 0.5;

// ---------------------------------------------------------------------------
// Roof painting (player customization).
// ---------------------------------------------------------------------------

/** Coins charged to repaint a building's roof (constant across tiers/colours). */
export const PAINT_COST: number = 25;

/**
 * The buildings whose art is a wall+roof stack — the only ones a paintable roof
 * applies to. Mirrors the `kind: 'stacked'` entries in the client art manifest
 * (`BUILDING_ART`): flat buildings (crops/trees/rocks/decor) have no roof sprite
 * so the paint option is hidden for them.
 */
export const STACKED_BUILDINGS: ReadonlySet<BuildingId> = new Set<BuildingId>([
  'cottage',
  'windmill',
  'sawmill',
  'kiln',
  'bakery',
  'manor',
]);

/** True when a building renders as a wall+roof stack (roof is paintable). */
export const isStackedBuilding = (id: BuildingId): boolean =>
  STACKED_BUILDINGS.has(id);

// ---------------------------------------------------------------------------
// Village name + theme (mod customization).
// ---------------------------------------------------------------------------

/** Display fallback when a subreddit has not set a village name. */
export const DEFAULT_VILLAGE_NAME: string = 'Hearthvale';

/** Maximum length of a mod-set village name. */
export const MAX_VILLAGE_NAME: number = 24;

/** Allowed village-name characters: letters, numbers, spaces, apostrophe, hyphen. */
const VILLAGE_NAME_RE = /^[\p{L}\p{N} '-]+$/u;

/**
 * Validate a (trimmed) mod-set village name. Empty is valid (clears the name,
 * reverting to the fallback); otherwise it must be within the length limit and
 * contain only letters, numbers, spaces, apostrophes and hyphens.
 */
export const isValidVillageName = (name: string): boolean => {
  if (name.length === 0) return true;
  if (name.length > MAX_VILLAGE_NAME) return false;
  return VILLAGE_NAME_RE.test(name);
};

/** The name to display for a village: the mod-set name, or the fallback. */
export const villageDisplayName = (name: string): string =>
  name.trim().length > 0 ? name.trim() : DEFAULT_VILLAGE_NAME;

/** The four selectable themes, in a stable order for the mod form + guards. */
export const VILLAGE_THEMES: VillageTheme[] = [
  'meadow',
  'autumn',
  'twilight',
  'pale',
];

/** Human labels for each theme (mod form select options). */
export const THEME_LABELS: Record<VillageTheme, string> = {
  meadow: 'Meadow (green)',
  autumn: 'Autumn (warm)',
  twilight: 'Twilight (purple)',
  pale: 'Pale (light)',
};

/** Runtime guard: true when a string is one of the four village themes. */
export const isVillageTheme = (value: unknown): value is VillageTheme =>
  value === 'meadow' ||
  value === 'autumn' ||
  value === 'twilight' ||
  value === 'pale';

// ---------------------------------------------------------------------------
// Market pricing.
// ---------------------------------------------------------------------------

/** Per-good market tuning: `base` price and the `target` stock level the price
 * pivots around. Raw goods target 120, processed goods 60. */
export const MARKET: Record<Good, { base: number; target: number }> = {
  wheat: { base: 3, target: 120 },
  logs: { base: 4, target: 120 },
  stone: { base: 5, target: 120 },
  flour: { base: 9, target: 60 },
  planks: { base: 12, target: 60 },
  bricks: { base: 15, target: 60 },
};

// ---------------------------------------------------------------------------
// Grand Keep.
// ---------------------------------------------------------------------------

/** Cost (planks + bricks) to complete each of the 5 keep stages, in order. */
export const KEEP_STAGE_COSTS: Array<{ planks: number; bricks: number }> = [
  { planks: 30, bricks: 15 },
  { planks: 60, bricks: 40 },
  { planks: 120, bricks: 80 },
  { planks: 200, bricks: 140 },
  { planks: 320, bricks: 220 },
];

/** Coin pot per stage is `stage × STAGE_POT`, split pro-rata by contributed
 * units (minimum 25 per contributor). */
export const STAGE_POT: number = 400;

/** Minimum pro-rata payout a stage contributor receives. */
export const STAGE_MIN_PAYOUT: number = 25;

/**
 * Word lists for the stage-naming picker. The top contributor of a completed
 * stage picks one adjective + one noun (by index) to name their stage; the two
 * words are joined with a space and stored on the city's `stageNames`.
 */
export const STAGE_NAME_WORDS: {
  adjectives: string[];
  nouns: string[];
} = {
  adjectives: [
    'Ancient',
    'Golden',
    'Silver',
    'Iron',
    'Stone',
    'Emerald',
    'Crimson',
    'Azure',
    'Radiant',
    'Shadowed',
    'Verdant',
    'Gilded',
    'Hallowed',
    'Mighty',
    'Serene',
    'Noble',
    'Rustic',
    'Bright',
    'Frosted',
    'Amber',
    'Cobalt',
    'Ivory',
    'Scarlet',
    'Twilight',
  ],
  nouns: [
    'Keep',
    'Bastion',
    'Spire',
    'Hold',
    'Rampart',
    'Citadel',
    'Tower',
    'Bulwark',
    'Gate',
    'Watch',
    'Hearth',
    'Haven',
    'Bastille',
    'Redoubt',
    'Sanctum',
    'Beacon',
    'Vault',
    'Turret',
    'Palisade',
    'Garrison',
    'Donjon',
    'Barbican',
    'Crown',
    'Refuge',
  ],
};

// ---------------------------------------------------------------------------
// Land expansion rings.
// ---------------------------------------------------------------------------

/** Ring inclusive bounds `[lo, hi]` on both axes, keyed by the minimum distinct
 * -owner population that unlocks them. Ordered ascending by `pop`. */
export const RING_THRESHOLDS: Array<{ pop: number; lo: number; hi: number }> = [
  { pop: 0, lo: 5, hi: 11 },
  { pop: 3, lo: 4, hi: 13 },
  { pop: 6, lo: 3, hi: 14 },
  { pop: 12, lo: 1, hi: 16 },
  { pop: 20, lo: 0, hi: 17 },
];

export const GRID_SIZE: number = 18;
export const MAX_LEVEL: number = 15;
export const PLOT_LEVELS: number[] = [1, 2, 4, 7, 10];
/** Neighbour boosts a player may hand out per UTC day. */
export const BOOST_DAILY_LIMIT: number = 5;
