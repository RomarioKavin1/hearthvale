import { context, reddit, realtime, redis } from '@devvit/web/server';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type {
  CityState,
  ClaimQuestResponse,
  FestivalCategory,
  Gained,
  Good,
  LeaderRow,
  PlayerState,
  Prices,
  QuestView,
  RoofColor,
  StateResponse,
  Stockpile,
  Summary,
  Tier,
  TileState,
  TraderOffer,
  VillageTheme,
} from '../../shared/types';
import type { BuildingId } from '../../shared/types';
import {
  CATALOG,
  DEMOLISH_REFUND,
  HALL_POPULATION,
  KEEP_STAGE_COSTS,
  MARKET,
  MAX_LEVEL,
  PAINT_COST,
  STAGE_MIN_PAYOUT,
  STAGE_NAME_WORDS,
  STAGE_POT,
  hallPerks,
  houseBonus,
  investedCost,
  isStackedBuilding,
  isValidVillageName,
  isVillageTheme,
  tierStats,
} from '../../shared/catalog';
import type { BuildingSpec } from '../../shared/catalog';
import {
  GOODS,
  accrue,
  adjacencyBonus,
  canClaim,
  goodsTotal,
  mergeGoods,
  levelForXp,
  plotsForLevel,
  prevDay,
  streakReward,
  utcDay,
} from '../../shared/logic/economy';
import { buyValue, priceFor, pricesFor, sellValue } from '../../shared/logic/market';
import { isUnlocked, ringBounds } from '../../shared/logic/expansion';
import { offersForDay, weatherForDay } from '../../shared/logic/trader';
import {
  advanceQuest,
  claimQuestError,
  questAt,
  questBaselineFor,
  questProgress,
  questSnapshot,
} from '../../shared/quests';
import { parseKey, tileKey } from '../../shared/logic/grid';
import {
  STOCKPILE_KEY,
  claimDailyTrade,
  getBallot,
  getCity,
  getGrid,
  getPlayer,
  getStockpile,
  getTile,
  hasTradedToday,
  hasVoted,
  incrStageContrib,
  initPlayer,
  ownedCount,
  playerFields,
  playerRedisKey,
  putCity,
  putPlayer,
  putStockpile,
  putTile,
  recordVote,
  stageContribScore,
  stageContribTotal,
  stageTopContributor,
  stockpileFields,
} from './store';

/** Number of Village Hall levels (resource stages). */
export const KEEP_STAGES: number = KEEP_STAGE_COSTS.length;

const GRID_KEY = 'city:grid';
const LB_VALUE = 'lb:value';
const LB_EARNED = 'lb:earned';
const LB_CONTRIB = 'lb:contrib';

type UserId = NonNullable<typeof context.userId>;

/** Operation error carrying the HTTP status the handler should surface. */
export class OpError extends Error {
  readonly status: ContentfulStatusCode;
  constructor(status: ContentfulStatusCode, message: string) {
    super(message);
    this.status = status;
    this.name = 'OpError';
  }
}

// ---------------------------------------------------------------------------
// Pure decision helpers (unit-tested in village.test.ts).
// ---------------------------------------------------------------------------

export const validateBuild = (
  player: PlayerState,
  tile: TileState,
  spec: BuildingSpec
): string | null => {
  if (tile.owner !== player.id) return 'You do not own this plot.';
  if (tile.buildingId) return 'This plot already has a building.';
  if (spec.special === 'house') {
    return 'Your house is placed when you settle your first plot.';
  }
  if (player.level < spec.unlockLevel) {
    return `${spec.name} unlocks at level ${spec.unlockLevel}.`;
  }
  if (player.coins < spec.cost) return 'Not enough coins to build this.';
  return null;
};

export const validateUpgrade = (
  player: PlayerState,
  tile: TileState,
  now: number
): string | null => {
  if (tile.owner !== player.id) return 'You do not own this plot.';
  if (!tile.buildingId) return 'There is no building here to upgrade.';
  if (now < tile.readyAt) return 'This building is still under construction.';
  if (tile.tier >= 3) return 'This building is already at its highest tier.';
  return null;
};

/**
 * A tile may be demolished by its owner as long as it holds a building.
 * Deliberately allows demolishing DURING construction: the build already
 * deducted the full cost, so refunding 50% of the invested cost is not an
 * exploit (the player is always down 50%). Returns an error message or null.
 */
export const validateDemolish = (
  player: PlayerState,
  tile: TileState
): string | null => {
  if (tile.owner !== player.id) return 'You do not own this plot.';
  if (!tile.buildingId) return 'There is no building here to demolish.';
  if (CATALOG[tile.buildingId].special === 'house') {
    return 'Your house is your home.';
  }
  return null;
};

/** Coins refunded on demolish: floor(DEMOLISH_REFUND × invested cost). Pure. */
export const demolishRefund = (spec: BuildingSpec, tier: Tier): number =>
  Math.floor(DEMOLISH_REFUND * investedCost(spec, tier));

/**
 * A roof may be painted by the plot's owner when it holds a completed stacked
 * building and the player can afford the flat PAINT_COST. Flat buildings
 * (crops/trees/decor) have no roof, so they are rejected. Returns an error
 * message or null. Pure — unit-tested in village.test.ts.
 */
export const validatePaint = (
  player: PlayerState,
  tile: TileState,
  now: number
): string | null => {
  if (tile.owner !== player.id) return 'You do not own this plot.';
  if (!tile.buildingId) return 'There is no building here to paint.';
  if (!isStackedBuilding(tile.buildingId)) {
    return 'This building has no roof to paint.';
  }
  if (now < tile.readyAt) return 'This building is still under construction.';
  if (player.coins < PAINT_COST) return 'Not enough coins to paint this roof.';
  return null;
};

/** Recompute level/plots from current xp. Only ever advances. */
export const applyLevelUp = (player: PlayerState): PlayerState => {
  const level = levelForXp(player.xp);
  if (level <= player.level) return player;
  return { ...player, level, plots: plotsForLevel(level) };
};

const creditXp = (player: PlayerState, amount: number): PlayerState =>
  applyLevelUp({ ...player, xp: player.xp + amount });

// --- Check-in streaks -------------------------------------------------------

/** XP granted per daily check-in — a steady trickle toward the next plot. */
export const CHECKIN_XP = 50;

/** Same-day check-ins are rejected; returns an error message or null. */
export const canCheckIn = (
  lastCheckIn: string,
  today: string
): string | null =>
  lastCheckIn === today ? 'You have already checked in today.' : null;

/** Next streak value: +1 if yesterday's check-in, otherwise back to 1. */
export const nextStreak = (
  lastCheckIn: string,
  prevStreak: number,
  today: string
): number => (lastCheckIn === prevDay(today) ? prevStreak + 1 : 1);

// --- Boosts -----------------------------------------------------------------

/** The base neighbour-boost daily limit (Village Hall level 0). Higher Hall
 * levels raise it via `hallPerks(level).boostLimit`. */
export const BOOST_LIMIT = hallPerks(0).boostLimit;
export const BOOST_DURATION_MS = 30 * 60 * 1000;
export const BOOST_COINS = 15;
export const BOOST_XP = 5;

/** Boosts already spent today; the daily counter resets on date rollover. */
export const boostsUsedToday = (player: PlayerState, today: string): number =>
  player.boostsDate === today ? player.boostsToday : 0;

/**
 * A boost targets a neighbour's completed producer. Returns an error message
 * or null. `usedToday` must already account for date rollover; `limit` is the
 * player's daily allowance (raised by the Village Hall's `boostLimit` perk).
 */
export const validateBoost = (
  boosterId: string,
  tile: TileState,
  now: number,
  usedToday: number,
  limit: number
): string | null => {
  if (tile.owner === boosterId) return 'You cannot boost your own plot.';
  if (!tile.buildingId) return 'There is nothing to boost here.';
  if (CATALOG[tile.buildingId].role === 'decor') {
    return 'Decorations cannot be boosted.';
  }
  if (now < tile.readyAt) return 'This building is still under construction.';
  if (tile.boostUntil > now) return 'This building already has a boost running.';
  if (usedToday >= limit) return 'You have used all your boosts today.';
  return null;
};

// --- Grand Keep contributions -----------------------------------------------

export type StageSplit = { stage: number; amount: number };

export type KeepContributeResult = {
  /** Units of the good actually poured into the current level (excludes refund). */
  applied: number;
  /** Units returned to the player's wallet (over the current level's need). */
  refunded: number;
  /** Portion to record in the `contrib:stage:{hallLevel}` zset (one entry). */
  splits: StageSplit[];
  /** Planks progress toward the current Hall level. */
  stagePlanks: number;
  /** Bricks progress toward the current Hall level. */
  stageBricks: number;
};

