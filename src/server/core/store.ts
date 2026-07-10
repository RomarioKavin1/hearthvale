import { redis } from '@devvit/web/server';
import type {
  CityState,
  FestivalCategory,
  PlayerState,
  Stockpile,
  Wallet,
  Weather,
} from '../../shared/types';
import type { TileState } from '../../shared/types';
import { GOODS, emptyStockpile } from '../../shared/logic/economy';
import { isVillageTheme } from '../../shared/catalog';

const GRID_KEY = 'city:grid';
const CITY_KEY = 'city:state';
const STOCKPILE_KEY = 'city:stockpile';
const playerKey = (userId: string): string => `player:${userId}`;

const num = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const isCategory = (value: string | undefined): value is FestivalCategory =>
  value === 'coins' ||
  value === 'raw' ||
  value === 'processed' ||
  value === 'decor';

const isWeather = (value: string | undefined): value is Weather =>
  value === 'sunny' ||
  value === 'rain' ||
  value === 'clear' ||
  value === 'harvestmoon';

const parseStageNames = (value: string | undefined): string[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed;
    }
  } catch {
    // Corrupt/legacy value — start fresh.
  }
  return [];
};

const parseWallet = (h: Record<string, string>): Wallet => ({
  wheat: num(h.w_wheat, 0),
  logs: num(h.w_logs, 0),
  stone: num(h.w_stone, 0),
  flour: num(h.w_flour, 0),
  planks: num(h.w_planks, 0),
  bricks: num(h.w_bricks, 0),
});

const walletFields = (wallet: Wallet): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const g of GOODS) out[`w_${g}`] = String(wallet[g]);
  return out;
};

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
    villageName: h.villageName ?? '',
    theme: isVillageTheme(h.theme) ? h.theme : 'meadow',
    festival: isCategory(h.festival) ? h.festival : 'coins',
    festivalDate: h.festivalDate ? h.festivalDate : todayUtc(),
    hallLevel: num(h.hallLevel, 0),
    stagePlanks: num(h.stagePlanks, 0),
    stageBricks: num(h.stageBricks, 0),
    totalCollected: num(h.totalCollected, 0),
    totalContributed: num(h.totalContributed, 0),
    weather: isWeather(h.weather) ? h.weather : 'clear',
    weatherDate: h.weatherDate ? h.weatherDate : '',
    population: num(h.population, 0),
    stageNames: parseStageNames(h.stageNames),
  };
};

export const putCity = async (c: Partial<CityState>): Promise<void> => {
  const fields: Record<string, string> = {};
  if (c.foundedAt !== undefined) fields.foundedAt = String(c.foundedAt);
  if (c.villageName !== undefined) fields.villageName = c.villageName;
  if (c.theme !== undefined) fields.theme = c.theme;
  if (c.festival !== undefined) fields.festival = c.festival;
  if (c.festivalDate !== undefined) fields.festivalDate = c.festivalDate;
  if (c.hallLevel !== undefined) fields.hallLevel = String(c.hallLevel);
  if (c.stagePlanks !== undefined) fields.stagePlanks = String(c.stagePlanks);
  if (c.stageBricks !== undefined) fields.stageBricks = String(c.stageBricks);
  if (c.totalCollected !== undefined) {
    fields.totalCollected = String(c.totalCollected);
  }
  if (c.totalContributed !== undefined) {
    fields.totalContributed = String(c.totalContributed);
  }
  if (c.weather !== undefined) fields.weather = c.weather;
  if (c.weatherDate !== undefined) fields.weatherDate = c.weatherDate;
  if (c.population !== undefined) fields.population = String(c.population);
  if (c.stageNames !== undefined) {
    fields.stageNames = JSON.stringify(c.stageNames);
  }
  if (Object.keys(fields).length > 0) {
    await redis.hSet(CITY_KEY, fields);
  }
};

// ---------------------------------------------------------------------------
// Village stockpile. `city:stockpile` is a hash Good -> qty; all six goods are
// always persisted so a read-through never has to guess a default.
// ---------------------------------------------------------------------------

export const getStockpile = async (): Promise<Stockpile> => {
  const h = await redis.hGetAll(STOCKPILE_KEY);
  const stock = emptyStockpile();
  for (const g of GOODS) stock[g] = num(h[g], 0);
  return stock;
};

/** Hash serialization of a stockpile. */
const stockpileFields = (stock: Stockpile): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const g of GOODS) fields[g] = String(stock[g]);
  return fields;
};

export const putStockpile = async (stock: Stockpile): Promise<void> => {
  await redis.hSet(STOCKPILE_KEY, stockpileFields(stock));
};

