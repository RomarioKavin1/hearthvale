import type {
  BuildingId,
  BuildingRole,
  FestivalCategory,
  Gained,
  Good,
  PlayerState,
  Stockpile,
  TileState,
  Weather,
} from '../types';
import type { BuildingSpec } from '../catalog';
import { CATALOG, MAX_LEVEL, PLOT_LEVELS, tierStats } from '../catalog';
import { isClaimable, isPlaza, neighbors, tileKey } from './grid';
import { isRiver } from './expansion';

export const xpFor = (level: number): number => 75 * level * (level - 1);

export const levelForXp = (xp: number): number => {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpFor(level + 1)) {
    level += 1;
  }
  return level;
};

export const plotsForLevel = (level: number): number =>
  PLOT_LEVELS.filter((l) => l <= level).length;

export const streakReward = (streak: number): number =>
  25 * Math.min(streak, 7);

/** UTC calendar day (YYYY-MM-DD) for a millisecond timestamp. */
export const utcDay = (now: number): string =>
  new Date(now).toISOString().slice(0, 10);

/** The UTC day immediately before the given YYYY-MM-DD day. */
export const prevDay = (day: string): string =>
  new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);

// ---------------------------------------------------------------------------
// Goods helpers.
// ---------------------------------------------------------------------------

/** The six goods, in a stable order for iteration. */
export const GOODS: Good[] = ['wheat', 'logs', 'stone', 'flour', 'planks', 'bricks'];

/** A fresh, all-zero stockpile/wallet. */
export const emptyStockpile = (): Stockpile => ({
  wheat: 0,
  logs: 0,
  stone: 0,
  flour: 0,
  planks: 0,
  bricks: 0,
});

/** Total unit count across a goods map. */
export const goodsTotal = (goods: Partial<Record<Good, number>>): number =>
  GOODS.reduce((sum, g) => sum + (goods[g] ?? 0), 0);

/** Add two goods maps together (pure). */
export const mergeGoods = (
  into: Partial<Record<Good, number>>,
  add: Partial<Record<Good, number>>
): Partial<Record<Good, number>> => {
  const out: Partial<Record<Good, number>> = { ...into };
  for (const g of GOODS) {
    const v = add[g];
    if (v) out[g] = (out[g] ?? 0) + v;
  }
  return out;
};

/** Map a building role to the festival category that boosts it. */
export const roleToFestival = (role: BuildingRole): FestivalCategory =>
  role === 'processor' ? 'processed' : role;

// ---------------------------------------------------------------------------
// Accrual.
// ---------------------------------------------------------------------------

type Accrual = { gained: Gained; consumed: Partial<Record<Good, number>> };

const NO_GAIN = (): Accrual => ({
  gained: { coins: 0, xp: 0, goods: {} },
  consumed: {},
});

/** Weather multiplier applied to a building's potential output. */
const weatherMultiplier = (weather: Weather, spec: BuildingSpec): number => {
  if (weather === 'sunny') return 1.1;
  if (weather === 'harvestmoon') return 1.5;
  if (weather === 'rain') {
    return spec.good === 'wheat' || spec.good === 'logs' ? 1.3 : 1;
  }
  return 1;
};

/**
 * Compute what a tile produced since it was last collected. Pure — the caller
 * passes the village `stockpile` (read-only) and today's `weather`.
 *
 * - Coins buildings mint coins directly.
 * - Raw producers output their good into `gained.goods`.
 * - Processors turn stockpile inputs into output units: potential output is the
 *   rate over elapsed time (boost/festival/adjacency/weather all scale the
 *   potential), then the actual output is capped by the tier cap AND the
 *   available stockpile input (`floor(stock / inputPer)`); `consumed` reports
 *   the inputs used. The bakery's output is coins (12 per flour).
 */