/** True once the Village Hall is at its top level (all stages built). */
export const landmarkComplete = (city: CityState): boolean =>
  city.hallLevel >= KEEP_STAGES;

/**
 * Pour a single-good contribution toward the current Village Hall level. The
 * level's cost (`KEEP_STAGE_COSTS[hallLevel]`) needs BOTH planks and bricks; a
 * contribution only fills the requirement for the good given. Resources are
 * capped at the current level's need — a level-up ALSO requires a population
 * threshold (see `tryHallLevelUp`), so units cannot pre-pay a future level and
 * any surplus beyond this good's current requirement is refunded to the wallet.
 *
 * Pure: `costs` is passed in (KEEP_STAGE_COSTS) so it is unit-testable.
 */
export const applyKeepContribution = (
  city: CityState,
  good: 'planks' | 'bricks',
  qty: number,
  costs: Array<{ planks: number; bricks: number }>
): KeepContributeResult => {
  const level = city.hallLevel;
  let planks = city.stagePlanks;
  let bricks = city.stageBricks;
  const incoming = Math.max(0, Math.floor(qty));

  const cost = costs[level];
  // Hall maxed: nothing needed, refund everything.
  if (!cost) {
    return { applied: 0, refunded: incoming, splits: [], stagePlanks: planks, stageBricks: bricks };
  }

  const filled = good === 'planks' ? planks : bricks;
  const need = Math.max(0, cost[good] - filled);
  const applied = Math.min(incoming, need);
  const refunded = incoming - applied;
  if (good === 'planks') planks += applied;
  else bricks += applied;

  const splits: StageSplit[] = applied > 0 ? [{ stage: level, amount: applied }] : [];
  return { applied, refunded, splits, stagePlanks: planks, stageBricks: bricks };
};

export type HallLevelUp = {
  /** The resulting Hall level (unchanged if the level-up conditions are unmet). */
  hallLevel: number;
  /** Planks progress carried on the resulting level (reset to 0 on a level-up). */
  stagePlanks: number;
  /** Bricks progress carried on the resulting level (reset to 0 on a level-up). */
  stageBricks: number;
  /** New Hall levels reached (for `{t:'stage'}` broadcasts + pot settlement). */
  leveled: number[];
};

/**
 * Try to raise the Village Hall. A level-up needs BOTH the current level's
 * resources met AND `population >= HALL_POPULATION[hallLevel]`. Because resources
 * are capped per level (they reset to 0 on a level-up), at most one level is
 * gained per call — but the result is expressed as a list for symmetry with the
 * broadcast/pot code. Pure: `costs` and `population` are passed in.
 */
export const tryHallLevelUp = (
  city: CityState,
  population: number,
  costs: Array<{ planks: number; bricks: number }>
): HallLevelUp => {
  let level = city.hallLevel;
  let planks = city.stagePlanks;
  let bricks = city.stageBricks;
  const leveled: number[] = [];

  while (level < costs.length) {
    const cost = costs[level];
    if (!cost) break;
    const popNeed = HALL_POPULATION[level] ?? Infinity;
    if (planks >= cost.planks && bricks >= cost.bricks && population >= popNeed) {
      level += 1;
      planks = 0;
      bricks = 0;
      leveled.push(level);
    } else {
      break;
    }
  }

  return { hallLevel: level, stagePlanks: planks, stageBricks: bricks, leveled };
};

// --- Ballot -----------------------------------------------------------------

const CATEGORIES: FestivalCategory[] = ['coins', 'raw', 'processed', 'decor'];

/** Cyclic rotation coins -> raw -> processed -> decor -> coins. */
export const nextFestival = (current: FestivalCategory): FestivalCategory => {
  const i = CATEGORIES.indexOf(current);
  return CATEGORIES[(i + 1) % CATEGORIES.length] ?? 'coins';
};

/**
 * Winning festival category: the strict majority. A tie (including no votes)
 * rotates to the next category after the current festival.
 */
export const tallyBallot = (
  counts: Record<FestivalCategory, number>,
  current: FestivalCategory
): FestivalCategory => {
  const entries = CATEGORIES.map((c) => ({ c, n: counts[c] }));
  const max = Math.max(...entries.map((e) => e.n));
  const winners = entries.filter((e) => e.n === max);
  const [winner] = winners;
  if (max > 0 && winners.length === 1 && winner) return winner.c;
  return nextFestival(current);
};

// --- Stage payout -----------------------------------------------------------

/** The coin pot for completing stage index `n` (0-indexed): `(n+1) × 400`. */
export const stagePot = (n: number): number => (n + 1) * STAGE_POT;

/**
 * A contributor's pro-rata share of a stage pot: `floor(pot × myUnits / total)`,
 * with a floor of `STAGE_MIN_PAYOUT` for anyone who contributed at all. Returns
 * 0 for non-contributors (or an empty stage).
 */
export const proRataPayout = (
  pot: number,
  playerUnits: number,
  totalUnits: number
): number => {
  if (playerUnits <= 0 || totalUnits <= 0) return 0;
  return Math.max(STAGE_MIN_PAYOUT, Math.floor((pot * playerUnits) / totalUnits));
};

// --- Collect economics (pure) -----------------------------------------------

/**
 * How many processor recipe runs the owner can afford, given a coin `balance`,
 * the input `price`, the recipe input `per` (units consumed per run), and the
 * `runs` the stockpile could otherwise support. Each run costs `price × per`
 * coins; a free recipe (price or per 0) allows all runs.
 */
export const affordableRuns = (
  balance: number,
  price: number,
  per: number,
  runs: number
): number => {
  const costPerRun = price * per;
  if (costPerRun <= 0) return runs;
  return Math.min(runs, Math.floor(balance / costPerRun));
};

/**
 * Scale a collect's coin + goods OUTPUT by the production buffs (`xp` and
 * consumed inputs are unaffected, amounts floored):
 * - The Village Hall grants +3% village-wide production per level (`hallPerks`),
 * - the owner's house grants +2% per house tier to their OTHER buildings
 *   (`houseBonus`) — passed via `houseTier`, and excluded on the house itself
 *   (`isHouse`).
 *
 * The two percentages are summed into one integer numerator so the multiply is
 * exact — `100 × 1.15` drifts to 114.999… in IEEE754, but `100 × 115 / 100`
 * is exactly 115.
 */
export const applyHallBuff = (
  gained: Gained,
  hallLevel: number,
  houseTier: number,
  isHouse: boolean
): Gained => {
  const pct = 100 + hallPerks(hallLevel).productionPct + (isHouse ? 0 : houseBonus(houseTier));
  const scale = (v: number): number => Math.floor((v * pct) / 100);
  const goods: Partial<Record<Good, number>> = {};
  for (const g of GOODS) {
    const v = gained.goods[g];
    if (v) goods[g] = scale(v);
  }
  return { coins: scale(gained.coins), xp: gained.xp, goods };
};

// --- Quest counters (pure) --------------------------------------------------

/**
 * Processed-output units a collect yielded, for the `processedUnits` quest
 * counter: for a goods processor (windmill/sawmill/kiln) the output-good units
 * produced; for the bakery the flour runs consumed (its output is coins). 0 for
 * any non-processor. Pure — unit-tested.
 */
export const processedUnits = (
  buildingId: BuildingId | undefined,
  gained: Gained,
  consumed: Partial<Record<Good, number>>
): number => {
  if (!buildingId) return 0;
  const spec = CATALOG[buildingId];
  if (spec.role !== 'processor' || !spec.input || !spec.output) return 0;
  if (spec.output === 'coins') return consumed[spec.input.good] ?? 0;
  return gained.goods[spec.output] ?? 0;
};

// --- Sharing -----------------------------------------------------------------

export type ShareKind = 'levelup' | 'stage';

/** Max shares a single villager can post to the comments per day. */
export const SHARE_DAILY_LIMIT = 3;

/**
 * The flair-title band for a level, matching the milestone tiers surfaced in
 * share comments: Settler (<3), Builder (3-5), Architect (6-8), Alderman
 * (9-11), Founder (12+).
 */
export const flairTitle = (level: number): string => {
  if (level >= 12) return 'Founder';
  if (level >= 9) return 'Alderman';
  if (level >= 6) return 'Architect';
  if (level >= 3) return 'Builder';
  return 'Settler';
};

/** The comment body posted for a share milestone. Pure — unit-tested. */
export const shareText = (
  kind: ShareKind,
  value: number,
  name: string,
  subredditName: string
): string => {
  if (kind === 'levelup') {
    return `u/${name} just reached Level ${value} in Hearthvale — ${flairTitle(value)}!`;
  }
  return `The Village Hall reached Level ${value}/${KEEP_STAGES} — built together by the villagers of r/${subredditName}!`;
};

export type CollectResult = {
  tile: TileState;
  player: PlayerState;
  gained: Gained;
  /** Inputs pulled from the village stockpile (the caller writes these back). */
  consumed: Partial<Record<Good, number>>;
};

