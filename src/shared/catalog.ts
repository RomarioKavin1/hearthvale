import type { BuildingId, BuildingRole, Good, Tier, VillageTheme } from './types';
import { PAL } from './palette';

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
  /** A building that is placed automatically (never sold in the build grid). The
   * `house` is placed free when a player settles their first plot; it is the
   * player's homestead anchor and cannot be demolished. Its `cost` is retained
   * only for the tier-cost maths on upgrades (the initial placement is free). */
  special?: 'house';
};

export const CATALOG: Record<BuildingId, BuildingSpec> = {
  house: {
    id: 'house',
    name: 'House',
    role: 'coins',
    unlockLevel: 1,
    // Placed free on the first claim; `cost` drives only the upgrade tier maths.
    cost: 60,
    ratePerMin: 1,
    cap: 60,
    buildSeconds: 10,
    special: 'house',
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
  'house',
  'windmill',
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

/** The selectable themes, in a stable order for the mod form + guards. */
export const VILLAGE_THEMES: VillageTheme[] = [
  'meadow',
  'autumn',
  'twilight',
  'pale',
  'desert',
];

/** Human labels for each theme (mod form select options). */
export const THEME_LABELS: Record<VillageTheme, string> = {
  meadow: 'Meadow (green)',
  autumn: 'Autumn (warm)',
  twilight: 'Twilight (purple)',
  pale: 'Pale (light)',
  desert: 'Desert (sand biome)',
};

/** Runtime guard: true when a string is one of the village themes. */
export const isVillageTheme = (value: unknown): value is VillageTheme =>
  value === 'meadow' ||
  value === 'autumn' ||
  value === 'twilight' ||
  value === 'pale' ||
  value === 'desert';

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

/** Resource cost (planks + bricks) to raise the Village Hall to each of its 5
 * levels, in order (`KEEP_STAGE_COSTS[hallLevel]` is what the next level-up
 * needs). Every level-up ALSO requires a population threshold (see
 * `HALL_POPULATION`). The name is retained for the contribution/pot code. */
export const KEEP_STAGE_COSTS: Array<{ planks: number; bricks: number }> = [
  { planks: 30, bricks: 15 },
  { planks: 60, bricks: 40 },
  { planks: 120, bricks: 80 },
  { planks: 200, bricks: 140 },
  { planks: 320, bricks: 220 },
];

// ---------------------------------------------------------------------------
// Village Hall progression (Village Level 0→5). A level-up needs BOTH the
// resource cost above AND a population threshold below; each level unlocks a
// land ring (RING_BY_LEVEL) and cumulative perks (hallPerks).
// ---------------------------------------------------------------------------

/** The Village Hall's top level (number of resource stages). */
export const HALL_MAX_LEVEL: number = KEEP_STAGE_COSTS.length;

/** Population (house count) required to reach each Hall level 1..5:
 * `HALL_POPULATION[hallLevel]` is the villagers needed to advance FROM the
 * current level to the next. */
export const HALL_POPULATION: number[] = [2, 4, 8, 14, 22];

/** The perks a given Village Hall level grants, cumulative by level. (S1: the
 * trader-offer and market-sell-cap perks retired along with the trader and the
 * manual market — production, plots and boosts are what remain.) */
export type HallPerks = {
  /** Village-wide production bonus in whole percent (+3% per level). */
  productionPct: number;
  /** Extra plots granted to every player (0, then +1 from level 3). */
  bonusPlot: number;
  /** Neighbour boosts allowed per day (5, then 7 from level 4). */
  boostLimit: number;
};

/** The cumulative perks unlocked at a Village Hall level (clamped 0..5). Pure. */
export const hallPerks = (level: number): HallPerks => {
  const l = Math.max(0, Math.min(level, HALL_MAX_LEVEL));
  return {
    productionPct: 3 * l,
    bonusPlot: l >= 3 ? 1 : 0,
    boostLimit: l >= 4 ? 7 : 5,
  };
};

/** A house's personal aura: +2 percentage points of production per house tier,
 * applied to the owner's OTHER buildings (never the house itself). Pure. */
export const houseBonus = (tier: number): number => 2 * Math.max(0, tier);

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

/** Ring inclusive bounds `[lo, hi]` (same on both axes) unlocked at each Village
 * Hall level: `RING_BY_LEVEL[hallLevel]` is the land opened at that level. Levels
 * 4 and 5 share the maximum ring (the array has 5 entries, indices 0..4; Hall
 * level 5 clamps to index 4). Replaces the old population-keyed thresholds — land
 * now expands with the Hall level, not the raw villager count. */
export const RING_BY_LEVEL: Array<{ lo: number; hi: number }> = [
  { lo: 3, hi: 14 },
  { lo: 2, hi: 15 },
  { lo: 1, hi: 16 },
  { lo: 0, hi: 17 },
  { lo: 0, hi: 17 },
];

// ---------------------------------------------------------------------------
// Expression pack (E1): the Village Mural, villager outfits, and the crest.
// No new assets — every colour is drawn from the shared PAL, every crest emblem
// reuses an existing UI icon.
// ---------------------------------------------------------------------------

/** Mural canvas dimensions (a mini r/place per village): 24 wide × 16 tall. */
export const MURAL_W: number = 24;
export const MURAL_H: number = 16;

/** Pixels a single villager may paint per UTC day (r/place-style rationing). */
export const MURAL_DAILY: number = 12;

/**
 * The mural's 12 fixed colours (index 0..11). Index 0 is the "parchment blank"
 * — painting it is how you erase (an absent redis field renders as this too).
 * The rest are drawn straight from PAL (roof hues, foliage, stone, timber) so
 * the mural reads as part of the same hand-crafted world.
 */
export const MURAL_PALETTE: readonly string[] = [
  PAL.cream, // 0 — parchment blank
  PAL.ink, // 1 — ink
  PAL.roofRed, // 2 — red
  PAL.roofBlue, // 3 — blue
  PAL.roofStraw, // 4 — straw gold
  PAL.leaf, // 5 — green
  PAL.accent, // 6 — orange
  PAL.water, // 7 — sky blue
  PAL.roofPurple, // 8 — purple
  PAL.grass, // 9 — grass green
  PAL.wood, // 10 — timber brown
  PAL.stone, // 11 — stone grey
];

/** True when `c` is a valid mural colour index (0..11). */
export const isMuralColor = (c: unknown): c is number =>
  typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < MURAL_PALETTE.length;

/** True when `(x, y)` is inside the mural canvas bounds. */
export const isMuralCoord = (x: unknown, y: unknown): boolean =>
  typeof x === 'number' &&
  Number.isInteger(x) &&
  typeof y === 'number' &&
  Number.isInteger(y) &&
  x >= 0 &&
  x < MURAL_W &&
  y >= 0 &&
  y < MURAL_H;

// --- Villager outfits (personal identity) -----------------------------------

/** Number of selectable villager outfit colours (0..7). */
export const OUTFIT_COUNT: number = 8;

/** The eight outfit swatch colours — the walker's shirt cloth, drawn from PAL. */
export const OUTFIT_HEX: readonly string[] = [
  PAL.roofRed,
  PAL.roofBlue,
  PAL.roofStraw,
  PAL.leaf,
  PAL.accent,
  PAL.wood,
  PAL.roofPurple,
  PAL.water,
];

/** True when `c` is a valid outfit index (0..7). */
export const isOutfit = (c: unknown): c is number =>
  typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < OUTFIT_COUNT;

/**
 * A stable default outfit for a player who has never chosen one: a small hash of
 * their userId, so "the little one in red is me" is consistent from day one and
 * villagers don't all start identical. Pure.
 */
export const defaultOutfit = (userId: string): number => {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % OUTFIT_COUNT;
};

// --- Village crest (mod identity) -------------------------------------------

/** The six crest emblems (0..5) — each reuses an existing UI icon sprite. */
export const CREST_EMBLEMS: readonly { label: string; icon: string }[] = [
  { label: 'Star', icon: 'icon-star' },
  { label: 'Trophy', icon: 'icon-trophy' },
  { label: 'Scroll', icon: 'icon-scroll' },
  { label: 'Home', icon: 'icon-home' },
  { label: 'Hammer', icon: 'icon-hammer' },
  { label: 'Coin', icon: 'icon-coin' },
];

/** The four crest banner colours (0..3), matching the pack's colored crest
 * towers (Beige/Brown/Green/Purple) flown as the village standard. Labels are the
 * heraldic names shown in the mod form + dev panel. */
export const CREST_COLORS: readonly { label: string; hex: string }[] = [
  { label: 'Sand', hex: PAL.roofBeige },
  { label: 'Rustic', hex: PAL.roofBrown },
  { label: 'Forest', hex: PAL.roofGreen },
  { label: 'Royal', hex: PAL.roofPurple },
];

/** True when `v` is a valid crest emblem index (0..5). */
export const isCrest = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CREST_EMBLEMS.length;

/** True when `v` is a valid crest colour index (0..3). */
export const isCrestColor = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CREST_COLORS.length;

export const GRID_SIZE: number = 18;
export const MAX_LEVEL: number = 15;
// Two plots from the start: both level-1 entries grant a plot at level 1 (the
// house is excluded from the plot count), so a freshly-settled player can claim
// TWO plots immediately — a field and a grove — before needing to level up.
export const PLOT_LEVELS: number[] = [1, 1, 4, 7, 10];
// The daily neighbour-boost limit lives in `hallPerks(level).boostLimit`
// (5 at Hall level 0, 7 from level 4) — there is no separate flat constant.
