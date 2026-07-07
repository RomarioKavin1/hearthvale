import { context, reddit, realtime, redis } from '@devvit/web/server';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type {
  BuildingCategory,
  CityState,
  Gained,
  LeaderRow,
  PlayerState,
  StateResponse,
  Tier,
  TileState,
} from '../../shared/types';
import type { BuildingId } from '../../shared/types';
import {
  BOOST_DAILY_LIMIT,
  CATALOG,
  LANDMARK_THRESHOLDS,
  tierStats,
} from '../../shared/catalog';
import type { BuildingSpec } from '../../shared/catalog';
import {
  accrue,
  adjacencyBonus,
  canClaim,
  levelForXp,
  plotsForLevel,
  prevDay,
  streakReward,
  utcDay,
} from '../../shared/logic/economy';
import { parseKey, tileKey } from '../../shared/logic/grid';
import {
  getBallot,
  getCity,
  getGrid,
  getPlayer,
  getTile,
  hasVoted,
  incrStageContrib,
  initPlayer,
  ownedCount,
  putCity,
  putPlayer,
  putTile,
  recordVote,
  stageContribScore,
} from './store';

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

/** Recompute level/plots from current xp. Only ever advances. */
export const applyLevelUp = (player: PlayerState): PlayerState => {
  const level = levelForXp(player.xp);
  if (level <= player.level) return player;
  return { ...player, level, plots: plotsForLevel(level) };
};

const creditXp = (player: PlayerState, amount: number): PlayerState =>
  applyLevelUp({ ...player, xp: player.xp + amount });

// --- Check-in streaks -------------------------------------------------------

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

export const BOOST_LIMIT = BOOST_DAILY_LIMIT;
export const BOOST_DURATION_MS = 30 * 60 * 1000;
export const BOOST_COINS = 15;
export const BOOST_XP = 5;

/** Boosts already spent today; the daily counter resets on date rollover. */
export const boostsUsedToday = (player: PlayerState, today: string): number =>
  player.boostsDate === today ? player.boostsToday : 0;

/**
 * A boost targets a neighbour's completed producer. Returns an error message
 * or null. `usedToday` must already account for date rollover.
 */
export const validateBoost = (
  boosterId: string,
  tile: TileState,
  now: number,
  usedToday: number
): string | null => {
  if (tile.owner === boosterId) return 'You cannot boost your own plot.';
  if (!tile.buildingId) return 'There is nothing to boost here.';
  if (CATALOG[tile.buildingId].category === 'decor') {
    return 'Decorations cannot be boosted.';
  }
  if (now < tile.readyAt) return 'This building is still under construction.';
  if (tile.boostUntil > now) return 'This building already has a boost running.';
  if (usedToday >= BOOST_LIMIT) return 'You have used all your boosts today.';
  return null;
};

// --- Landmark contributions -------------------------------------------------

export type StageSplit = { stage: number; amount: number };

export type ContributeResult = {
  /** Total supplies actually consumed (after clamp + excess discard). */
  applied: number;
  /** Per-stage portions to record in `contrib:stage:{stage}` zsets. */
  splits: StageSplit[];
  /** New 0-indexed stage under construction. */
  landmarkStage: number;
  /** Progress toward the new stage's threshold. */
  landmarkProgress: number;
  /** New stage numbers reached (one per completion) for `{t:'stage'}`. */
  completed: number[];
};

/** True once every landmark stage is built (stage index === threshold count). */
export const landmarkComplete = (
  city: CityState,
  thresholds: number[]
): boolean => city.landmarkStage >= thresholds.length;

/**
 * Apply a supply contribution to the landmark. The amount is clamped to the
 * player's `supplies`, then poured stage-by-stage: each stage fills up to its
 * threshold, completes, and carries the remainder into the next. Any excess
 * left once the final stage completes is discarded.
 *
 * `contrib:stage:{n}` records contributions toward the stage that was under
 * construction (n = 0-indexed) at the time — so stage n's zset funds the
 * n->n+1 transition and pays out (n+1)*100 on completion.
 */
export const applyContribution = (
  city: CityState,
  supplies: number,
  amount: number,
  thresholds: number[]
): ContributeResult => {
  const clamped = Math.min(amount, supplies);
  let stage = city.landmarkStage;
  let progress = city.landmarkProgress;
  let remaining = clamped;
  const splits: StageSplit[] = [];
  const completed: number[] = [];

  while (remaining > 0 && stage < thresholds.length) {
    const threshold = thresholds[stage];
    if (threshold === undefined) break;
    const need = threshold - progress;
    const put = Math.min(remaining, need);
    splits.push({ stage, amount: put });
    progress += put;
    remaining -= put;
    if (progress >= threshold) {
      stage += 1;
      progress = 0;
      completed.push(stage);
    }
  }

  return {
    applied: clamped - remaining,
    splits,
    landmarkStage: stage,
    landmarkProgress: progress,
    completed,
  };
};