/**
 * Collect one tile against the real village `stockpile` (and `city.weather`).
 * Pure — the caller applies `consumed` to the stockpile and persists.
 *
 * - Raw producers + goods processors output goods into the OWNER'S wallet;
 *   house/manor + the bakery output coins.
 * - Processors consume `2 × runs` inputs from the stockpile and the owner PAYS
 *   `price × units`: the bakery nets it out of its minted coins (floored at 0),
 *   while goods processors pay from their coin balance — and if they cannot
 *   afford every run, the run count (output + consumption + cost) is trimmed to
 *   what they can afford (`affordableRuns`).
 * - The Village Hall production buff (+3%/level) and the owner's house aura
 *   (+2%/house tier, excluding the house itself) scale the OUTPUT after accrual.
 * - Only production coins feed `lifetimeEarned` (→ lb:earned); market income
 *   never does.
 */
export const applyCollect = (
  tile: TileState,
  player: PlayerState,
  city: CityState,
  now: number,
  adjBonus: number,
  stockpile: Stockpile,
  houseTier: number
): CollectResult => {
  const raw = accrue(tile, now, city.festival, adjBonus, city.weather, stockpile);
  let gained = raw.gained;
  let consumed = raw.consumed;

  const spec = tile.buildingId ? CATALOG[tile.buildingId] : undefined;
  const isHouse = spec?.special === 'house';

  let inputCost = 0;
  if (spec && spec.role === 'processor' && spec.input && spec.output) {
    const input = spec.input;
    const price = priceFor(stockpile[input.good], input.good);
    const consumedUnits = consumed[input.good] ?? 0;
    const runs = input.per > 0 ? Math.floor(consumedUnits / input.per) : 0;

    if (spec.output === 'coins') {
      inputCost = price * consumedUnits;
    } else {
      const affordable = affordableRuns(player.coins, price, input.per, runs);
      if (affordable < runs) {
        const outGood = spec.output;
        consumed = { [input.good]: affordable * input.per };
        gained = {
          coins: 0,
          xp: affordable,
          goods: affordable > 0 ? { [outGood]: affordable } : {},
        };
      }
      inputCost = price * (consumed[input.good] ?? 0);
    }
  }

  // Hall + house buffs scale the output only (never the consumed inputs).
  gained = applyHallBuff(gained, city.hallLevel, houseTier, isHouse);

  let netCoins = gained.coins;
  let paidFromBalance = 0;
  if (spec && spec.role === 'processor') {
    if (spec.output === 'coins') {
      netCoins = Math.max(0, gained.coins - inputCost);
      gained = { ...gained, coins: netCoins };
    } else {
      paidFromBalance = inputCost;
    }
  }

  const goodsOut = goodsTotal(gained.goods);
  // Consuming inputs counts as "did work" even if the net output floored to 0
  // (an underwater bakery) — so lastCollect advances and the draw is not repeated.
  const produced =
    netCoins + goodsOut > 0 || paidFromBalance > 0 || goodsTotal(consumed) > 0;

  let nextTile: TileState = { ...tile };
  let nextPlayer = player;

  if (produced) {
    const wallet = { ...player.wallet };
    for (const g of GOODS) {
      const v = gained.goods[g];
      if (v) wallet[g] = (wallet[g] ?? 0) + v;
    }
    nextPlayer = creditXp(
      {
        ...player,
        coins: player.coins + netCoins - paidFromBalance,
        wallet,
        // Absolute lifetime-earned counter drives the replay-safe lb:earned
        // score: re-applying the same collect result yields the same total.
        lifetimeEarned: player.lifetimeEarned + netCoins,
      },
      gained.xp
    );
    // Only advance lastCollect once we actually banked production, so that
    // sub-unit fractional progress is never silently discarded.
    nextTile.lastCollect = now;
    // A boost that has fully elapsed is now spent — clear it on write.
    if (tile.boostUntil > 0 && tile.boostUntil <= now) {
      nextTile = { ...nextTile, boostUntil: 0 };
      delete nextTile.boostBy;
    }
  }

  return { tile: nextTile, player: nextPlayer, gained, consumed };
};

// ---------------------------------------------------------------------------
// Side-effect helpers.
// ---------------------------------------------------------------------------

const FLAIR_AT: Record<number, string> = {
  3: 'Settler',
  6: 'Builder',
  9: 'Architect',
  12: 'Alderman',
  15: 'Founder',
};

const asT2 = (id: string): UserId => `t2_${id.replace(/^t2_/, '')}`;

const broadcastTile = async (key: string, tile: TileState): Promise<void> => {
  try {
    await realtime.send('village', { t: 'tile', key, tile });
  } catch (error) {
    console.error(`realtime tile broadcast failed for ${key}:`, error);
  }
};

const broadcastCity = async (city: CityState): Promise<void> => {
  try {
    await realtime.send('village', { t: 'city', city });
  } catch (error) {
    console.error('realtime city broadcast failed:', error);
  }
};

const broadcastStage = async (stage: number): Promise<void> => {
  try {
    await realtime.send('village', { t: 'stage', stage });
  } catch (error) {
    console.error('realtime stage broadcast failed:', error);
  }
};

export const broadcastFestival = async (
  festival: FestivalCategory
): Promise<void> => {
  try {
    await realtime.send('village', { t: 'festival', festival });
  } catch (error) {
    console.error('realtime festival broadcast failed:', error);
  }
};

const broadcastMarket = async (stockpile: Stockpile): Promise<void> => {
  try {
    await realtime.send('village', {
      t: 'market',
      prices: pricesFor(stockpile),
      stockpile,
    });
  } catch (error) {
    console.error('realtime market broadcast failed:', error);
  }
};

/** True when any good's price differs between two price lists — market
 * broadcasts are throttled to actual price movements, not every stock tick. */
const anyPriceChanged = (before: Prices, after: Prices): boolean =>
  GOODS.some((g) => before[g] !== after[g]);

const broadcastRing = async (bounds: {
  lo: number;
  hi: number;
}): Promise<void> => {
  try {
    await realtime.send('village', { t: 'ring', bounds });
  } catch (error) {
    console.error('realtime ring broadcast failed:', error);
  }
};

/**
 * Lazily roll today's weather if the persisted roll is stale (covers missed
 * scheduler runs). Returns the city with today's weather; persists on a change.
 */
const ensureWeather = async (
  city: CityState,
  now: number
): Promise<CityState> => {
  const today = utcDay(now);
  if (city.weatherDate === today) return city;
  const weather = weatherForDay(today);
  const next: CityState = { ...city, weather, weatherDate: today };
  await putCity({ weather, weatherDate: today });
  return next;
};

const maybeFlair = async (
  before: number,
  player: PlayerState
): Promise<void> => {
  if (player.level <= before) return;
  const text = FLAIR_AT[player.level];
  if (!text) return;
  try {
    await reddit.setUserFlair({
      subredditName: context.subredditName,
      username: player.name,
      text,
    });
  } catch (error) {
    console.error(`setUserFlair failed for ${player.name}:`, error);
  }
};

const resolveName = async (id: string): Promise<string> => {
  const cached = await redis.get(`uname:${id}`);
  if (cached) return cached;
  try {
    const user = await reddit.getUserById(asT2(id));
    if (user) {
      // Only persist a real, successful lookup — never cache the fallback, or a
      // transient failure would pin the player to 'villager' forever.
      await redis.set(`uname:${id}`, user.username);
      return user.username;
    }
  } catch (error) {
    console.error(`getUserById failed for ${id}:`, error);
  }
  return 'villager';
};

const ensurePlayer = async (userId: string): Promise<PlayerState> => {
  const existing = await getPlayer(userId);
  if (existing) return existing;
  const name = (await reddit.getCurrentUsername()) ?? 'villager';
  await redis.set(`uname:${userId}`, name);
  return initPlayer(userId, name);
};

// ---------------------------------------------------------------------------
// Operations.
// ---------------------------------------------------------------------------

/**
 * Lazily pay a player for Village Hall levels reached since they last collected.
 * Levels [player.paidStage, city.hallLevel) are done; for each level the player
 * funded (a positive score in `contrib:stage:{n}`) they earn their pro-rata
 * share of the `stagePot(n)` (min STAGE_MIN_PAYOUT). Advances paidStage.
 */
const settleStagePayouts = async (
  player: PlayerState,
  city: CityState
): Promise<PlayerState> => {
  if (player.paidStage >= city.hallLevel) return player;

  let coins = 0;
  for (let n = player.paidStage; n < city.hallLevel; n += 1) {
    const mine = await stageContribScore(n, player.id);
    if (mine <= 0) continue;
    const total = await stageContribTotal(n);
    coins += proRataPayout(stagePot(n), mine, total);
  }

  const settled: PlayerState = {
    ...player,
    coins: player.coins + coins,
    paidStage: city.hallLevel,
  };
  await putPlayer(settled);
  return settled;
};