export const accrue = (
  tile: TileState,
  now: number,
  festival: FestivalCategory,
  adjBonus: number,
  weather: Weather,
  stockpile: Stockpile
): Accrual => {
  if (!tile.buildingId) return NO_GAIN();
  const spec = CATALOG[tile.buildingId];
  if (spec.role === 'decor') return NO_GAIN();
  if (now < tile.readyAt) return NO_GAIN();

  const stats = tierStats(spec, tile.tier);
  const start = Math.max(tile.lastCollect, tile.readyAt);
  const elapsed = Math.max(0, now - start);
  if (elapsed <= 0) return NO_GAIN();

  // Portion of elapsed time inside the boost window counts double.
  const boostedMs = Math.max(
    0,
    Math.min(now, tile.boostUntil) - Math.min(start, tile.boostUntil)
  );
  const normalMs = elapsed - boostedMs;
  const effectiveMs = boostedMs * 2 + normalMs;

  let potential = (stats.ratePerMin * effectiveMs) / 60000;
  if (festival === roleToFestival(spec.role)) potential *= 1.5;
  potential *= 1 + adjBonus;
  potential *= weatherMultiplier(weather, spec);
  if (potential <= 0) return NO_GAIN();

  if (spec.role === 'processor') {
    const input = spec.input;
    const output = spec.output;
    if (!input || !output) return NO_GAIN();
    const outputPerRun = output === 'coins' ? spec.coinsPerFlour ?? 0 : 1;
    const capRuns = outputPerRun > 0 ? stats.cap / outputPerRun : stats.cap;
    const availableRuns = Math.floor(stockpile[input.good] / input.per);
    const runs = Math.max(
      0,
      Math.min(Math.floor(potential), Math.floor(capRuns), availableRuns)
    );
    if (runs <= 0) return NO_GAIN();
    const consumed: Partial<Record<Good, number>> = {
      [input.good]: runs * input.per,
    };
    if (output === 'coins') {
      const coins = runs * outputPerRun;
      return { gained: { coins, xp: Math.ceil(coins / 10), goods: {} }, consumed };
    }
    return { gained: { coins: 0, xp: runs, goods: { [output]: runs } }, consumed };
  }

  const amount = Math.min(Math.floor(potential), stats.cap);
  if (amount <= 0) return NO_GAIN();

  if (spec.role === 'raw') {
    const good = spec.good;
    if (!good) return NO_GAIN();
    return { gained: { coins: 0, xp: amount, goods: { [good]: amount } }, consumed: {} };
  }

  // Coins building (cottage, manor).
  return {
    gained: { coins: amount, xp: Math.ceil(amount / 10), goods: {} },
    consumed: {},
  };
};

// ---------------------------------------------------------------------------
// Adjacency.
// ---------------------------------------------------------------------------

/** Building pairs whose orthogonal adjacency grants +0.25 to each (the chain
 * synergy the tile sheet surfaces as a "+25% next to X" hint). */
export const CHAIN_PAIRS: Array<[BuildingId, BuildingId]> = [
  ['wheatfield', 'windmill'],
  ['windmill', 'bakery'],
  ['grove', 'sawmill'],
  ['quarry', 'kiln'],
];

const chainMatch = (a: BuildingId, b: BuildingId): boolean =>
  CHAIN_PAIRS.some(
    ([p, q]) => (a === p && b === q) || (a === q && b === p)
  );

/**
 * Placement bonus for the producer on `(x, y)`:
 * - +0.1 x tier per adjacent completed decor (capped 0.6, doubled on a decor
 *   festival),
 * - +0.25 per orthogonally-adjacent chain partner (wheatfield<->windmill etc),
 * - +0.5 if a raw producer sits next to a river tile.
 * The total is capped at +1.0 after decor doubling.
 */
export const adjacencyBonus = (
  grid: Record<string, TileState>,
  x: number,
  y: number,
  festival: FestivalCategory,
  now: number
): number => {
  const self = grid[tileKey(x, y)];
  const selfId = self?.buildingId;
  const selfRole = selfId ? CATALOG[selfId].role : undefined;

  let decor = 0;
  let chain = 0;
  let river = 0;

  for (const n of neighbors(x, y)) {
    const t = grid[tileKey(n.x, n.y)];
    if (t?.buildingId && t.readyAt <= now) {
      if (CATALOG[t.buildingId].role === 'decor') decor += 0.1 * t.tier;
      if (selfId && chainMatch(selfId, t.buildingId)) chain += 0.25;
    }
    if (selfRole === 'raw' && isRiver(n.x, n.y)) river = 0.5;
  }

  decor = Math.min(decor, 0.6);
  if (festival === 'decor') decor *= 2;
  return Math.min(decor + chain + river, 1.0);
};

// ---------------------------------------------------------------------------
// Claiming.
// ---------------------------------------------------------------------------

export const canClaim = (
  grid: Record<string, TileState>,
  x: number,
  y: number,
  player: PlayerState,
  owned: number
): string | null => {
  if (isPlaza(x, y)) return 'That tile is part of the village plaza.';
  if (!isClaimable(x, y)) return 'That tile is outside the village.';
  if (grid[tileKey(x, y)]) return 'That tile is already claimed.';
  if (owned >= plotsForLevel(player.level)) {
    return 'You have reached your plot limit. Level up to claim more.';
  }
  return null;
};