// --- Ballot -----------------------------------------------------------------

const CATEGORIES: BuildingCategory[] = ['coins', 'supplies', 'decor'];

/** Cyclic rotation coins -> supplies -> decor -> coins. */
export const nextFestival = (current: BuildingCategory): BuildingCategory => {
  const i = CATEGORIES.indexOf(current);
  return CATEGORIES[(i + 1) % CATEGORIES.length] ?? 'coins';
};

/**
 * Winning festival category: the strict majority. A tie (including no votes)
 * rotates to the next category after the current festival.
 */
export const tallyBallot = (
  counts: Record<BuildingCategory, number>,
  current: BuildingCategory
): BuildingCategory => {
  const entries = CATEGORIES.map((c) => ({ c, n: counts[c] }));
  const max = Math.max(...entries.map((e) => e.n));
  const winners = entries.filter((e) => e.n === max);
  const [winner] = winners;
  if (max > 0 && winners.length === 1 && winner) return winner.c;
  return nextFestival(current);
};

// --- Stage payout -----------------------------------------------------------

/** Reward for a contributor when stage index n completes. */
export const stageReward = (n: number): number => (n + 1) * 100;

/**
 * Sum the payouts owed to a player for completed-but-unpaid stages. Stages
 * [paidStage, landmarkStage) are complete; the player is paid stageReward(n)
 * for each such stage they funded.
 */
export const computePayout = (
  paidStage: number,
  landmarkStage: number,
  contributed: (n: number) => boolean
): number => {
  let coins = 0;
  for (let n = paidStage; n < landmarkStage; n += 1) {
    if (contributed(n)) coins += stageReward(n);
  }
  return coins;
};