/** The village population: the number of houses on the grid (one per settled
 * player, built free on their first claim). Pure. */
const countHouses = (grid: Record<string, TileState>): number => {
  let n = 0;
  for (const tile of Object.values(grid)) {
    if (tile.buildingId === 'house') n += 1;
  }
  return n;
};

/** The tier of a player's house, or 0 if they have not settled yet (used for
 * the house's personal production aura). Pure. */
const houseTierOf = (grid: Record<string, TileState>, userId: string): number => {
  for (const tile of Object.values(grid)) {
    if (tile.owner === userId && tile.buildingId === 'house') return tile.tier;
  }
  return 0;
};

/** Villagers (houses) needed to reach the next Village Hall level, or null once
 * the Hall is maxed. Drives the RingState `nextThreshold` display field. */
const hallNextPopulation = (hallLevel: number): number | null =>
  hallLevel < HALL_POPULATION.length ? HALL_POPULATION[hallLevel] ?? null : null;

/**
 * Land-expansion check: null if tile `(x, y)` is inside the ring unlocked at the
 * current Village Hall level, else the rejection message. Pure — unit-tested.
 */
export const expansionGate = (
  x: number,
  y: number,
  hallLevel: number
): string | null => {
  if (isUnlocked(x, y, hallLevel)) return null;
  return 'Upgrade the Village Hall to unlock this land.';
};

/** The player's active-quest view for a state response. The grid is already
 * loaded, so the snapshot is cheap. Falls back to the first quest at 0 progress
 * for a not-yet-initialised (null) player. */
const questView = (
  grid: Record<string, TileState>,
  me: PlayerState | null
): QuestView => {
  const index = me ? me.questIndex : 0;
  const lap = me ? me.questLap : 0;
  const quest = questAt(index, lap);
  const base = {
    index,
    lap,
    title: quest.title,
    blurb: quest.blurb,
    target: quest.target,
    reward: quest.reward,
  };
  if (!me) return { ...base, have: 0, done: false };
  const snap = questSnapshot(grid, me.id);
  const { have, done } = questProgress(quest, me, snap, me.questBaseline);
  return { ...base, have, done };
};

export const loadState = async (
  userId: string | undefined
): Promise<StateResponse> => {
  const now = Date.now();
  const [grid, cityRaw, stockpile] = await Promise.all([
    getGrid(),
    getCity(),
    getStockpile(),
  ]);
  const city = await ensureWeather(cityRaw, now);

  let me = userId ? await ensurePlayer(userId) : null;
  if (me) me = await settleStagePayouts(me, city);

  const rows = await redis.zRange(LB_VALUE, 0, 4, {
    reverse: true,
    by: 'rank',
  });
  const top: LeaderRow[] = [];
  for (const row of rows) {
    const name = await resolveName(row.member);
    top.push({ name, score: row.score, me: row.member === userId });
  }

  const today = utcDay(now);
  const traderDone = userId ? await hasTradedToday(today, userId) : false;
  const { lo, hi } = ringBounds(city.hallLevel);
  const offerCount = hallPerks(city.hallLevel).traderOffers;

  return {
    grid,
    city,
    me,
    now,
    top,
    stockpile,
    prices: pricesFor(stockpile),
    weather: city.weather,
    trader: { offers: offersForDay(today, offerCount), done: traderDone },
    ring: {
      lo,
      hi,
      nextThreshold: hallNextPopulation(city.hallLevel),
      population: city.population,
    },
    quest: questView(grid, me),
  };
};

export const doClaim = async (
  userId: string,
  x: number,
  y: number
): Promise<{ tile: TileState; me: PlayerState }> => {
  const key = tileKey(x, y);
  const now = Date.now();
  const [grid, player, city] = await Promise.all([
    getGrid(),
    ensurePlayer(userId),
    getCity(),
  ]);
  const owned = ownedCount(grid, userId);
  const wasOwner = owned > 0;

  const err = canClaim(grid, x, y, player, owned, city.hallLevel);
  if (err) throw new OpError(400, err);

  // Land expansion is gated by the Village Hall level: locked outer tiles reject
  // claims until the Hall is upgraded to unlock the next ring.
  const gate = expansionGate(x, y, city.hallLevel);
  if (gate) throw new OpError(400, gate);

  const tx = await redis.watch(GRID_KEY);
  const existing = await getTile(key);
  if (existing) {
    await tx.unwatch();
    throw new OpError(409, 'That tile was just claimed by someone else.');
  }

  const tile: TileState = {
    owner: userId,
    ownerName: player.name,
    tier: 1,
    builtAt: 0,
    readyAt: 0,
    lastCollect: 0,
    boostUntil: 0,
  };
  // A player's FIRST claim founds their homestead: the House is placed free (no
  // coin cost), building immediately. It anchors every later claim and counts
  // as population.
  if (!wasOwner) {
    const houseReady = now + tierStats(CATALOG.house, 1).buildSeconds * 1000;
    tile.buildingId = 'house';
    tile.builtAt = now;
    tile.readyAt = houseReady;
    tile.lastCollect = houseReady;
  }

  await tx.multi();
  await tx.hSet(GRID_KEY, { [key]: JSON.stringify(tile) });
  let result: unknown[];
  try {
    result = await tx.exec();
  } catch {
    throw new OpError(409, 'That tile was just claimed by someone else.');
  }
  if (!result || result.length === 0) {
    throw new OpError(409, 'That tile was just claimed by someone else.');
  }

  await broadcastTile(key, tile);

  // A new house grows the population; the extra villager may itself complete a
  // pending Village Hall level-up (resources already met, waiting on people).
  if (!wasOwner) {
    const newPopulation = countHouses(grid) + 1;
    const levelUp = tryHallLevelUp(city, newPopulation, KEEP_STAGE_COSTS);
    await putCity({
      population: newPopulation,
      hallLevel: levelUp.hallLevel,
      stagePlanks: levelUp.stagePlanks,
      stageBricks: levelUp.stageBricks,
    });
    if (levelUp.leveled.length > 0) {
      await broadcastCity({
        ...city,
        population: newPopulation,
        hallLevel: levelUp.hallLevel,
        stagePlanks: levelUp.stagePlanks,
        stageBricks: levelUp.stageBricks,
      });
      for (const level of levelUp.leveled) await broadcastStage(level);
      await broadcastRing(ringBounds(levelUp.hallLevel));
      await celebrateHallLevel(levelUp.hallLevel);
    }
  }

  return { tile, me: player };
};

/** Best-effort app-account comment celebrating a Village Hall level-up (which
 * also unlocks a new land ring). */
const celebrateHallLevel = async (level: number): Promise<void> => {
  const postId = context.postId;
  if (!postId) return;
  try {
    await reddit.submitComment({
      id: postId,
      text: `The Village Hall reached Level ${level}! New land unlocked for the whole village.`,
      runAs: 'APP',
    });
  } catch (error) {
    console.error('hall level-up celebration comment failed:', error);
  }
};

export const doBuild = async (
  userId: string,
  x: number,
  y: number,
  buildingId: BuildingId
): Promise<{ tile: TileState; me: PlayerState }> => {
  const key = tileKey(x, y);
  const [tile, player] = await Promise.all([getTile(key), ensurePlayer(userId)]);
  if (!tile) throw new OpError(404, 'You must claim this plot first.');

  const spec = CATALOG[buildingId];
  const err = validateBuild(player, tile, spec);
  if (err) throw new OpError(400, err);

  const now = Date.now();
  const stats = tierStats(spec, 1);
  const readyAt = now + stats.buildSeconds * 1000;
  const newTile: TileState = {
    ...tile,
    buildingId,
    tier: 1,
    builtAt: now,
    readyAt,
    lastCollect: readyAt,
  };

  const before = player.level;
  const me = creditXp(
    {
      ...player,
      coins: player.coins - spec.cost,
      valueSpent: player.valueSpent + spec.cost,
    },
    Math.floor(spec.cost / 10)
  );

  await putTile(key, newTile);
  await putPlayer(me);
  // Absolute write: racing duplicate builds converge on the same lb:value score
  // instead of double-counting the cost the player only paid once.
  await redis.zAdd(LB_VALUE, { member: userId, score: me.valueSpent });
  await maybeFlair(before, me);
  await broadcastTile(key, newTile);
  return { tile: newTile, me };
};

