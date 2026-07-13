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
import { CATALOG, MAX_LEVEL, PLOT_LEVELS, hallPerks, tierStats } from '../catalog';
import { isClaimable, isPlaza, neighbors, parseKey, tileKey } from './grid';
import { isRiver } from './expansion';
import { isMonument } from './monuments';

export const xpFor = (level: number): number => 50 * level * (level - 1);

export const levelForXp = (xp: number): number => {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpFor(level + 1)) {
    level += 1;
  }
  return level;
};

export const plotsForLevel = (level: number): number =>
  PLOT_LEVELS.filter((l) => l <= level).length;

/** A player's effective plot allowance: the level-gated plots plus the Village
 * Hall's shared bonus plot (+1 from Hall level 3). Pure. */
export const plotsAllowed = (level: number, hallLevel: number): number =>
  plotsForLevel(level) + hallPerks(hallLevel).bonusPlot;

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
// Perfect Harvest (S2) — the golden-window micro-skill on collection.
// ---------------------------------------------------------------------------

/**
 * A ready building periodically enters a brief GOLDEN SPARKLE window; collecting
 * it during the window doubles that harvest. The window is a PURE function of
 * (tileKey, time) so client and server agree WITHOUT any realtime push — the
 * client evaluates it against the skew-corrected `serverNow()`, the server
 * against `Date.now()`, and both derive the same phase from the tile key. This
 * is the anti-cheat crux: there is nothing to spoof — a tap is golden iff the
 * server's own clock says the deterministic window is open.
 */
export const GOLDEN_CYCLE_MS = 11_000;
export const GOLDEN_WINDOW_MS = 1_800;
/** Validation slack (each edge) the server allows to absorb network latency and
 * clock-skew residue, so an honest well-timed tap is never rejected. */
export const GOLDEN_GRACE_MS = 400;
/** A golden-window collection multiplies its production by this factor. */
export const GOLDEN_MULTIPLIER = 2;

/**
 * A deterministic per-tile phase offset in [0, GOLDEN_CYCLE_MS): an FNV-1a hash
 * of the tile key folded into the cycle length, so each tile's golden window
 * lands at a different moment (the windows are spread across the map, not
 * synchronised into one village-wide flash). Pure.
 */
const goldenPhase = (key: string): number => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % GOLDEN_CYCLE_MS;
};

/** Position within the tile's golden cycle at `now`, in [0, GOLDEN_CYCLE_MS). */
const goldenPos = (key: string, now: number): number => {
  const c = GOLDEN_CYCLE_MS;
  return (((now + goldenPhase(key)) % c) + c) % c;
};

/**
 * True when tile `key` is inside its golden window at `now` — the strict window
 * the CLIENT renders the sparkle for. Duty cycle ≈ GOLDEN_WINDOW_MS/GOLDEN_CYCLE_MS.
 * Pure + deterministic.
 */
export const isGoldenWindow = (key: string, now: number): boolean =>
  goldenPos(key, now) < GOLDEN_WINDOW_MS;

/**
 * The SERVER's lenient acceptance test: the strict window widened by
 * GOLDEN_GRACE_MS on each edge (the leading edge wraps to the tail of the
 * previous cycle). A strict superset of `isGoldenWindow`, so any tap the client
 * showed as golden is honoured even after a little latency. Pure.
 */
export const isGoldenWindowLenient = (key: string, now: number): boolean => {
  const pos = goldenPos(key, now);
  return (
    pos < GOLDEN_WINDOW_MS + GOLDEN_GRACE_MS ||
    pos >= GOLDEN_CYCLE_MS - GOLDEN_GRACE_MS
  );
};

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

  // Coins building (house, manor).
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

/**
 * The tile holding a player's house (their homestead anchor), or null if they
 * have not settled yet. There is exactly one house per player (built free on
 * their first claim). Pure.
 */
export const houseTile = (
  grid: Record<string, TileState>,
  userId: string
): { x: number; y: number } | null => {
  for (const [key, tile] of Object.entries(grid)) {
    if (tile.owner === userId && tile.buildingId === 'house') {
      return parseKey(key);
    }
  }
  return null;
};

/**
 * The count of a player's PLOTS — every tile they own EXCEPT their house. The
 * house is the homestead anchor placed free on the first claim, not a build
 * plot, so it must never count against the plot allowance (otherwise a fresh
 * level-1 player, whose only tile is that auto-built house, would already be at
 * their limit and could never settle a field). Claimed-but-empty tiles DO count
 * — they occupy a plot. Pure.
 */
export const ownedPlots = (
  grid: Record<string, TileState>,
  userId: string
): number => {
  let n = 0;
  for (const tile of Object.values(grid)) {
    if (tile.owner === userId && tile.buildingId !== 'house') n += 1;
  }
  return n;
};

/**
 * True if `(x, y)` is within Chebyshev radius 2 of the player's house tile —
 * the rule every claim after the first must satisfy so homesteads cluster.
 * A player with no house yet (should not happen past the first claim) is
 * treated as unable to claim near a house. Pure.
 */
export const nearHouse = (
  grid: Record<string, TileState>,
  userId: string,
  x: number,
  y: number
): boolean => {
  const home = houseTile(grid, userId);
  if (!home) return false;
  return Math.max(Math.abs(home.x - x), Math.abs(home.y - y)) <= 2;
};

/**
 * Validate a claim. `owned` is the caller's PLOT count — non-house tiles only
 * (see `ownedPlots`) — so the house never eats into the plot allowance. The
 * homestead-radius rule is gated on whether the player has already SETTLED (owns
 * a house), not on the plot count, so the very first field must still hug the
 * house even though that field is plot #1 (owned 0 at the time). Pure.
 */
export const canClaim = (
  grid: Record<string, TileState>,
  x: number,
  y: number,
  player: PlayerState,
  owned: number,
  hallLevel: number,
  /** Village seed (`city.foundedAt`). When supplied, tiles occupied by a seeded
   * monument are rejected — this is how claim validation stays in step with the
   * renderer. Omitted only by unit tests that exercise the other rules. */
  seed?: number
): string | null => {
  if (isPlaza(x, y)) return 'That tile is part of the village plaza.';
  if (!isClaimable(x, y)) return 'That tile is outside the village.';
  if (isRiver(x, y)) return "You can't settle on the river.";
  if (seed !== undefined && isMonument(seed, x, y)) {
    return 'An old monument stands here — it can’t be built on.';
  }
  if (grid[tileKey(x, y)]) return 'That tile is already claimed.';
  if (owned >= plotsAllowed(player.level, hallLevel)) {
    return 'You have reached your plot limit. Level up to claim more.';
  }
  // Once settled, every further claim must hug the homestead so villages stay
  // tight. The first claim ever (no house yet) founds the homestead anywhere.
  const settled = houseTile(grid, player.id) !== null;
  if (settled && !nearHouse(grid, player.id, x, y)) {
    return 'Build closer to your house (within 2 tiles).';
  }
  return null;
};