const parsePlayer = (
  userId: string,
  h: Record<string, string>
): PlayerState => ({
  id: h.id ? h.id : userId,
  name: h.name ?? '',
  coins: num(h.coins, 0),
  wallet: parseWallet(h),
  xp: num(h.xp, 0),
  level: num(h.level, 1),
  plots: num(h.plots, 1),
  streak: num(h.streak, 0),
  lastCheckIn: h.lastCheckIn ?? '',
  boostsToday: num(h.boostsToday, 0),
  boostsDate: h.boostsDate ?? '',
  paidStage: num(h.paidStage, 0),
  // Legacy players predate these lifetime counters — default 0.
  valueSpent: num(h.valueSpent, 0),
  lifetimeEarned: num(h.lifetimeEarned, 0),
  lifetimeContributed: num(h.lifetimeContributed, 0),
  // Quest counters — legacy players parse to 0 (chain starts at quest #1).
  collects: num(h.collects, 0),
  soldUnits: num(h.soldUnits, 0),
  processedUnits: num(h.processedUnits, 0),
  boostsGiven: num(h.boostsGiven, 0),
  votesCast: num(h.votesCast, 0),
  tradesDone: num(h.tradesDone, 0),
  questIndex: num(h.questIndex, 0),
  questLap: num(h.questLap, 0),
  questBaseline: num(h.questBaseline, 0),
});

/** Hash serialization of a player. */
const playerFields = (p: PlayerState): Record<string, string> => ({
  id: p.id,
  name: p.name,
  coins: String(p.coins),
  ...walletFields(p.wallet),
  xp: String(p.xp),
  level: String(p.level),
  plots: String(p.plots),
  streak: String(p.streak),
  lastCheckIn: p.lastCheckIn,
  boostsToday: String(p.boostsToday),
  boostsDate: p.boostsDate,
  paidStage: String(p.paidStage),
  valueSpent: String(p.valueSpent),
  lifetimeEarned: String(p.lifetimeEarned),
  lifetimeContributed: String(p.lifetimeContributed),
  collects: String(p.collects),
  soldUnits: String(p.soldUnits),
  processedUnits: String(p.processedUnits),
  boostsGiven: String(p.boostsGiven),
  votesCast: String(p.votesCast),
  tradesDone: String(p.tradesDone),
  questIndex: String(p.questIndex),
  questLap: String(p.questLap),
  questBaseline: String(p.questBaseline),
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
    wallet: { wheat: 0, logs: 0, stone: 0, flour: 0, planks: 0, bricks: 0 },
    xp: 0,
    level: 1,
    plots: 1,
    streak: 0,
    lastCheckIn: '',
    boostsToday: 0,
    boostsDate: '',
    paidStage: 0,
    valueSpent: 0,
    lifetimeEarned: 0,
    lifetimeContributed: 0,
    collects: 0,
    soldUnits: 0,
    processedUnits: 0,
    boostsGiven: 0,
    votesCast: 0,
    tradesDone: 0,
    questIndex: 0,
    questLap: 0,
    questBaseline: 0,
  };
  await redis.hSet(playerKey(userId), playerFields(player));
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

// ---------------------------------------------------------------------------
// Grand Keep contributions. `contrib:stage:{n}` is a zset of userId -> units
// (planks + bricks) contributed toward the stage that was under construction
// (0-indexed) at the time. lb:contrib tracks lifetime contribution across all
// stages. The pot for a completed stage is split pro-rata by these unit scores.
// ---------------------------------------------------------------------------

const contribStageKey = (n: number): string => `contrib:stage:${n}`;

export const incrStageContrib = async (
  n: number,
  userId: string,
  amount: number
): Promise<void> => {
  await redis.zIncrBy(contribStageKey(n), userId, amount);
};

export const stageContribScore = async (
  n: number,
  userId: string
): Promise<number> => {
  const score = await redis.zScore(contribStageKey(n), userId);
  return score ?? 0;
};

/** Total units contributed to a stage's zset (sum of all member scores). */
export const stageContribTotal = async (n: number): Promise<number> => {
  const rows = await redis.zRange(contribStageKey(n), 0, -1, { by: 'rank' });
  let total = 0;
  for (const row of rows) total += row.score;
  return total;
};

/** The top contributor (userId) of a stage's zset, or null if empty. */
export const stageTopContributor = async (
  n: number
): Promise<string | null> => {
  const rows = await redis.zRange(contribStageKey(n), 0, 0, {
    reverse: true,
    by: 'rank',
  });
  const [top] = rows;
  return top ? top.member : null;
};

// The wandering-trader (`traderdone:{date}`) and ballot (`ballot:{day}`,
// `ballotvoted:{day}`) keys are retired with S1 — both carried 48h TTLs, so any
// remnants from before the simplification expire on their own.