export const doUpgrade = async (
  userId: string,
  x: number,
  y: number
): Promise<{ tile: TileState; me: PlayerState }> => {
  const key = tileKey(x, y);
  const [tile, player, grid, cityRaw] = await Promise.all([
    getTile(key),
    ensurePlayer(userId),
    getGrid(),
    getCity(),
  ]);
  if (!tile) throw new OpError(404, 'You must claim this plot first.');
  if (!tile.buildingId) {
    throw new OpError(400, 'There is no building here to upgrade.');
  }

  const spec = CATALOG[tile.buildingId];
  const now = Date.now();
  const err = validateUpgrade(player, tile, now);
  if (err) throw new OpError(400, err);

  const city = await ensureWeather(cityRaw, now);
  const stockpile = await getStockpile();

  // Auto-collect pending production before the timer resets.
  const adj = adjacencyBonus(grid, x, y, city.festival, now);
  const houseTier = houseTierOf(grid, userId);
  const collected = applyCollect(tile, player, city, now, adj, stockpile, houseTier);
  const pending = collected.gained;

  const nextTier: Tier = tile.tier === 1 ? 2 : 3;
  const stats = tierStats(spec, nextTier);
  if (collected.player.coins < stats.cost) {
    throw new OpError(400, 'Not enough coins to upgrade this.');
  }

  const readyAt = now + stats.buildSeconds * 1000;
  const upgraded: TileState = {
    ...collected.tile,
    tier: nextTier,
    builtAt: now,
    readyAt,
    lastCollect: readyAt,
  };

  const before = player.level;
  // collected.player already carries the auto-collect's lifetimeEarned bump.
  const me = creditXp(
    {
      ...collected.player,
      coins: collected.player.coins - stats.cost,
      valueSpent: collected.player.valueSpent + stats.cost,
    },
    Math.floor(stats.cost / 10)
  );

  const stockChanged = goodsTotal(collected.consumed) > 0;
  const pricesBefore = pricesFor(stockpile);
  if (stockChanged) {
    for (const g of GOODS) stockpile[g] -= collected.consumed[g] ?? 0;
    await putStockpile(stockpile);
  }

  await putTile(key, upgraded);
  await putPlayer(me);
  // Absolute writes derived from the player's lifetime counters — replay-safe
  // under concurrent duplicate upgrades.
  await redis.zAdd(LB_VALUE, { member: userId, score: me.valueSpent });
  const bankedResources = pending.coins + goodsTotal(pending.goods);
  if (bankedResources > 0) {
    if (pending.coins > 0) {
      await redis.zAdd(LB_EARNED, { member: userId, score: me.lifetimeEarned });
    }
    await putCity({ totalCollected: city.totalCollected + bankedResources });
  }
  await maybeFlair(before, me);
  await broadcastTile(key, upgraded);
  if (stockChanged && anyPriceChanged(pricesBefore, pricesFor(stockpile))) {
    await broadcastMarket(stockpile);
  }
  return { tile: upgraded, me };
};

/**
 * Demolish the player's own building. Allowed at any time (including mid-build);
 * the build already deducted the full cost, so the 50%-of-invested refund is
 * never an exploit. Clears the building state from the tile but KEEPS the owner
 * claim, credits the refund to the wallet, and broadcasts the cleared tile.
 *
 * Lifetime counters are deliberately left untouched: `valueSpent` (→ lb:value)
 * and `lifetimeEarned` reflect lifetime activity by design and are not reversed
 * — demolishing does not launder value off the board.
 */
export const doDemolish = async (
  userId: string,
  x: number,
  y: number
): Promise<{ tile: TileState; me: PlayerState }> => {
  const key = tileKey(x, y);
  const [tile, player] = await Promise.all([getTile(key), ensurePlayer(userId)]);
  if (!tile) throw new OpError(404, 'You must claim this plot first.');

  const err = validateDemolish(player, tile);
  if (err) throw new OpError(400, err);

  const bid = tile.buildingId;
  if (!bid) throw new OpError(400, 'There is no building here to demolish.');
  const refund = demolishRefund(CATALOG[bid], tile.tier);

  // Reset to a bare claimed plot: drops buildingId/boostBy/cosmetic and zeroes
  // the timers, keeping only the owner claim (tier back to 1).
  const cleared: TileState = {
    owner: tile.owner,
    ownerName: tile.ownerName,
    tier: 1,
    builtAt: 0,
    readyAt: 0,
    lastCollect: 0,
    boostUntil: 0,
  };

  const me: PlayerState = { ...player, coins: player.coins + refund };

  await putTile(key, cleared);
  await putPlayer(me);
  await broadcastTile(key, cleared);
  return { tile: cleared, me };
};

export const doCollect = async (
  userId: string,
  x: number,
  y: number
): Promise<{ tile: TileState; me: PlayerState; gained: Gained }> => {
  const key = tileKey(x, y);
  const [tile, player, grid, cityRaw] = await Promise.all([
    getTile(key),
    ensurePlayer(userId),
    getGrid(),
    getCity(),
  ]);
  if (!tile) throw new OpError(404, 'You must claim this plot first.');
  if (tile.owner !== userId) throw new OpError(403, 'You do not own this plot.');
  if (!tile.buildingId) {
    throw new OpError(400, 'There is nothing to collect here.');
  }

  const now = Date.now();
  const city = await ensureWeather(cityRaw, now);
  const stockpile = await getStockpile();

  const adj = adjacencyBonus(grid, x, y, city.festival, now);
  const houseTier = houseTierOf(grid, userId);
  const pricesBefore = pricesFor(stockpile);
  const result = applyCollect(tile, player, city, now, adj, stockpile, houseTier);
  const gained = result.gained;
  const banked = gained.coins + goodsTotal(gained.goods);
  const stockChanged = goodsTotal(result.consumed) > 0;
  const produced = banked > 0 || stockChanged;

  // Quest counters: one collect (banked > 0) and any processed output produced.
  const proc = processedUnits(tile.buildingId, gained, result.consumed);
  const me: PlayerState = {
    ...result.player,
    collects: result.player.collects + (banked > 0 ? 1 : 0),
    processedUnits: result.player.processedUnits + proc,
  };

  await putTile(key, result.tile);
  if (produced) {
    await putPlayer(me);
    if (gained.coins > 0) {
      await redis.zAdd(LB_EARNED, {
        member: userId,
        score: me.lifetimeEarned,
      });
    }
    await putCity({
      totalCollected: city.totalCollected + banked,
    });
    await maybeFlair(player.level, me);
  }
  if (stockChanged) {
    for (const g of GOODS) stockpile[g] -= result.consumed[g] ?? 0;
    await putStockpile(stockpile);
  }
  await broadcastTile(key, result.tile);
  if (stockChanged && anyPriceChanged(pricesBefore, pricesFor(stockpile))) {
    await broadcastMarket(stockpile);
  }
  return { tile: result.tile, me, gained };
};

export const doCollectAll = async (
  userId: string
): Promise<{ tiles: Record<string, TileState>; me: PlayerState; gained: Gained }> => {
  const [grid, initial, cityRaw] = await Promise.all([
    getGrid(),
    ensurePlayer(userId),
    getCity(),
  ]);

  const now = Date.now();
  const city = await ensureWeather(cityRaw, now);
  const stockpile = await getStockpile();
  const pricesBefore = pricesFor(stockpile);

  const startLevel = initial.level;
  const houseTier = houseTierOf(grid, userId);
  let me = initial;
  const total: Gained = { coins: 0, xp: 0, goods: {} };
  const changed: Array<{ key: string; tile: TileState }> = [];
  let stockChanged = false;
  // Quest counters: one collect per producing tile, plus total processed output.
  let collectsBump = 0;
  let processedBump = 0;

  for (const [key, tile] of Object.entries(grid)) {
    if (tile.owner !== userId || !tile.buildingId) continue;
    const { x, y } = parseKey(key);
    const adj = adjacencyBonus(grid, x, y, city.festival, now);
    // Thread the (mutating) stockpile so later processors see earlier draws.
    const result = applyCollect(tile, me, city, now, adj, stockpile, houseTier);
    me = result.player;
    total.coins += result.gained.coins;
    total.goods = mergeGoods(total.goods, result.gained.goods);
    total.xp += result.gained.xp;
    const consumedUnits = goodsTotal(result.consumed);
    if (consumedUnits > 0) {
      for (const g of GOODS) stockpile[g] -= result.consumed[g] ?? 0;
      stockChanged = true;
    }
    const banked = result.gained.coins + goodsTotal(result.gained.goods);
    if (banked > 0) collectsBump += 1;
    processedBump += processedUnits(tile.buildingId, result.gained, result.consumed);
    const boostChanged = result.tile.boostUntil !== tile.boostUntil;
    if (banked > 0 || boostChanged || consumedUnits > 0) {
      changed.push({ key, tile: result.tile });
    }
  }

  me = {
    ...me,
    collects: me.collects + collectsBump,
    processedUnits: me.processedUnits + processedBump,
  };

  for (const { key, tile } of changed) {
    await putTile(key, tile);
  }
  const bankedTotal = total.coins + goodsTotal(total.goods);
  const produced = bankedTotal > 0 || stockChanged;
  if (produced) {
    await putPlayer(me);
    if (total.coins > 0) {
      await redis.zAdd(LB_EARNED, { member: userId, score: me.lifetimeEarned });
    }
    await putCity({
      totalCollected: city.totalCollected + bankedTotal,
    });
    await maybeFlair(startLevel, me);
  }
  if (stockChanged) await putStockpile(stockpile);
  for (const { key, tile } of changed) {
    await broadcastTile(key, tile);
  }
  if (stockChanged && anyPriceChanged(pricesBefore, pricesFor(stockpile))) {
    await broadcastMarket(stockpile);
  }

  const tiles: Record<string, TileState> = {};
  for (const { key, tile } of changed) {
    tiles[key] = tile;
  }

  return { tiles, me, gained: total };
};