export const applyCollect = (
  tile: TileState,
  player: PlayerState,
  city: CityState,
  now: number,
  adjBonus: number
): { tile: TileState; player: PlayerState; gained: Gained } => {
  const gained = accrue(tile, now, city.festival, adjBonus);
  const produced = gained.coins + gained.supplies > 0;

  let nextTile: TileState = { ...tile };
  let nextPlayer = player;

  if (produced) {
    nextPlayer = creditXp(
      {
        ...player,
        coins: player.coins + gained.coins,
        supplies: player.supplies + gained.supplies,
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

  return { tile: nextTile, player: nextPlayer, gained };
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
  festival: BuildingCategory
): Promise<void> => {
  try {
    await realtime.send('village', { t: 'festival', festival });
  } catch (error) {
    console.error('realtime festival broadcast failed:', error);
  }
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
  let name = 'villager';
  try {
    const user = await reddit.getUserById(asT2(id));
    if (user) name = user.username;
  } catch (error) {
    console.error(`getUserById failed for ${id}:`, error);
  }
  await redis.set(`uname:${id}`, name);
  return name;
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
 * Lazily pay a player for landmark stages that completed since they last
 * collected. Stages [player.paidStage, city.landmarkStage) are complete; the
 * player earns stageReward(n) === (n+1)*100 for each such stage they funded
 * (a positive score in `contrib:stage:{n}`). Advances paidStage and persists.
 */
const settleStagePayouts = async (
  player: PlayerState,
  city: CityState
): Promise<PlayerState> => {
  if (player.paidStage >= city.landmarkStage) return player;

  let coins = 0;
  for (let n = player.paidStage; n < city.landmarkStage; n += 1) {
    const score = await stageContribScore(n, player.id);
    if (score > 0) coins += stageReward(n);
  }

  const settled: PlayerState = {
    ...player,
    coins: player.coins + coins,
    paidStage: city.landmarkStage,
  };
  await putPlayer(settled);
  return settled;
};

export const loadState = async (
  userId: string | undefined
): Promise<StateResponse> => {
  const [grid, city] = await Promise.all([getGrid(), getCity()]);
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

  return { grid, city, me, now: Date.now(), top };
};

export const doClaim = async (
  userId: string,
  x: number,
  y: number
): Promise<{ tile: TileState; me: PlayerState }> => {
  const key = tileKey(x, y);
  const [grid, player] = await Promise.all([getGrid(), ensurePlayer(userId)]);
  const owned = ownedCount(grid, userId);

  const err = canClaim(grid, x, y, player, owned);
  if (err) throw new OpError(400, err);

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
  return { tile, me: player };
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
    { ...player, coins: player.coins - spec.cost },
    Math.floor(spec.cost / 10)
  );

  await putTile(key, newTile);
  await putPlayer(me);
  await redis.zIncrBy(LB_VALUE, userId, spec.cost);
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
  const [tile, player, grid, city] = await Promise.all([
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

  // Auto-collect pending production before the timer resets.
  const adj = adjacencyBonus(grid, x, y, city.festival, now);
  const collected = applyCollect(tile, player, city, now, adj);
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
  const me = creditXp(
    { ...collected.player, coins: collected.player.coins - stats.cost },
    Math.floor(stats.cost / 10)
  );

  await putTile(key, upgraded);
  await putPlayer(me);
  await redis.zIncrBy(LB_VALUE, userId, stats.cost);
  const bankedResources = pending.coins + pending.supplies;
  if (bankedResources > 0) {
    if (pending.coins > 0) await redis.zIncrBy(LB_EARNED, userId, pending.coins);
    await putCity({ totalCollected: city.totalCollected + bankedResources });
  }
  await maybeFlair(before, me);
  await broadcastTile(key, upgraded);
  return { tile: upgraded, me };
};

export const doCollect = async (
  userId: string,
  x: number,
  y: number
): Promise<{ tile: TileState; me: PlayerState; gained: Gained }> => {
  const key = tileKey(x, y);
  const [tile, player, grid, city] = await Promise.all([
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
  const adj = adjacencyBonus(grid, x, y, city.festival, now);
  const result = applyCollect(tile, player, city, now, adj);
  const gained = result.gained;
  const produced = gained.coins + gained.supplies > 0;

  await putTile(key, result.tile);
  if (produced) {
    await putPlayer(result.player);
    if (gained.coins > 0) await redis.zIncrBy(LB_EARNED, userId, gained.coins);
    await putCity({
      totalCollected: city.totalCollected + gained.coins + gained.supplies,
    });
    await maybeFlair(player.level, result.player);
  }
  await broadcastTile(key, result.tile);
  return { tile: result.tile, me: result.player, gained };
};

export const doCollectAll = async (
  userId: string
): Promise<{ tiles: Record<string, TileState>; me: PlayerState; gained: Gained }> => {
  const [grid, initial, city] = await Promise.all([
    getGrid(),
    ensurePlayer(userId),
    getCity(),
  ]);

  const now = Date.now();
  const startLevel = initial.level;
  let me = initial;
  const total: Gained = { coins: 0, supplies: 0, xp: 0 };
  const changed: Array<{ key: string; tile: TileState }> = [];

  for (const [key, tile] of Object.entries(grid)) {
    if (tile.owner !== userId || !tile.buildingId) continue;
    const { x, y } = parseKey(key);
    const adj = adjacencyBonus(grid, x, y, city.festival, now);
    const result = applyCollect(tile, me, city, now, adj);
    me = result.player;
    total.coins += result.gained.coins;
    total.supplies += result.gained.supplies;
    total.xp += result.gained.xp;
    const boostChanged = result.tile.boostUntil !== tile.boostUntil;
    if (result.gained.coins + result.gained.supplies > 0 || boostChanged) {
      changed.push({ key, tile: result.tile });
    }
  }

  for (const { key, tile } of changed) {
    await putTile(key, tile);
  }
  const produced = total.coins + total.supplies > 0;
  if (produced) {
    await putPlayer(me);
    if (total.coins > 0) await redis.zIncrBy(LB_EARNED, userId, total.coins);
    await putCity({
      totalCollected: city.totalCollected + total.coins + total.supplies,
    });
    await maybeFlair(startLevel, me);
  }
  for (const { key, tile } of changed) {
    await broadcastTile(key, tile);
  }

  const tiles: Record<string, TileState> = {};
  for (const { key, tile } of changed) {
    tiles[key] = tile;
  }

  return { tiles, me, gained: total };
};

export const loadSummary = async (
  userId: string | undefined
): Promise<{
  buildings: number;
  players: number;
  landmarkStage: number;
  landmarkPct: number;
  festival: CityState['festival'];
  readyForMe: number;
}> => {
  const [grid, city] = await Promise.all([getGrid(), getCity()]);

  const owners = new Set<string>();
  let buildings = 0;
  for (const tile of Object.values(grid)) {
    owners.add(tile.owner);
    if (tile.buildingId) buildings += 1;
  }

  const stage = city.landmarkStage;
  let landmarkPct = 100;
  if (stage < LANDMARK_THRESHOLDS.length) {
    const threshold = LANDMARK_THRESHOLDS[stage] ?? 1;
    landmarkPct = Math.max(
      0,
      Math.min(100, Math.floor((city.landmarkProgress / threshold) * 100))
    );
  }

  let readyForMe = 0;
  if (userId) {
    const now = Date.now();
    for (const [key, tile] of Object.entries(grid)) {
      if (tile.owner !== userId || !tile.buildingId) continue;
      const { x, y } = parseKey(key);
      const adj = adjacencyBonus(grid, x, y, city.festival, now);
      const gained = accrue(tile, now, city.festival, adj);
      if (gained.coins + gained.supplies > 0) readyForMe += 1;
    }
  }

  return {
    buildings,
    players: owners.size,
    landmarkStage: stage,
    landmarkPct,
    festival: city.festival,
    readyForMe,
  };
};

export const doCheckIn = async (
  userId: string
): Promise<{ me: PlayerState; gained: { coins: number } }> => {
  const player = await ensurePlayer(userId);
  const today = utcDay(Date.now());

  const err = canCheckIn(player.lastCheckIn, today);
  if (err) throw new OpError(400, err);

  const streak = nextStreak(player.lastCheckIn, player.streak, today);
  const coins = streakReward(streak);
  const me: PlayerState = {
    ...player,
    streak,
    lastCheckIn: today,
    coins: player.coins + coins,
  };

  await putPlayer(me);
  return { me, gained: { coins } };
};

export const doBoost = async (
  userId: string,
  x: number,
  y: number
): Promise<{ tile: TileState; me: PlayerState }> => {
  const key = tileKey(x, y);
  const [tile, player] = await Promise.all([getTile(key), ensurePlayer(userId)]);
  if (!tile) throw new OpError(404, 'There is nothing to boost here.');

  const now = Date.now();
  const today = utcDay(now);
  const used = boostsUsedToday(player, today);
  const err = validateBoost(userId, tile, now, used);
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
    },
    BOOST_XP
  );

  await putTile(key, boosted);
  await putPlayer(me);
  await maybeFlair(before, me);
  await broadcastTile(key, boosted);
  return { tile: boosted, me };
};

export const doContribute = async (
  userId: string,
  amount: number
): Promise<{ city: CityState; me: PlayerState }> => {
  const [player, city] = await Promise.all([ensurePlayer(userId), getCity()]);

  if (landmarkComplete(city, LANDMARK_THRESHOLDS)) {
    throw new OpError(400, 'The clocktower is already complete.');
  }
  if (player.supplies <= 0) {
    throw new OpError(400, 'You have no supplies to contribute.');
  }

  const result = applyContribution(
    city,
    player.supplies,
    amount,
    LANDMARK_THRESHOLDS
  );

  // Record each stage's portion in its per-stage contribution zset, plus the
  // lifetime contribution leaderboard.
  for (const split of result.splits) {
    await incrStageContrib(split.stage, userId, split.amount);
  }
  await redis.zIncrBy(LB_CONTRIB, userId, result.applied);

  const before = player.level;
  // 1 xp per supply contributed, credited through the level-up helper.
  const me = creditXp(
    { ...player, supplies: player.supplies - result.applied },
    result.applied
  );

  const nextCity: CityState = {
    ...city,
    landmarkStage: result.landmarkStage,
    landmarkProgress: result.landmarkProgress,
    totalContributed: city.totalContributed + result.applied,
  };

  await putCity({
    landmarkStage: nextCity.landmarkStage,
    landmarkProgress: nextCity.landmarkProgress,
    totalContributed: nextCity.totalContributed,
  });
  await putPlayer(me);
  await maybeFlair(before, me);
  await broadcastCity(nextCity);
  // One {t:'stage'} broadcast per completed stage, in completion order.
  for (const stage of result.completed) {
    await broadcastStage(stage);
  }
  return { city: nextCity, me };
};

export const doVote = async (
  userId: string,
  category: BuildingCategory
): Promise<{ counts: Record<BuildingCategory, number> }> => {
  const today = utcDay(Date.now());
  if (await hasVoted(today, userId)) {
    throw new OpError(400, 'You have already voted today.');
  }
  await recordVote(today, userId, category);
  const counts = await getBallot(today);
  return { counts };
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
 * Resolve the next festival by tallying yesterday's ballot (majority wins; a
 * tie or empty ballot rotates from the current festival), persist it, and
 * broadcast. Returns the chosen festival. Used by the daily-cycle scheduler.
 */
export const runFestivalRotation = async (
  now: number
): Promise<{ festival: BuildingCategory; dayNumber: number }> => {
  const city = await getCity();
  const today = utcDay(now);
  const yesterday = prevDay(today);
  const counts = await getBallot(yesterday);
  const festival = tallyBallot(counts, city.festival);

  await putCity({ festival, festivalDate: today });
  await broadcastFestival(festival);

  const dayNumber = Math.floor((now - city.foundedAt) / 86_400_000) + 1;
  return { festival, dayNumber };
};

export const isBuildingId = (value: unknown): value is BuildingId =>
  typeof value === 'string' && value in CATALOG;

export const isCategory = (value: unknown): value is BuildingCategory =>
  value === 'coins' || value === 'supplies' || value === 'decor';
