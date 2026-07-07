import { context, reddit, realtime, redis } from '@devvit/web/server';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type {
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
} from '../../shared/logic/economy';
import { parseKey, tileKey } from '../../shared/logic/grid';
import {
  getCity,
  getGrid,
  getPlayer,
  getTile,
  initPlayer,
  ownedCount,
  putCity,
  putPlayer,
  putTile,
} from './store';

const GRID_KEY = 'city:grid';
const LB_VALUE = 'lb:value';
const LB_EARNED = 'lb:earned';

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

export const loadState = async (
  userId: string | undefined
): Promise<StateResponse> => {
  const [grid, city] = await Promise.all([getGrid(), getCity()]);
  const me = userId ? await ensurePlayer(userId) : null;

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
): Promise<{ tiles: TileState[]; me: PlayerState; gained: Gained }> => {
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

  return { tiles: changed.map((c) => c.tile), me, gained: total };
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

export const isBuildingId = (value: unknown): value is BuildingId =>
  typeof value === 'string' && value in CATALOG;