/** The good with the highest price-to-base ratio — what the village needs most. */
const hottestGood = (stockpile: Stockpile): { good: Good; price: number } => {
  let best: Good = 'wheat';
  let bestRatio = -Infinity;
  for (const g of GOODS) {
    const price = priceFor(stockpile[g], g);
    const ratio = price / MARKET[g].base;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = g;
    }
  }
  return { good: best, price: priceFor(stockpile[best], best) };
};

export const loadSummary = async (
  userId: string | undefined
): Promise<Summary> => {
  const now = Date.now();
  const [grid, cityRaw, stockpile] = await Promise.all([
    getGrid(),
    getCity(),
    getStockpile(),
  ]);
  const city = await ensureWeather(cityRaw, now);

  const owners = new Set<string>();
  let buildings = 0;
  for (const tile of Object.values(grid)) {
    owners.add(tile.owner);
    if (tile.buildingId) buildings += 1;
  }

  const hallLevel = city.hallLevel;
  let landmarkPct = 100;
  if (hallLevel < KEEP_STAGES) {
    const cost = KEEP_STAGE_COSTS[hallLevel] ?? { planks: 1, bricks: 1 };
    const need = cost.planks + cost.bricks;
    const have = city.stagePlanks + city.stageBricks;
    landmarkPct = Math.max(0, Math.min(100, Math.floor((have / need) * 100)));
  }

  let readyForMe = 0;
  if (userId) {
    for (const [key, tile] of Object.entries(grid)) {
      if (tile.owner !== userId || !tile.buildingId) continue;
      const { x, y } = parseKey(key);
      const adj = adjacencyBonus(grid, x, y, city.festival, now);
      const { gained } = accrue(
        tile,
        now,
        city.festival,
        adj,
        city.weather,
        stockpile
      );
      if (gained.coins + goodsTotal(gained.goods) > 0) readyForMe += 1;
    }
  }

  const hot = hottestGood(stockpile);
  return {
    villageName: city.villageName,
    theme: city.theme,
    buildings,
    players: owners.size,
    hallLevel,
    landmarkPct,
    festival: city.festival,
    readyForMe,
    weather: city.weather,
    hotGood: hot.good,
    hotPrice: hot.price,
  };
};

export const doCheckIn = async (
  userId: string
): Promise<{ me: PlayerState; gained: { coins: number; xp: number } }> => {
  const player = await ensurePlayer(userId);
  const today = utcDay(Date.now());

  const err = canCheckIn(player.lastCheckIn, today);
  if (err) throw new OpError(400, err);

  const streak = nextStreak(player.lastCheckIn, player.streak, today);
  const coins = streakReward(streak);
  const before = player.level;
  // Credit the check-in XP through the level-up helper so a milestone check-in
  // updates level/plots (and flair below) — the trickle that unlocks plot #2.
  const me = creditXp(
    {
      ...player,
      streak,
      lastCheckIn: today,
      coins: player.coins + coins,
    },
    CHECKIN_XP
  );

  await putPlayer(me);
  await maybeFlair(before, me);
  return { me, gained: { coins, xp: CHECKIN_XP } };
};

export const doBoost = async (
  userId: string,
  x: number,
  y: number
): Promise<{ tile: TileState; me: PlayerState }> => {
  const key = tileKey(x, y);
  const [tile, player, city] = await Promise.all([
    getTile(key),
    ensurePlayer(userId),
    getCity(),
  ]);
  if (!tile) throw new OpError(404, 'There is nothing to boost here.');

  const now = Date.now();
  const today = utcDay(now);
  const used = boostsUsedToday(player, today);
  const limit = hallPerks(city.hallLevel).boostLimit;
  const err = validateBoost(userId, tile, now, used, limit);
  if (err) throw new OpError(400, err);

  const boosted: TileState = {
    ...tile,
    boostUntil: now + BOOST_DURATION_MS,
    boostBy: userId,
  };

  const before = player.level;
  // `me` is the BOOSTER's state: +15 coins, +5 xp, one boost spent today.
  const me = creditXp(
    {
      ...player,
      coins: player.coins + BOOST_COINS,
      boostsToday: used + 1,
      boostsDate: today,
      // Lifetime quest counter (distinct from the per-day boostsToday cap).
      boostsGiven: player.boostsGiven + 1,
    },
    BOOST_XP
  );

  await putTile(key, boosted);
  await putPlayer(me);
  await maybeFlair(before, me);
  await broadcastTile(key, boosted);
  return { tile: boosted, me };
};

/**
 * Paint a stacked building's roof a chosen colour for a flat PAINT_COST. The
 * roof colour is purely cosmetic; the golden-roof cosmetic still overrides it
 * visually on the client. Broadcasts the updated tile.
 */
export const doPaint = async (
  userId: string,
  x: number,
  y: number,
  color: RoofColor
): Promise<{ tile: TileState; me: PlayerState }> => {
  const key = tileKey(x, y);
  const [tile, player] = await Promise.all([getTile(key), ensurePlayer(userId)]);
  if (!tile) throw new OpError(404, 'You must claim this plot first.');

  const now = Date.now();
  const err = validatePaint(player, tile, now);
  if (err) throw new OpError(400, err);

  const painted: TileState = { ...tile, roofColor: color };
  const me: PlayerState = { ...player, coins: player.coins - PAINT_COST };

  await putTile(key, painted);
  await putPlayer(me);
  await broadcastTile(key, painted);
  return { tile: painted, me };
};

/**
 * Mod-set village name + theme (from the "Village settings" form). Validates the
 * name server-side, persists both to city:state, then broadcasts the fresh city
 * so open clients rename/retheme live. Returns the updated city.
 */
export const doVillageSettings = async (
  rawName: unknown,
  rawTheme: unknown
): Promise<CityState> => {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!isValidVillageName(name)) {
    throw new OpError(
      400,
      'Village name may use up to 24 letters, numbers, spaces, apostrophes or hyphens.'
    );
  }
  const theme: VillageTheme = isVillageTheme(rawTheme) ? rawTheme : 'meadow';

  await putCity({ villageName: name, theme });
  const city = await getCity();
  await broadcastCity(city);
  return city;
};

export const doContribute = async (
  userId: string,
  good: 'planks' | 'bricks',
  qty: number
): Promise<{ city: CityState; me: PlayerState }> => {
  const [player, city] = await Promise.all([ensurePlayer(userId), getCity()]);

  if (landmarkComplete(city)) {
    throw new OpError(400, 'The Village Hall is already at its highest level.');
  }
  const held = player.wallet[good];
  if (held <= 0) {
    throw new OpError(400, `You have no ${good} to contribute.`);
  }

  const clamped = Math.min(qty, held);
  const result = applyKeepContribution(city, good, clamped, KEEP_STAGE_COSTS);
  if (result.applied <= 0) {
    // This good's requirement for the current Hall level is already met.
    throw new OpError(
      400,
      `The Village Hall does not need more ${good} for this level yet.`
    );
  }

  const before = player.level;
  // Units returned by the refund rule stay in the wallet; only `applied` leaves.
  const wallet = { ...player.wallet, [good]: held - result.applied };
  // 1 xp per unit contributed, credited through the level-up helper. The
  // absolute lifetimeContributed counter drives the replay-safe lb:contrib
  // score below.
  const me = creditXp(
    {
      ...player,
      wallet,
      lifetimeContributed: player.lifetimeContributed + result.applied,
    },
    result.applied
  );

  // Filling the resources may complete a Hall level-up — but only if the
  // population threshold is also met (population is the cached house count).
  const filledCity: CityState = {
    ...city,
    stagePlanks: result.stagePlanks,
    stageBricks: result.stageBricks,
  };
  const levelUp = tryHallLevelUp(filledCity, city.population, KEEP_STAGE_COSTS);

  // Per-level zsets keep zIncrBy (display + pro-rata payout weighting). The
  // cross-level lb:contrib leaderboard uses an absolute zAdd so racing duplicate
  // contributions converge instead of summing.
  for (const split of result.splits) {
    await incrStageContrib(split.stage, userId, split.amount);
  }
  await redis.zAdd(LB_CONTRIB, { member: userId, score: me.lifetimeContributed });

  const nextCity: CityState = {
    ...city,
    hallLevel: levelUp.hallLevel,
    stagePlanks: levelUp.stagePlanks,
    stageBricks: levelUp.stageBricks,
    totalContributed: city.totalContributed + result.applied,
  };

  await putCity({
    hallLevel: nextCity.hallLevel,
    stagePlanks: nextCity.stagePlanks,
    stageBricks: nextCity.stageBricks,
    totalContributed: nextCity.totalContributed,
  });
  await putPlayer(me);
  await maybeFlair(before, me);
  await broadcastCity(nextCity);
  // One {t:'stage'} broadcast per Hall level reached; a level-up also opens a
  // new land ring and earns a celebratory comment.
  for (const level of levelUp.leveled) {
    await broadcastStage(level);
  }
  if (levelUp.leveled.length > 0) {
    await broadcastRing(ringBounds(levelUp.hallLevel));
    await celebrateHallLevel(levelUp.hallLevel);
  }
  return { city: nextCity, me };
};

