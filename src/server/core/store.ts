import { redis } from '@devvit/web/server';
import type {
  BuildingCategory,
  CityState,
  PlayerState,
  TileState,
} from '../../shared/types';

const GRID_KEY = 'city:grid';
const CITY_KEY = 'city:state';
const playerKey = (userId: string): string => `player:${userId}`;

const num = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const isCategory = (value: string | undefined): value is BuildingCategory =>
  value === 'coins' || value === 'supplies' || value === 'decor';

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

export const getGrid = async (): Promise<Record<string, TileState>> => {
  const raw = await redis.hGetAll(GRID_KEY);
  const grid: Record<string, TileState> = {};
  for (const [key, value] of Object.entries(raw)) {
    const tile: TileState = JSON.parse(value);
    grid[key] = tile;
  }
  return grid;
};

export const getTile = async (key: string): Promise<TileState | null> => {
  const value = await redis.hGet(GRID_KEY, key);
  if (value === undefined) return null;
  const tile: TileState = JSON.parse(value);
  return tile;
};

export const putTile = async (key: string, t: TileState): Promise<void> => {
  await redis.hSet(GRID_KEY, { [key]: JSON.stringify(t) });
};

export const getCity = async (): Promise<CityState> => {
  const h = await redis.hGetAll(CITY_KEY);
  return {
    foundedAt: num(h.foundedAt, Date.now()),
    festival: isCategory(h.festival) ? h.festival : 'coins',
    festivalDate: h.festivalDate ? h.festivalDate : todayUtc(),
    landmarkStage: num(h.landmarkStage, 0),
    landmarkProgress: num(h.landmarkProgress, 0),
    totalCollected: num(h.totalCollected, 0),
    totalContributed: num(h.totalContributed, 0),
  };
};

export const putCity = async (c: Partial<CityState>): Promise<void> => {
  const fields: Record<string, string> = {};
  if (c.foundedAt !== undefined) fields.foundedAt = String(c.foundedAt);
  if (c.festival !== undefined) fields.festival = c.festival;
  if (c.festivalDate !== undefined) fields.festivalDate = c.festivalDate;
  if (c.landmarkStage !== undefined) fields.landmarkStage = String(c.landmarkStage);
  if (c.landmarkProgress !== undefined) {
    fields.landmarkProgress = String(c.landmarkProgress);
  }
  if (c.totalCollected !== undefined) {
    fields.totalCollected = String(c.totalCollected);
  }
  if (c.totalContributed !== undefined) {
    fields.totalContributed = String(c.totalContributed);
  }
  if (Object.keys(fields).length > 0) {
    await redis.hSet(CITY_KEY, fields);
  }
};

const parsePlayer = (
  userId: string,
  h: Record<string, string>
): PlayerState => ({
  id: h.id ? h.id : userId,
  name: h.name ?? '',
  coins: num(h.coins, 0),
  supplies: num(h.supplies, 0),
  xp: num(h.xp, 0),
  level: num(h.level, 1),
  plots: num(h.plots, 1),
  streak: num(h.streak, 0),
  lastCheckIn: h.lastCheckIn ?? '',
  boostsToday: num(h.boostsToday, 0),
});

const playerFields = (p: PlayerState): Record<string, string> => ({
  id: p.id,
  name: p.name,
  coins: String(p.coins),
  supplies: String(p.supplies),
  xp: String(p.xp),
  level: String(p.level),
  plots: String(p.plots),
  streak: String(p.streak),
  lastCheckIn: p.lastCheckIn,
  boostsToday: String(p.boostsToday),
});

export const getPlayer = async (
  userId: string
): Promise<PlayerState | null> => {
  const h = await redis.hGetAll(playerKey(userId));
  if (Object.keys(h).length === 0) return null;
  return parsePlayer(userId, h);
};

export const initPlayer = async (
  userId: string,
  name: string
): Promise<PlayerState> => {
  const player: PlayerState = {
    id: userId,
    name,
    coins: 120,
    supplies: 0,
    xp: 0,
    level: 1,
    plots: 1,
    streak: 0,
    lastCheckIn: '',
    boostsToday: 0,
  };
  // paidStage / boostsDate are consumed by Task 4; seed them now.
  await redis.hSet(playerKey(userId), {
    ...playerFields(player),
    paidStage: '0',
    boostsDate: '',
  });
  return player;
};

export const putPlayer = async (p: PlayerState): Promise<void> => {
  await redis.hSet(playerKey(p.id), playerFields(p));
};

export const ownedCount = (
  grid: Record<string, TileState>,
  userId: string
): number => {
  let count = 0;
  for (const tile of Object.values(grid)) {
    if (tile.owner === userId) count += 1;
  }
  return count;
};