// --- Market: sell / buy -----------------------------------------------------

/**
 * Run a market trade as an optimistic transaction (the same pattern doClaim
 * uses): watch the stockpile + player hashes, re-read both inside the watch
 * window, let `mutate` validate and produce the post-trade states, then write
 * both hashes atomically. A concurrent write to either key voids the exec and
 * surfaces a retryable 409.
 */
const marketTx = async (
  userId: string,
  mutate: (
    player: PlayerState,
    stockpile: Stockpile
  ) => { me: PlayerState; nextStock: Stockpile }
): Promise<{ me: PlayerState; stockpile: Stockpile; prices: Prices }> => {
  // Ensure the player hash exists before entering the watch window.
  await ensurePlayer(userId);

  const tx = await redis.watch(STOCKPILE_KEY, playerRedisKey(userId));
  // Re-read both inside the watch window; any concurrent mutation of either
  // hash after this point aborts the exec below.
  const [player, stockpile] = await Promise.all([
    getPlayer(userId),
    getStockpile(),
  ]);
  if (!player) {
    await tx.unwatch();
    throw new OpError(500, 'Player state unavailable.');
  }

  let me: PlayerState;
  let nextStock: Stockpile;
  try {
    ({ me, nextStock } = mutate(player, stockpile));
  } catch (error) {
    await tx.unwatch();
    throw error;
  }

  await tx.multi();
  await tx.hSet(playerRedisKey(userId), playerFields(me));
  await tx.hSet(STOCKPILE_KEY, stockpileFields(nextStock));
  let result: unknown[];
  try {
    result = await tx.exec();
  } catch {
    throw new OpError(409, 'The market just moved — try again.');
  }
  if (!result || result.length === 0) {
    throw new OpError(409, 'The market just moved — try again.');
  }

  // Broadcast only when a price actually changed (throttles stock-only ticks).
  if (anyPriceChanged(pricesFor(stockpile), pricesFor(nextStock))) {
    await broadcastMarket(nextStock);
  }
  return { me, stockpile: nextStock, prices: pricesFor(nextStock) };
};

export const doSell = async (
  userId: string,
  good: Good,
  qty: number
): Promise<{ me: PlayerState; stockpile: Stockpile; prices: Prices }> => {
  // The per-order sell cap rises with the Village Hall (`sellCap` perk).
  const city = await getCity();
  const cap = hallPerks(city.hallLevel).sellCap;
  if (qty > cap) {
    throw new OpError(400, `You can sell at most ${cap} ${good} in one order.`);
  }
  return marketTx(userId, (player, stockpile) => {
    const held = player.wallet[good];
    if (held <= 0) throw new OpError(400, `You have no ${good} to sell.`);

    const amount = Math.min(qty, held);
    const before = stockpile[good];
    const coins = sellValue(amount, before, good);

    // Market income is deliberately NOT counted toward lb:earned (production
    // only). soldUnits (a quest counter) tracks the units actually sold.
    const me: PlayerState = {
      ...player,
      coins: player.coins + coins,
      wallet: { ...player.wallet, [good]: held - amount },
      soldUnits: player.soldUnits + amount,
    };
    const nextStock: Stockpile = { ...stockpile, [good]: before + amount };
    return { me, nextStock };
  });
};

export const doBuy = async (
  userId: string,
  good: Good,
  qty: number
): Promise<{ me: PlayerState; stockpile: Stockpile; prices: Prices }> =>
  marketTx(userId, (player, stockpile) => {
    const before = stockpile[good];
    if (before < qty) {
      throw new OpError(400, `The market only has ${before} ${good}.`);
    }
    const cost = buyValue(qty, before, good);
    if (player.coins < cost) throw new OpError(400, 'Not enough coins.');

    const me: PlayerState = {
      ...player,
      coins: player.coins - cost,
      wallet: { ...player.wallet, [good]: player.wallet[good] + qty },
    };
    const nextStock: Stockpile = { ...stockpile, [good]: before - qty };
    return { me, nextStock };
  });

// --- Wandering trader -------------------------------------------------------

/** Whether a wallet can cover an offer's `give` side. */
export const canAffordOffer = (
  wallet: PlayerState['wallet'],
  offer: TraderOffer
): boolean => wallet[offer.give.good] >= offer.give.qty;

/**
 * Validate a trade attempt: rejects an already-used daily trade or a wallet that
 * cannot cover the offer's `give` side. Pure — unit-tested.
 */
export const validateTrade = (
  alreadyTraded: boolean,
  wallet: PlayerState['wallet'],
  offer: TraderOffer
): string | null => {
  if (alreadyTraded) return 'You have already traded today.';
  if (!canAffordOffer(wallet, offer)) {
    return `You need ${offer.give.qty} ${offer.give.good}.`;
  }
  return null;
};

export const doTrade = async (
  userId: string,
  offerIndex: number
): Promise<{ me: PlayerState; tile?: { key: string; tile: TileState } }> => {
  const [player, city] = await Promise.all([ensurePlayer(userId), getCity()]);
  const today = utcDay(Date.now());

  const offers = offersForDay(today, hallPerks(city.hallLevel).traderOffers);
  const offer = offers[offerIndex];
  if (!offer) throw new OpError(400, 'That trade offer does not exist.');

  // Advisory pre-check (friendly early rejection with the exact reason)…
  const alreadyTraded = await hasTradedToday(today, userId);
  const err = validateTrade(alreadyTraded, player.wallet, offer);
  if (err) throw new OpError(400, err);

  // …then the atomic claim: hSetNX means racing duplicate requests cannot both
  // pass the once-per-day gate — exactly one wins the flag, the rest reject.
  // Claimed only after wallet validation so a failed attempt never locks the
  // player out of their daily trade.
  if (!(await claimDailyTrade(today, userId))) {
    throw new OpError(400, 'You have already traded today.');
  }

  const wallet = {
    ...player.wallet,
    [offer.give.good]: player.wallet[offer.give.good] - offer.give.qty,
  };

  let cosmeticTile: { key: string; tile: TileState } | undefined;

  if ('cosmetic' in offer.get) {
    // SIMPLIFICATION (documented): the golden-roof cosmetic is auto-applied to
    // the player's highest-value building tile (by tier, then build cost).
    const grid = await getGrid();
    let bestKey: string | null = null;
    let bestScore = -1;
    for (const [key, tile] of Object.entries(grid)) {
      if (tile.owner !== userId || !tile.buildingId) continue;
      const score = tile.tier * 10000 + CATALOG[tile.buildingId].cost;
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
    if (!bestKey) {
      throw new OpError(400, 'You need a building for the golden roof.');
    }
    const chosen = grid[bestKey];
    if (!chosen) throw new OpError(400, 'You need a building for the golden roof.');
    const decorated: TileState = { ...chosen, cosmetic: offer.get.cosmetic };
    await putTile(bestKey, decorated);
    await broadcastTile(bestKey, decorated);
    cosmeticTile = { key: bestKey, tile: decorated };
  } else {
    wallet[offer.get.good] += offer.get.qty;
  }

  const me: PlayerState = {
    ...player,
    wallet,
    tradesDone: player.tradesDone + 1,
  };
  await putPlayer(me);
  return { me, ...(cosmeticTile ? { tile: cosmeticTile } : {}) };
};

// --- Grand Keep stage naming ------------------------------------------------

/** Join two word-list picks into a stage name; null if either index is bad. */
export const stageNameFromWords = (
  first: number,
  second: number
): string | null => {
  const adj = STAGE_NAME_WORDS.adjectives[first];
  const noun = STAGE_NAME_WORDS.nouns[second];
  if (adj === undefined || noun === undefined) return null;
  return `${adj} ${noun}`;
};

/**
 * Validate a stage-naming attempt. Only the LAST completed Hall level (index
 * `hallLevel - 1`) may be named, only once, and only by that level's top
 * contributor. Returns null when allowed, else the rejection message. Pure —
 * unit-tested.
 */
export const validateNaming = (
  hallLevel: number,
  stageNames: string[],
  topContributor: string | null,
  userId: string
): string | null => {
  const stage = hallLevel - 1;
  if (stage < 0) return 'No stage has been completed yet.';
  if (stageNames[stage]) return 'That stage has already been named.';
  if (topContributor !== userId) {
    return 'Only the stage’s top contributor may name it.';
  }
  return null;
};

export const doNameStage = async (
  userId: string,
  first: number,
  second: number
): Promise<{ city: CityState }> => {
  const city = await getCity();
  const stage = city.hallLevel - 1;
  const top = stage >= 0 ? await stageTopContributor(stage) : null;
  const err = validateNaming(city.hallLevel, city.stageNames, top, userId);
  if (err) {
    throw new OpError(err.startsWith('Only') ? 403 : 400, err);
  }

  const name = stageNameFromWords(first, second);
  if (name === null) throw new OpError(400, 'Invalid stage-name selection.');

  const stageNames = [...city.stageNames];
  stageNames[stage] = name;
  const nextCity: CityState = { ...city, stageNames };
  await putCity({ stageNames });
  await broadcastCity(nextCity);
  return { city: nextCity };
};

export const doVote = async (
  userId: string,
  category: FestivalCategory
): Promise<{ counts: Record<FestivalCategory, number> }> => {
  const today = utcDay(Date.now());
  if (await hasVoted(today, userId)) {
    throw new OpError(400, 'You have already voted today.');
  }
  // Vote is per-day gated in redis but the lifetime votesCast quest counter needs
  // a player write — doVote otherwise never touches the player hash.
  const player = await ensurePlayer(userId);
  await recordVote(today, userId, category);
  await putPlayer({ ...player, votesCast: player.votesCast + 1 });
  const counts = await getBallot(today);
  return { counts };
};

/**
 * Claim the reward for the player's active Villager's Journal quest and advance
 * the ladder. Personal self-mutation (no broadcast): the standard
 * read-modify-write is sufficient, matching check-in. Validates completion with
 * a baseline-aware snapshot; credits coins directly and xp through the level-up
 * helper; then advances questIndex/lap and captures the next repeatable baseline.
 */
export const doClaimQuest = async (
  userId: string
): Promise<ClaimQuestResponse> => {
  const [grid, player] = await Promise.all([getGrid(), ensurePlayer(userId)]);
  const quest = questAt(player.questIndex, player.questLap);
  const snap = questSnapshot(grid, userId);
  const err = claimQuestError(quest, player, snap, player.questBaseline);
  if (err) throw new OpError(400, err);

  const coins = quest.reward.coins ?? 0;
  const xp = quest.reward.xp ?? 0;
  const before = player.level;
  const next = advanceQuest(player.questIndex, player.questLap);

  let me: PlayerState = {
    ...player,
    coins: player.coins + coins,
    questIndex: next.index,
    questLap: next.lap,
  };
  // Credit xp through the level-up helper (like check-in) so a reward can level.
  if (xp > 0) me = creditXp(me, xp);
  // Baseline for the next quest: 0 for chain, else the current metric value (the
  // grid is unchanged and reward coins/xp never move a repeatable's metric).
  me = { ...me, questBaseline: questBaselineFor(next.index, next.lap, me, snap) };

  await putPlayer(me);
  await maybeFlair(before, me);
  return {
    me,
    quest: { index: player.questIndex, lap: player.questLap },
    gained: { coins, xp },
  };
};

const topRows = async (
  key: string,
  userId: string | undefined
): Promise<LeaderRow[]> => {
  const rows = await redis.zRange(key, 0, 9, { reverse: true, by: 'rank' });
  const out: LeaderRow[] = [];
  for (const row of rows) {
    const name = await resolveName(row.member);
    out.push({ name, score: row.score, me: row.member === userId });
  }
  return out;
};

export const loadLeaderboards = async (
  userId: string | undefined
): Promise<{
  value: LeaderRow[];
  earned: LeaderRow[];
  contrib: LeaderRow[];
}> => {
  const [value, earned, contrib] = await Promise.all([
    topRows(LB_VALUE, userId),
    topRows(LB_EARNED, userId),
    topRows(LB_CONTRIB, userId),
  ]);
  return { value, earned, contrib };
};

/**
 * The daily cycle's economy roll: tally yesterday's ballot into today's festival
 * (majority wins; a tie or empty ballot rotates from the current festival) and
 * roll today's weather, persist both, and broadcast. Returns the festival +
 * weather + a market snapshot for the daily post. Used by the daily-cycle
 * scheduler.
 */
export const runFestivalRotation = async (
  now: number
): Promise<{
  festival: FestivalCategory;
  weather: CityState['weather'];
  dayNumber: number;
  villageName: string;
  hallLevel: number;
  stockpile: Stockpile;
  prices: Prices;
  offers: TraderOffer[];
}> => {
  const [city, stockpile] = await Promise.all([getCity(), getStockpile()]);
  const today = utcDay(now);
  const yesterday = prevDay(today);
  const counts = await getBallot(yesterday);
  const festival = tallyBallot(counts, city.festival);
  const weather = weatherForDay(today);

  await putCity({ festival, festivalDate: today, weather, weatherDate: today });
  await broadcastFestival(festival);
  await broadcastMarket(stockpile);

  const dayNumber = Math.floor((now - city.foundedAt) / 86_400_000) + 1;
  return {
    festival,
    weather,
    dayNumber,
    villageName: city.villageName,
    hallLevel: city.hallLevel,
    stockpile,
    prices: pricesFor(stockpile),
    offers: offersForDay(today, hallPerks(city.hallLevel).traderOffers),
  };
};

const shareKey = (userId: string, day: string): string =>
  `share:${userId}:${day}`;

/**
 * Post a milestone to the village post's comments. Validates the claim against
 * the player's real progress (no bragging about a level or stage not reached),
 * rate-limits to `SHARE_DAILY_LIMIT` per user per day, then submits the comment
 * as the user — falling back to an app-authored comment (prefixed with the
 * villager's handle) if the user-authored attempt is not permitted.
 */
export const doShare = async (
  userId: string,
  kind: ShareKind,
  value: number
): Promise<{ ok: true }> => {
  const [player, city] = await Promise.all([ensurePlayer(userId), getCity()]);

  if (kind === 'levelup') {
    if (value < 2 || value > MAX_LEVEL) {
      throw new OpError(400, 'That is not a level you can share.');
    }
    if (value > player.level) {
      throw new OpError(400, 'You have not reached that level yet.');
    }
  } else {
    if (value < 1 || value > KEEP_STAGES) {
      throw new OpError(400, 'That is not a Village Hall level you can share.');
    }
    if (value > city.hallLevel) {
      throw new OpError(400, 'That Hall level has not been reached yet.');
    }
  }

  const postId = context.postId;
  if (!postId) throw new OpError(400, 'There is no village post to share to.');

  const day = utcDay(Date.now());
  const key = shareKey(userId, day);
  const current = await redis.get(key);
  const count = current ? Number(current) : 0;
  if (count >= SHARE_DAILY_LIMIT) {
    throw new OpError(429, "You've shared enough for today.");
  }
  await redis.incrBy(key, 1);
  await redis.expire(key, 172800);

  const text = shareText(kind, value, player.name, context.subredditName);

  try {
    await reddit.submitComment({ id: postId, text, runAs: 'USER' });
  } catch (userError) {
    console.error('submitComment (runAs USER) failed:', userError);
    try {
      await reddit.submitComment({
        id: postId,
        text: `(on behalf of u/${player.name}) ${text}`,
        runAs: 'APP',
      });
    } catch (appError) {
      console.error('submitComment (runAs APP) failed:', appError);
      throw new OpError(502, 'Could not post your share right now — try again later.');
    }
  }

  return { ok: true };
};

export const isBuildingId = (value: unknown): value is BuildingId =>
  typeof value === 'string' && value in CATALOG;

export const isShareKind = (value: unknown): value is ShareKind =>
  value === 'levelup' || value === 'stage';

export const isCategory = (value: unknown): value is FestivalCategory =>
  value === 'coins' ||
  value === 'raw' ||
  value === 'processed' ||
  value === 'decor';

export const isGood = (value: unknown): value is Good =>
  typeof value === 'string' && (GOODS as string[]).includes(value);

export const isProcessedGood = (value: unknown): value is 'planks' | 'bricks' =>
  value === 'planks' || value === 'bricks';

export const isRoofColor = (value: unknown): value is RoofColor =>
  value === 'brown' ||
  value === 'green' ||
  value === 'purple' ||
  value === 'beige';
