// In-browser mock of the Hearthvale server, for the dev harness.
//
// This patches `window.fetch` so every `/api/*` request the REAL client makes is
// answered from an in-memory world instead of a Devvit backend. It re-implements
// the ENDPOINT CONTRACTS (request/response shapes) of src/server/routes/api.ts and
// the game orchestration of src/server/core/village.ts, but the GAME MATH is the
// genuine shared code — accrue, adjacency, market pricing, quests, expansion and
// the Village-Hall/house buffs are all imported from src/shared, so a collect,
// build or contribution scores identically to production.
//
// ─────────────────────────────────────────────────────────────────────────────
// KNOWN DIVERGENCES FROM THE REAL SERVER (documented honestly — the harness
// exercises CLIENT behaviour + game feel; src/server code is NOT run):
//
//  1. Persistence is a single localStorage blob, not Redis. No transactions /
//     optimistic-concurrency (`redis.watch`); the harness is single-player so
//     there are no races to guard.
//  2. Leaderboards are derived by sorting the in-memory player map, not from
//     Redis zsets. Names are the players' own names (bots included).
//  3. Stage pro-rata pots are settled from an in-memory per-stage contribution
//     map (`stageContrib`); the maths (`proRataPayout`) is the real one but the
//     dev player is usually the only contributor, so they collect the whole pot.
//  4. No Reddit side effects: flair, celebratory comments and the `/api/share`
//     comment post are stubbed (share always succeeds). Username resolution is
//     local.
//  5. Weather/festival roll lazily on state load like the server, but there is no
//     scheduler; the dev panel drives manual weather/festival cycling.
//  6. The clock is a warpable `mockNow()` (real time + a persisted offset). The
//     `now` returned by /api/state feeds the client's clock-skew correction, so
//     `store.serverNow()` tracks the warped clock.
//  7. "Golden always" (dev panel) forces every single-tile collect into the
//     Perfect-Harvest window server-side; the ambient sparkle is still driven by
//     the real pure `isGoldenWindow` on the client (synced via the warped clock).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  BuildingId,
  CityState,
  ClaimQuestResponse,
  FestivalCategory,
  Gained,
  Good,
  LeaderRow,
  PlayerState,
  RoofColor,
  StateResponse,
  Stockpile,
  Summary,
  Tier,
  TileState,
  VillageTheme,
  Weather,
} from '../../src/shared/types';
import type { BuildingSpec } from '../../src/shared/catalog';
import {
  CATALOG,
  DEMOLISH_REFUND,
  HALL_POPULATION,
  KEEP_STAGE_COSTS,
  MARKET,
  MAX_LEVEL,
  PAINT_COST,
  RING_BY_LEVEL,
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
} from '../../src/shared/catalog';
import {
  GOODS,
  GOLDEN_MULTIPLIER,
  accrue,
  adjacencyBonus,
  canClaim,
  emptyStockpile,
  goodsTotal,
  isAutoSold,
  isGoldenWindowLenient,
  levelForXp,
  mergeGoods,
  ownedPlots,
  plotsForLevel,
  prevDay,
  streakReward,
  utcDay,
} from '../../src/shared/logic/economy';
import { priceFor, pricesFor, sellValue } from '../../src/shared/logic/market';
import { isUnlocked, ringBounds } from '../../src/shared/logic/expansion';
import { weatherForDay } from '../../src/shared/logic/trader';
import {
  advanceQuest,
  claimQuestError,
  questAt,
  questBaselineFor,
  questProgress,
  questSnapshot,
} from '../../src/shared/quests';
import { parseKey, tileKey } from '../../src/shared/logic/grid';
import { publish } from './mock-bus';

const KEEP_STAGES = KEEP_STAGE_COSTS.length;
const DEV_USER = 't2_dev';
const DEV_NAME = 'dev_player';

// ── Clock ─────────────────────────────────────────────────────────────────────

let clockOffset = 0;
/** Warped "now": real wall-clock plus the dev-panel time offset. */
export const mockNow = (): number => Date.now() + clockOffset;

// ── World model + persistence ───────────────────────────────────────────────

type World = {
  grid: Record<string, TileState>;
  city: CityState;
  stockpile: Stockpile;
  players: Record<string, PlayerState>;
  /** stage index -> userId -> units contributed toward that Hall level. */
  stageContrib: Record<number, Record<string, number>>;
  botSeq: number;
  clockOffset: number;
  goldenAlways: boolean;
};

const STORAGE_KEY = 'hv-harness-world-v1';

const freshCity = (now: number): CityState => ({
  foundedAt: now,
  villageName: '',
  theme: 'meadow',
  festival: 'coins',
  festivalDate: utcDay(now),
  hallLevel: 0,
  stagePlanks: 0,
  stageBricks: 0,
  totalCollected: 0,
  totalContributed: 0,
  weather: 'clear',
  weatherDate: '',
  population: 0,
  stageNames: [],
});

const freshPlayer = (id: string, name: string): PlayerState => ({
  id,
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
  goldenHarvests: 0,
  boostsGiven: 0,
  votesCast: 0,
  tradesDone: 0,
  questIndex: 0,
  questLap: 0,
  questBaseline: 0,
});

const freshWorld = (): World => {
  const now = mockNow();
  return {
    grid: {},
    city: freshCity(now),
    stockpile: emptyStockpile(),
    players: {},
    stageContrib: {},
    botSeq: 0,
    clockOffset: 0,
    goldenAlways: false,
  };
};

let world: World = freshWorld();

const save = (): void => {
  world.clockOffset = clockOffset;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(world));
  } catch (err) {
    console.warn('[harness] world save failed', err);
  }
};

const load = (): void => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      world = { ...freshWorld(), ...(parsed as World) };
      clockOffset = world.clockOffset ?? 0;
    }
  } catch (err) {
    console.warn('[harness] world load failed, starting fresh', err);
  }
};

// ── Error type + response helpers ─────────────────────────────────────────────

class MockError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const fail = (message: string, status: number): Response =>
  json({ status: 'error', message }, status);

// ── Ported pure helpers (verbatim from src/server/core/village.ts; that file
// cannot be imported because it pulls in '@devvit/web/server'). Kept 1:1 so the
// economy matches production). ────────────────────────────────────────────────

const applyLevelUp = (player: PlayerState): PlayerState => {
  const level = levelForXp(player.xp);
  if (level <= player.level) return player;
  return { ...player, level, plots: plotsForLevel(level) };
};

const creditXp = (player: PlayerState, amount: number): PlayerState =>
  applyLevelUp({ ...player, xp: player.xp + amount });

const affordableRuns = (
  balance: number,
  price: number,
  per: number,
  runs: number
): number => {
  const costPerRun = price * per;
  if (costPerRun <= 0) return runs;
  return Math.min(runs, Math.floor(balance / costPerRun));
};

const applyHallBuff = (
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

const processedUnits = (
  buildingId: BuildingId | undefined,
  gained: Gained,
  consumed: Partial<Record<Good, number>>
): number => {
  if (!buildingId) return 0;
  const spec = CATALOG[buildingId];
  if (spec.role !== 'processor' || !spec.input || !spec.output) return 0;
  if (spec.output === 'coins' || isAutoSold(spec.output)) {
    const per = spec.input.per;
    return per > 0 ? Math.floor((consumed[spec.input.good] ?? 0) / per) : 0;
  }
  return gained.goods[spec.output] ?? 0;
};

type CollectResult = {
  tile: TileState;
  player: PlayerState;
  gained: Gained;
  consumed: Partial<Record<Good, number>>;
  stocked: Partial<Record<Good, number>>;
  golden: boolean;
};

const applyCollect = (
  tile: TileState,
  player: PlayerState,
  city: CityState,
  now: number,
  adjBonus: number,
  stockpile: Stockpile,
  houseTier: number,
  golden = false
): CollectResult => {
  const raw = accrue(tile, now, city.festival, adjBonus, city.weather, stockpile);
  let gained: Gained = raw.gained;
  let consumed = raw.consumed;

  const spec = tile.buildingId ? CATALOG[tile.buildingId] : undefined;
  const isHouse = spec?.special === 'house';

  const outputGood = spec?.output;
  const netsFromRevenue =
    outputGood === 'coins' || (outputGood !== undefined && isAutoSold(outputGood));

  let inputCost = 0;
  if (spec && spec.role === 'processor' && spec.input && spec.output) {
    const input = spec.input;
    const price = priceFor(stockpile[input.good], input.good);
    const consumedUnits = consumed[input.good] ?? 0;
    const runs = input.per > 0 ? Math.floor(consumedUnits / input.per) : 0;

    if (!netsFromRevenue && spec.output !== 'coins') {
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
    }
    inputCost = price * (consumed[input.good] ?? 0);
  }

  gained = applyHallBuff(gained, city.hallLevel, houseTier, isHouse);

  if (golden) {
    const goods: Partial<Record<Good, number>> = {};
    for (const g of GOODS) {
      const v = gained.goods[g];
      if (v) goods[g] = v * GOLDEN_MULTIPLIER;
    }
    gained = {
      coins: gained.coins * GOLDEN_MULTIPLIER,
      xp: gained.xp * GOLDEN_MULTIPLIER,
      goods,
    };
  }

  let saleCoins = 0;
  let soldUnitsTotal = 0;
  const sold: Partial<Record<Good, { units: number; coins: number }>> = {};
  const stocked: Partial<Record<Good, number>> = {};
  const keptGoods: Partial<Record<Good, number>> = {};
  for (const g of GOODS) {
    const units = gained.goods[g];
    if (!units) continue;
    if (isAutoSold(g)) {
      const coins = sellValue(units, stockpile[g], g);
      sold[g] = { units, coins };
      stocked[g] = units;
      saleCoins += coins;
      soldUnitsTotal += units;
    } else {
      keptGoods[g] = units;
    }
  }
  gained = {
    ...gained,
    coins: gained.coins + saleCoins,
    goods: keptGoods,
    ...(soldUnitsTotal > 0 ? { sold } : {}),
  };

  let netCoins = gained.coins;
  let paidFromBalance = 0;
  if (spec && spec.role === 'processor') {
    if (netsFromRevenue) {
      netCoins = Math.max(0, gained.coins - inputCost);
      gained = { ...gained, coins: netCoins };
    } else {
      paidFromBalance = inputCost;
    }
  }

  const goodsOut = goodsTotal(gained.goods);
  const produced =
    netCoins + goodsOut > 0 ||
    paidFromBalance > 0 ||
    goodsTotal(consumed) > 0 ||
    soldUnitsTotal > 0;

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
        lifetimeEarned: player.lifetimeEarned + netCoins,
        soldUnits: player.soldUnits + soldUnitsTotal,
      },
      gained.xp
    );
    nextTile.lastCollect = now;
    if (tile.boostUntil > 0 && tile.boostUntil <= now) {
      nextTile = { ...nextTile, boostUntil: 0 };
      delete nextTile.boostBy;
    }
  }

  return {
    tile: nextTile,
    player: nextPlayer,
    gained,
    consumed,
    stocked,
    golden: golden && produced,
  };
};

type HallLevelUp = {
  hallLevel: number;
  stagePlanks: number;
  stageBricks: number;
  leveled: number[];
};

const tryHallLevelUp = (
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

const applyKeepContribution = (
  city: CityState,
  good: 'planks' | 'bricks',
  qty: number,
  costs: Array<{ planks: number; bricks: number }>
): { applied: number; refunded: number; stage: number; stagePlanks: number; stageBricks: number } => {
  const level = city.hallLevel;
  let planks = city.stagePlanks;
  let bricks = city.stageBricks;
  const incoming = Math.max(0, Math.floor(qty));
  const cost = costs[level];
  if (!cost) {
    return { applied: 0, refunded: incoming, stage: level, stagePlanks: planks, stageBricks: bricks };
  }
  const filled = good === 'planks' ? planks : bricks;
  const need = Math.max(0, cost[good] - filled);
  const applied = Math.min(incoming, need);
  const refunded = incoming - applied;
  if (good === 'planks') planks += applied;
  else bricks += applied;
  return { applied, refunded, stage: level, stagePlanks: planks, stageBricks: bricks };
};

const stagePot = (n: number): number => (n + 1) * STAGE_POT;
const proRataPayout = (pot: number, playerUnits: number, totalUnits: number): number => {
  if (playerUnits <= 0 || totalUnits <= 0) return 0;
  return Math.max(STAGE_MIN_PAYOUT, Math.floor((pot * playerUnits) / totalUnits));
};

const validateBuild = (player: PlayerState, tile: TileState, spec: BuildingSpec): string | null => {
  if (tile.owner !== player.id) return 'You do not own this plot.';
  if (tile.buildingId) return 'This plot already has a building.';
  if (spec.special === 'house') return 'Your house is placed when you settle your first plot.';
  if (player.level < spec.unlockLevel) return `${spec.name} unlocks at level ${spec.unlockLevel}.`;
  if (player.coins < spec.cost) return 'Not enough coins to build this.';
  return null;
};

const validateUpgrade = (player: PlayerState, tile: TileState, now: number): string | null => {
  if (tile.owner !== player.id) return 'You do not own this plot.';
  if (!tile.buildingId) return 'There is no building here to upgrade.';
  if (now < tile.readyAt) return 'This building is still under construction.';
  if (tile.tier >= 3) return 'This building is already at its highest tier.';
  return null;
};

const validateDemolish = (player: PlayerState, tile: TileState): string | null => {
  if (tile.owner !== player.id) return 'You do not own this plot.';
  if (!tile.buildingId) return 'There is no building here to demolish.';
  if (CATALOG[tile.buildingId].special === 'house') return 'Your house is your home.';
  return null;
};

const validatePaint = (player: PlayerState, tile: TileState, now: number): string | null => {
  if (tile.owner !== player.id) return 'You do not own this plot.';
  if (!tile.buildingId) return 'There is no building here to paint.';
  if (!isStackedBuilding(tile.buildingId)) return 'This building has no roof to paint.';
  if (now < tile.readyAt) return 'This building is still under construction.';
  if (player.coins < PAINT_COST) return 'Not enough coins to paint this roof.';
  return null;
};

const validateBoost = (
  boosterId: string,
  tile: TileState,
  now: number,
  usedToday: number,
  limit: number
): string | null => {
  if (tile.owner === boosterId) return 'You cannot boost your own plot.';
  if (!tile.buildingId) return 'There is nothing to boost here.';
  if (CATALOG[tile.buildingId].role === 'decor') return 'Decorations cannot be boosted.';
  if (now < tile.readyAt) return 'This building is still under construction.';
  if (tile.boostUntil > now) return 'This building already has a boost running.';
  if (usedToday >= limit) return 'You have used all your boosts today.';
  return null;
};

const demolishRefund = (spec: BuildingSpec, tier: Tier): number =>
  Math.floor(DEMOLISH_REFUND * investedCost(spec, tier));

const countHouses = (grid: Record<string, TileState>): number => {
  let n = 0;
  for (const t of Object.values(grid)) if (t.buildingId === 'house') n += 1;
  return n;
};

const houseTierOf = (grid: Record<string, TileState>, userId: string): number => {
  for (const t of Object.values(grid)) {
    if (t.owner === userId && t.buildingId === 'house') return t.tier;
  }
  return 0;
};

const BOOST_DURATION_MS = 30 * 60 * 1000;
const BOOST_COINS = 15;
const BOOST_XP = 5;
const CHECKIN_XP = 50;

// ── World access + orchestration ──────────────────────────────────────────────

const ensurePlayer = (userId: string): PlayerState => {
  let p = world.players[userId];
  if (!p) {
    p = freshPlayer(userId, userId === DEV_USER ? DEV_NAME : userId);
    world.players[userId] = p;
  }
  return p;
};

const ensureWeather = (now: number): void => {
  const today = utcDay(now);
  if (world.city.weatherDate === today) return;
  world.city = { ...world.city, weather: weatherForDay(today), weatherDate: today };
};

/** Pay the dev player their pro-rata share of Hall levels completed since they
 * last settled (mirrors settleStagePayouts). */
const settleStagePayouts = (player: PlayerState): PlayerState => {
  if (player.paidStage >= world.city.hallLevel) return player;
  let coins = 0;
  for (let n = player.paidStage; n < world.city.hallLevel; n += 1) {
    const mine = world.stageContrib[n]?.[player.id] ?? 0;
    if (mine <= 0) continue;
    const total = Object.values(world.stageContrib[n] ?? {}).reduce((s, v) => s + v, 0);
    coins += proRataPayout(stagePot(n), mine, total);
  }
  const settled = { ...player, coins: player.coins + coins, paidStage: world.city.hallLevel };
  world.players[player.id] = settled;
  return settled;
};

const questView = (me: PlayerState | null): StateResponse['quest'] => {
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
  const snap = questSnapshot(world.grid, me.id);
  const { have, done } = questProgress(quest, me, snap, me.questBaseline);
  return { ...base, have, done };
};

const leaderRows = (score: (p: PlayerState) => number): LeaderRow[] =>
  Object.values(world.players)
    .map((p) => ({ name: p.name, score: score(p), me: p.id === DEV_USER }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

// ── Realtime broadcasts (mirror the server's broadcast* helpers) ──────────────

const bTile = (key: string, tile: TileState): void => publish('village', { t: 'tile', key, tile });
const bCity = (city: CityState): void => publish('village', { t: 'city', city });
const bStage = (stage: number): void => publish('village', { t: 'stage', stage });
const bFestival = (festival: FestivalCategory): void =>
  publish('village', { t: 'festival', festival });
const bMarket = (stockpile: Stockpile): void =>
  publish('village', { t: 'market', prices: pricesFor(stockpile), stockpile });
const bRing = (bounds: { lo: number; hi: number }): void =>
  publish('village', { t: 'ring', bounds });

const anyPriceChanged = (before: Stockpile, after: Stockpile): boolean =>
  GOODS.some((g) => priceFor(before[g], g) !== priceFor(after[g], g));

// ── Endpoint handlers ─────────────────────────────────────────────────────────

const loadState = (): StateResponse => {
  const now = mockNow();
  ensureWeather(now);
  let me = ensurePlayer(DEV_USER);
  me = settleStagePayouts(me);
  const { lo, hi } = ringBounds(world.city.hallLevel);
  save();
  return {
    grid: world.grid,
    city: world.city,
    me,
    now,
    top: leaderRows((p) => p.valueSpent).slice(0, 5),
    stockpile: world.stockpile,
    prices: pricesFor(world.stockpile),
    weather: world.city.weather,
    ring: {
      lo,
      hi,
      nextThreshold:
        world.city.hallLevel < HALL_POPULATION.length
          ? HALL_POPULATION[world.city.hallLevel] ?? null
          : null,
      population: world.city.population,
    },
    quest: questView(me),
  };
};

const doClaim = (userId: string, x: number, y: number): { tile: TileState; me: PlayerState } => {
  const key = tileKey(x, y);
  const now = mockNow();
  const player = ensurePlayer(userId);
  const owned = ownedPlots(world.grid, userId);
  const wasOwner = Object.values(world.grid).some((t) => t.owner === userId);

  const err = canClaim(world.grid, x, y, player, owned, world.city.hallLevel);
  if (err) throw new MockError(400, err);
  if (!isUnlocked(x, y, world.city.hallLevel)) {
    throw new MockError(400, 'Upgrade the Village Hall to unlock this land.');
  }
  if (world.grid[key]) throw new MockError(409, 'That tile was just claimed by someone else.');

  const tile: TileState = {
    owner: userId,
    ownerName: player.name,
    tier: 1,
    builtAt: 0,
    readyAt: 0,
    lastCollect: 0,
    boostUntil: 0,
  };
  if (!wasOwner) {
    const houseReady = now + tierStats(CATALOG.house, 1).buildSeconds * 1000;
    tile.buildingId = 'house';
    tile.builtAt = now;
    tile.readyAt = houseReady;
    tile.lastCollect = houseReady;
  }
  world.grid[key] = tile;
  bTile(key, tile);

  if (!wasOwner) {
    const newPopulation = countHouses(world.grid);
    const levelUp = tryHallLevelUp(world.city, newPopulation, KEEP_STAGE_COSTS);
    world.city = {
      ...world.city,
      population: newPopulation,
      hallLevel: levelUp.hallLevel,
      stagePlanks: levelUp.stagePlanks,
      stageBricks: levelUp.stageBricks,
    };
    if (levelUp.leveled.length > 0) {
      bCity(world.city);
      for (const l of levelUp.leveled) bStage(l);
      bRing(ringBounds(levelUp.hallLevel));
    }
  }
  save();
  return { tile, me: player };
};

const doBuild = (
  userId: string,
  x: number,
  y: number,
  buildingId: BuildingId
): { tile: TileState; me: PlayerState } => {
  const key = tileKey(x, y);
  const tile = world.grid[key];
  const player = ensurePlayer(userId);
  if (!tile) throw new MockError(404, 'You must claim this plot first.');
  const spec = CATALOG[buildingId];
  const err = validateBuild(player, tile, spec);
  if (err) throw new MockError(400, err);

  const now = mockNow();
  const stats = tierStats(spec, 1);
  const readyAt = now + stats.buildSeconds * 1000;
  const newTile: TileState = { ...tile, buildingId, tier: 1, builtAt: now, readyAt, lastCollect: readyAt };
  const me = creditXp(
    { ...player, coins: player.coins - spec.cost, valueSpent: player.valueSpent + spec.cost },
    Math.floor(spec.cost / 10)
  );
  world.grid[key] = newTile;
  world.players[userId] = me;
  bTile(key, newTile);
  save();
  return { tile: newTile, me };
};

const doUpgrade = (userId: string, x: number, y: number): { tile: TileState; me: PlayerState } => {
  const key = tileKey(x, y);
  const tile = world.grid[key];
  const player = ensurePlayer(userId);
  if (!tile) throw new MockError(404, 'You must claim this plot first.');
  if (!tile.buildingId) throw new MockError(400, 'There is no building here to upgrade.');
  const spec = CATALOG[tile.buildingId];
  const now = mockNow();
  ensureWeather(now);
  const err = validateUpgrade(player, tile, now);
  if (err) throw new MockError(400, err);

  const adj = adjacencyBonus(world.grid, x, y, world.city.festival, now);
  const houseTier = houseTierOf(world.grid, userId);
  const before = { ...world.stockpile };
  const collected = applyCollect(tile, player, world.city, now, adj, world.stockpile, houseTier);

  const nextTier: Tier = tile.tier === 1 ? 2 : 3;
  const stats = tierStats(spec, nextTier);
  if (collected.player.coins < stats.cost) throw new MockError(400, 'Not enough coins to upgrade this.');

  const readyAt = now + stats.buildSeconds * 1000;
  const upgraded: TileState = { ...collected.tile, tier: nextTier, builtAt: now, readyAt, lastCollect: readyAt };
  const me = creditXp(
    { ...collected.player, coins: collected.player.coins - stats.cost, valueSpent: collected.player.valueSpent + stats.cost },
    Math.floor(stats.cost / 10)
  );

  let stockChanged = false;
  if (goodsTotal(collected.consumed) > 0 || goodsTotal(collected.stocked) > 0) {
    for (const g of GOODS) world.stockpile[g] += (collected.stocked[g] ?? 0) - (collected.consumed[g] ?? 0);
    stockChanged = true;
  }
  world.grid[key] = upgraded;
  world.players[userId] = me;
  const banked = collected.gained.coins + goodsTotal(collected.gained.goods);
  if (banked > 0) world.city = { ...world.city, totalCollected: world.city.totalCollected + banked };
  bTile(key, upgraded);
  if (stockChanged && anyPriceChanged(before, world.stockpile)) bMarket(world.stockpile);
  save();
  return { tile: upgraded, me };
};

const doDemolish = (userId: string, x: number, y: number): { tile: TileState; me: PlayerState } => {
  const key = tileKey(x, y);
  const tile = world.grid[key];
  const player = ensurePlayer(userId);
  if (!tile) throw new MockError(404, 'You must claim this plot first.');
  const err = validateDemolish(player, tile);
  if (err) throw new MockError(400, err);
  const bid = tile.buildingId;
  if (!bid) throw new MockError(400, 'There is no building here to demolish.');
  const refund = demolishRefund(CATALOG[bid], tile.tier);
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
  world.grid[key] = cleared;
  world.players[userId] = me;
  bTile(key, cleared);
  save();
  return { tile: cleared, me };
};

const doPaint = (
  userId: string,
  x: number,
  y: number,
  color: RoofColor
): { tile: TileState; me: PlayerState } => {
  const key = tileKey(x, y);
  const tile = world.grid[key];
  const player = ensurePlayer(userId);
  if (!tile) throw new MockError(404, 'You must claim this plot first.');
  const now = mockNow();
  const err = validatePaint(player, tile, now);
  if (err) throw new MockError(400, err);
  const painted: TileState = { ...tile, roofColor: color };
  const me: PlayerState = { ...player, coins: player.coins - PAINT_COST };
  world.grid[key] = painted;
  world.players[userId] = me;
  bTile(key, painted);
  save();
  return { tile: painted, me };
};

const doCollect = (
  userId: string,
  x: number,
  y: number
): { tile: TileState; me: PlayerState; gained: Gained; golden: boolean } => {
  const key = tileKey(x, y);
  const tile = world.grid[key];
  const player = ensurePlayer(userId);
  if (!tile) throw new MockError(404, 'You must claim this plot first.');
  if (tile.owner !== userId) throw new MockError(403, 'You do not own this plot.');
  if (!tile.buildingId) throw new MockError(400, 'There is nothing to collect here.');

  const now = mockNow();
  ensureWeather(now);
  const adj = adjacencyBonus(world.grid, x, y, world.city.festival, now);
  const houseTier = houseTierOf(world.grid, userId);
  const before = { ...world.stockpile };
  const golden = world.goldenAlways || isGoldenWindowLenient(key, now);
  const result = applyCollect(tile, player, world.city, now, adj, world.stockpile, houseTier, golden);
  const gained = result.gained;
  const banked = gained.coins + goodsTotal(gained.goods);
  const stockChanged = goodsTotal(result.consumed) > 0 || goodsTotal(result.stocked) > 0;
  const produced = banked > 0 || stockChanged;

  const proc = processedUnits(tile.buildingId, gained, result.consumed);
  const me: PlayerState = {
    ...result.player,
    collects: result.player.collects + (banked > 0 ? 1 : 0),
    processedUnits: result.player.processedUnits + proc,
    goldenHarvests: result.player.goldenHarvests + (result.golden ? 1 : 0),
  };
  world.grid[key] = result.tile;
  if (produced) {
    world.players[userId] = me;
    world.city = { ...world.city, totalCollected: world.city.totalCollected + banked };
  }
  if (stockChanged) {
    for (const g of GOODS) world.stockpile[g] += (result.stocked[g] ?? 0) - (result.consumed[g] ?? 0);
  }
  bTile(key, result.tile);
  if (stockChanged && anyPriceChanged(before, world.stockpile)) bMarket(world.stockpile);
  save();
  return { tile: result.tile, me, gained, golden: result.golden };
};

const doCollectAll = (
  userId: string
): { tiles: Record<string, TileState>; me: PlayerState; gained: Gained } => {
  const now = mockNow();
  ensureWeather(now);
  const houseTier = houseTierOf(world.grid, userId);
  const before = { ...world.stockpile };
  let me = ensurePlayer(userId);
  const total: Gained = { coins: 0, xp: 0, goods: {} };
  const changed: Array<{ key: string; tile: TileState }> = [];
  let stockChanged = false;
  let collectsBump = 0;
  let processedBump = 0;

  for (const [key, tile] of Object.entries(world.grid)) {
    if (tile.owner !== userId || !tile.buildingId) continue;
    const { x, y } = parseKey(key);
    const adj = adjacencyBonus(world.grid, x, y, world.city.festival, now);
    const result = applyCollect(tile, me, world.city, now, adj, world.stockpile, houseTier);
    me = result.player;
    total.coins += result.gained.coins;
    total.goods = mergeGoods(total.goods, result.gained.goods);
    total.xp += result.gained.xp;
    if (result.gained.sold) {
      const soldTotal = { ...(total.sold ?? {}) };
      for (const g of GOODS) {
        const s = result.gained.sold[g];
        if (!s) continue;
        const prev = soldTotal[g] ?? { units: 0, coins: 0 };
        soldTotal[g] = { units: prev.units + s.units, coins: prev.coins + s.coins };
      }
      total.sold = soldTotal;
    }
    const consumedUnits = goodsTotal(result.consumed);
    const stockedUnits = goodsTotal(result.stocked);
    if (consumedUnits > 0 || stockedUnits > 0) {
      for (const g of GOODS) world.stockpile[g] += (result.stocked[g] ?? 0) - (result.consumed[g] ?? 0);
      stockChanged = true;
    }
    const banked = result.gained.coins + goodsTotal(result.gained.goods);
    if (banked > 0) collectsBump += 1;
    processedBump += processedUnits(tile.buildingId, result.gained, result.consumed);
    const boostChanged = result.tile.boostUntil !== tile.boostUntil;
    if (banked > 0 || boostChanged || consumedUnits > 0 || stockedUnits > 0) {
      changed.push({ key, tile: result.tile });
    }
  }

  me = { ...me, collects: me.collects + collectsBump, processedUnits: me.processedUnits + processedBump };
  for (const { key, tile } of changed) world.grid[key] = tile;
  const bankedTotal = total.coins + goodsTotal(total.goods);
  if (bankedTotal > 0 || stockChanged) {
    world.players[userId] = me;
    world.city = { ...world.city, totalCollected: world.city.totalCollected + bankedTotal };
  }
  for (const { key, tile } of changed) bTile(key, tile);
  if (stockChanged && anyPriceChanged(before, world.stockpile)) bMarket(world.stockpile);

  const tiles: Record<string, TileState> = {};
  for (const { key, tile } of changed) tiles[key] = tile;
  save();
  return { tiles, me, gained: total };
};

const nextStreak = (lastCheckIn: string, prevStreak: number, today: string): number =>
  lastCheckIn === prevDay(today) ? prevStreak + 1 : 1;

const doCheckIn = (userId: string): { me: PlayerState; gained: { coins: number; xp: number } } => {
  const player = ensurePlayer(userId);
  const today = utcDay(mockNow());
  if (player.lastCheckIn === today) throw new MockError(400, 'You have already checked in today.');
  const streak = nextStreak(player.lastCheckIn, player.streak, today);
  const coins = streakReward(streak);
  const me = creditXp(
    { ...player, streak, lastCheckIn: today, coins: player.coins + coins },
    CHECKIN_XP
  );
  world.players[userId] = me;
  save();
  return { me, gained: { coins, xp: CHECKIN_XP } };
};

const doBoost = (userId: string, x: number, y: number): { tile: TileState; me: PlayerState } => {
  const key = tileKey(x, y);
  const tile = world.grid[key];
  const player = ensurePlayer(userId);
  if (!tile) throw new MockError(404, 'There is nothing to boost here.');
  const now = mockNow();
  const today = utcDay(now);
  const used = player.boostsDate === today ? player.boostsToday : 0;
  const limit = hallPerks(world.city.hallLevel).boostLimit;
  const err = validateBoost(userId, tile, now, used, limit);
  if (err) throw new MockError(400, err);
  const boosted: TileState = { ...tile, boostUntil: now + BOOST_DURATION_MS, boostBy: userId };
  const me = creditXp(
    {
      ...player,
      coins: player.coins + BOOST_COINS,
      boostsToday: used + 1,
      boostsDate: today,
      boostsGiven: player.boostsGiven + 1,
    },
    BOOST_XP
  );
  world.grid[key] = boosted;
  world.players[userId] = me;
  bTile(key, boosted);
  save();
  return { tile: boosted, me };
};

const doContribute = (
  userId: string,
  good: 'planks' | 'bricks',
  qty: number
): { city: CityState; me: PlayerState } => {
  const player = ensurePlayer(userId);
  if (world.city.hallLevel >= KEEP_STAGES) {
    throw new MockError(400, 'The Village Hall is already at its highest level.');
  }
  const held = player.wallet[good];
  if (held <= 0) throw new MockError(400, `You have no ${good} to contribute.`);
  const clamped = Math.min(qty, held);
  const res = applyKeepContribution(world.city, good, clamped, KEEP_STAGE_COSTS);
  if (res.applied <= 0) {
    throw new MockError(400, `The Village Hall does not need more ${good} for this level yet.`);
  }
  const wallet = { ...player.wallet, [good]: held - res.applied };
  const me = creditXp(
    { ...player, wallet, lifetimeContributed: player.lifetimeContributed + res.applied },
    res.applied
  );

  const stageMap = world.stageContrib[res.stage] ?? {};
  stageMap[userId] = (stageMap[userId] ?? 0) + res.applied;
  world.stageContrib[res.stage] = stageMap;

  const filledCity: CityState = { ...world.city, stagePlanks: res.stagePlanks, stageBricks: res.stageBricks };
  const levelUp = tryHallLevelUp(filledCity, world.city.population, KEEP_STAGE_COSTS);
  const nextCity: CityState = {
    ...world.city,
    hallLevel: levelUp.hallLevel,
    stagePlanks: levelUp.stagePlanks,
    stageBricks: levelUp.stageBricks,
    totalContributed: world.city.totalContributed + res.applied,
  };
  world.city = nextCity;
  world.players[userId] = me;
  bCity(nextCity);
  for (const l of levelUp.leveled) bStage(l);
  if (levelUp.leveled.length > 0) bRing(ringBounds(levelUp.hallLevel));
  save();
  return { city: nextCity, me };
};

const doClaimQuest = (userId: string): ClaimQuestResponse => {
  const player = ensurePlayer(userId);
  const quest = questAt(player.questIndex, player.questLap);
  const snap = questSnapshot(world.grid, userId);
  const err = claimQuestError(quest, player, snap, player.questBaseline);
  if (err) throw new MockError(400, err);
  const coins = quest.reward.coins ?? 0;
  const xp = quest.reward.xp ?? 0;
  const next = advanceQuest(player.questIndex, player.questLap);
  let me: PlayerState = { ...player, coins: player.coins + coins, questIndex: next.index, questLap: next.lap };
  if (xp > 0) me = creditXp(me, xp);
  me = { ...me, questBaseline: questBaselineFor(next.index, next.lap, me, snap) };
  world.players[userId] = me;
  save();
  return { me, quest: { index: player.questIndex, lap: player.questLap }, gained: { coins, xp } };
};

const doNameStage = (userId: string, first: number, second: number): { city: CityState } => {
  const stage = world.city.hallLevel - 1;
  if (stage < 0) throw new MockError(400, 'No stage has been completed yet.');
  if (world.city.stageNames[stage]) throw new MockError(400, 'That stage has already been named.');
  const contribs = world.stageContrib[stage] ?? {};
  let top: string | null = null;
  let topUnits = 0;
  for (const [uid, units] of Object.entries(contribs)) {
    if (units > topUnits) {
      topUnits = units;
      top = uid;
    }
  }
  if (top !== userId) throw new MockError(403, 'Only the stage’s top contributor may name it.');
  const adj = STAGE_NAME_WORDS.adjectives[first];
  const noun = STAGE_NAME_WORDS.nouns[second];
  if (adj === undefined || noun === undefined) throw new MockError(400, 'Invalid stage-name selection.');
  const stageNames = [...world.city.stageNames];
  stageNames[stage] = `${adj} ${noun}`;
  world.city = { ...world.city, stageNames };
  bCity(world.city);
  save();
  return { city: world.city };
};

const doShare = (kind: string, value: number): { ok: true } => {
  if (kind === 'levelup') {
    const me = ensurePlayer(DEV_USER);
    if (value < 2 || value > MAX_LEVEL) throw new MockError(400, 'That is not a level you can share.');
    if (value > me.level) throw new MockError(400, 'You have not reached that level yet.');
  } else {
    if (value < 1 || value > KEEP_STAGES) throw new MockError(400, 'That is not a Village Hall level you can share.');
    if (value > world.city.hallLevel) throw new MockError(400, 'That Hall level has not been reached yet.');
  }
  console.log(`[harness] share(${kind}, ${value}) — would post a comment on the real server`);
  return { ok: true };
};

const loadSummary = (): Summary => {
  const now = mockNow();
  ensureWeather(now);
  const owners = new Set<string>();
  let buildings = 0;
  for (const t of Object.values(world.grid)) {
    owners.add(t.owner);
    if (t.buildingId) buildings += 1;
  }
  const hallLevel = world.city.hallLevel;
  let landmarkPct = 100;
  if (hallLevel < KEEP_STAGES) {
    const cost = KEEP_STAGE_COSTS[hallLevel] ?? { planks: 1, bricks: 1 };
    const need = cost.planks + cost.bricks;
    const have = world.city.stagePlanks + world.city.stageBricks;
    landmarkPct = Math.max(0, Math.min(100, Math.floor((have / need) * 100)));
  }
  let readyForMe = 0;
  for (const [key, tile] of Object.entries(world.grid)) {
    if (tile.owner !== DEV_USER || !tile.buildingId) continue;
    const { x, y } = parseKey(key);
    const adj = adjacencyBonus(world.grid, x, y, world.city.festival, now);
    const { gained } = accrue(tile, now, world.city.festival, adj, world.city.weather, world.stockpile);
    if (gained.coins + goodsTotal(gained.goods) > 0) readyForMe += 1;
  }
  let hot: Good = 'wheat';
  let bestRatio = -Infinity;
  for (const g of GOODS) {
    const ratio = priceFor(world.stockpile[g], g) / MARKET[g].base;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      hot = g;
    }
  }
  return {
    villageName: world.city.villageName,
    theme: world.city.theme,
    buildings,
    players: owners.size,
    hallLevel,
    landmarkPct,
    festival: world.city.festival,
    readyForMe,
    weather: world.city.weather,
    hotGood: hot,
    hotPrice: priceFor(world.stockpile[hot], hot),
  };
};

// ── Request parsing / routing ─────────────────────────────────────────────────

const asCoord = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

const isBuildingId = (v: unknown): v is BuildingId => typeof v === 'string' && v in CATALOG;
const isRoofColor = (v: unknown): v is RoofColor =>
  v === 'brown' || v === 'green' || v === 'purple' || v === 'beige';
const isProcessedGood = (v: unknown): v is 'planks' | 'bricks' => v === 'planks' || v === 'bricks';

const getField = (body: unknown, key: string): unknown =>
  body && typeof body === 'object' && key in body ? (body as Record<string, unknown>)[key] : undefined;

const RETIRED_MARKET = 'The market stall has closed — your harvests sell themselves now.';

const route = (method: string, path: string, body: unknown): Response => {
  const uid = DEV_USER;
  try {
    if (method === 'GET' && path === '/api/state') return json(loadState());
    if (method === 'GET' && path === '/api/summary') return json(loadSummary());
    if (method === 'GET' && path === '/api/leaderboards') {
      return json({
        value: leaderRows((p) => p.valueSpent),
        earned: leaderRows((p) => p.lifetimeEarned),
        contrib: leaderRows((p) => p.lifetimeContributed),
      });
    }
    if (method !== 'POST') return fail('Not found.', 404);

    const x = asCoord(getField(body, 'x'));
    const y = asCoord(getField(body, 'y'));
    switch (path) {
      case '/api/claim':
        if (x === null || y === null) return fail('Invalid tile coordinates.', 400);
        return json(doClaim(uid, x, y));
      case '/api/build': {
        const bid = getField(body, 'buildingId');
        if (x === null || y === null) return fail('Invalid tile coordinates.', 400);
        if (!isBuildingId(bid)) return fail('Unknown building.', 400);
        return json(doBuild(uid, x, y, bid));
      }
      case '/api/upgrade':
        if (x === null || y === null) return fail('Invalid tile coordinates.', 400);
        return json(doUpgrade(uid, x, y));
      case '/api/demolish':
        if (x === null || y === null) return fail('Invalid tile coordinates.', 400);
        return json(doDemolish(uid, x, y));
      case '/api/paint': {
        const color = getField(body, 'color');
        if (x === null || y === null) return fail('Invalid tile coordinates.', 400);
        if (!isRoofColor(color)) return fail('Unknown roof colour.', 400);
        return json(doPaint(uid, x, y, color));
      }
      case '/api/collect':
        if (x === null || y === null) return fail('Invalid tile coordinates.', 400);
        return json(doCollect(uid, x, y));
      case '/api/collect-all':
        return json(doCollectAll(uid));
      case '/api/checkin':
        return json(doCheckIn(uid));
      case '/api/claim-quest':
        return json(doClaimQuest(uid));
      case '/api/boost':
        if (x === null || y === null) return fail('Invalid tile coordinates.', 400);
        return json(doBoost(uid, x, y));
      case '/api/contribute': {
        const good = getField(body, 'good');
        const qty = getField(body, 'qty');
        if (!isProcessedGood(good)) return fail('You can only contribute planks or bricks.', 400);
        if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) {
          return fail('Contribution must be a whole number of at least 1.', 400);
        }
        return json(doContribute(uid, good, qty));
      }
      case '/api/name-stage': {
        const first = getField(body, 'first');
        const second = getField(body, 'second');
        if (typeof first !== 'number' || typeof second !== 'number') {
          return fail('Invalid stage-name selection.', 400);
        }
        return json(doNameStage(uid, first, second));
      }
      case '/api/share': {
        const kind = getField(body, 'kind');
        const value = asCoord(getField(body, 'value'));
        if (kind !== 'levelup' && kind !== 'stage') return fail('Unknown share kind.', 400);
        if (value === null) return fail('Invalid milestone value.', 400);
        return json(doShare(kind, value));
      }
      // Retired endpoints — permanent 410s, matching the real server.
      case '/api/sell':
      case '/api/buy':
        return fail(RETIRED_MARKET, 410);
      case '/api/trade':
        return fail('The trader has left the village.', 410);
      case '/api/vote':
        return fail('The ballot box is gone — festivals now rotate on their own.', 410);
      default:
        return fail('Not found.', 404);
    }
  } catch (err) {
    if (err instanceof MockError) return fail(err.message, err.status);
    console.error('[harness] endpoint error', err);
    return fail('Something went wrong in the mock server.', 500);
  }
};

// ── Fetch interceptor ─────────────────────────────────────────────────────────

let installed = false;

export const installMockApi = (): void => {
  if (installed) return;
  installed = true;
  load();

  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    let path: string;
    try {
      path = new URL(url, location.origin).pathname;
    } catch {
      return original(input, init);
    }
    if (!path.startsWith('/api/')) return original(input, init);

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let body: unknown = undefined;
    const rawBody = init?.body ?? (input instanceof Request ? undefined : undefined);
    if (typeof rawBody === 'string' && rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = undefined;
      }
    }
    // Small delay so the UI's pending/spinner states are visible.
    await new Promise((r) => setTimeout(r, 40));
    return route(method, path, body);
  };
  console.log('[harness] mock API installed — /api/* served locally');
};

// ── Dev-panel world controls ──────────────────────────────────────────────────

export const devControls = {
  now: mockNow,
  offsetMs: (): number => clockOffset,
  warp(ms: number): void {
    clockOffset += ms;
    save();
  },
  addCoins(n: number): void {
    const me = ensurePlayer(DEV_USER);
    world.players[DEV_USER] = { ...me, coins: me.coins + n };
    save();
  },
  addGoods(good: Good, n: number): void {
    const me = ensurePlayer(DEV_USER);
    world.players[DEV_USER] = { ...me, wallet: { ...me.wallet, [good]: me.wallet[good] + n } };
    save();
  },
  cycleWeather(): Weather {
    const order: Weather[] = ['clear', 'sunny', 'rain', 'harvestmoon'];
    const i = order.indexOf(world.city.weather);
    const next = order[(i + 1) % order.length] ?? 'clear';
    world.city = { ...world.city, weather: next, weatherDate: utcDay(mockNow()) };
    bCity(world.city);
    save();
    return next;
  },
  cycleFestival(): FestivalCategory {
    const order: FestivalCategory[] = ['coins', 'raw', 'processed', 'decor'];
    const i = order.indexOf(world.city.festival);
    const next = order[(i + 1) % order.length] ?? 'coins';
    world.city = { ...world.city, festival: next, festivalDate: utcDay(mockNow()) };
    bFestival(next);
    save();
    return next;
  },
  setGoldenAlways(on: boolean): void {
    world.goldenAlways = on;
    save();
  },
  goldenAlways: (): boolean => world.goldenAlways,
  /** Drop a bot villager: a house + one ready random producer near the centre. */
  addBot(): boolean {
    const now = mockNow();
    const { lo, hi } = ringBounds(world.city.hallLevel);
    const anchor = findEmptyNearCentre(lo, hi);
    if (!anchor) return false;
    world.botSeq += 1;
    const botId = `t2_bot${world.botSeq}`;
    const botName = `bot_${world.botSeq}`;
    world.players[botId] = { ...freshPlayer(botId, botName), level: 5 };

    const houseTile: TileState = {
      owner: botId,
      ownerName: botName,
      tier: 1,
      builtAt: now,
      readyAt: now,
      lastCollect: now,
      boostUntil: 0,
      buildingId: 'house',
    };
    world.grid[tileKey(anchor.x, anchor.y)] = houseTile;
    bTile(tileKey(anchor.x, anchor.y), houseTile);

    const producers: BuildingId[] = ['wheatfield', 'grove', 'quarry', 'windmill', 'sawmill'];
    const producer = producers[world.botSeq % producers.length] ?? 'wheatfield';
    const spot = findEmptyAdjacent(anchor.x, anchor.y, lo, hi);
    if (spot) {
      const prodTile: TileState = {
        owner: botId,
        ownerName: botName,
        tier: 1,
        builtAt: now,
        readyAt: now,
        lastCollect: now,
        boostUntil: 0,
        buildingId: producer,
      };
      world.grid[tileKey(spot.x, spot.y)] = prodTile;
      bTile(tileKey(spot.x, spot.y), prodTile);
    }

    const population = countHouses(world.grid);
    const levelUp = tryHallLevelUp(world.city, population, KEEP_STAGE_COSTS);
    world.city = {
      ...world.city,
      population,
      hallLevel: levelUp.hallLevel,
      stagePlanks: levelUp.stagePlanks,
      stageBricks: levelUp.stageBricks,
    };
    bCity(world.city);
    if (levelUp.leveled.length > 0) {
      for (const l of levelUp.leveled) bStage(l);
      bRing(ringBounds(levelUp.hallLevel));
    }
    save();
    return true;
  },
  reset(): void {
    clockOffset = 0;
    world = freshWorld();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    save();
  },
};

const findEmptyNearCentre = (lo: number, hi: number): { x: number; y: number } | null => {
  const c = (RING_BY_LEVEL[0]!.lo + RING_BY_LEVEL[0]!.hi) / 2;
  const cx = Math.round(c);
  for (let r = 0; r <= hi - lo; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        const x = cx + dx;
        const y = cx + dy;
        if (x < lo || x > hi || y < lo || y > hi) continue;
        const spot = openSpot(x, y);
        if (spot) return { x, y };
      }
    }
  }
  return null;
};

const findEmptyAdjacent = (
  x: number,
  y: number,
  lo: number,
  hi: number
): { x: number; y: number } | null => {
  const cands = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
  for (const c of cands) {
    if (c.x < lo || c.x > hi || c.y < lo || c.y > hi) continue;
    if (openSpot(c.x, c.y)) return c;
  }
  return null;
};

/** True when (x,y) is a claimable, unlocked, unoccupied, non-plaza, non-river spot. */
const openSpot = (x: number, y: number): boolean => {
  if (world.grid[tileKey(x, y)]) return false;
  // Reuse canClaim's rejections with a throwaway "bot" player far under its plot
  // cap; owned huge so plot-limit never blocks, and pass owned=0 to skip the
  // homestead radius. A null result means the tile is legally settleable.
  const bot = freshPlayer('t2_probe', 'probe');
  bot.level = MAX_LEVEL;
  return canClaim(world.grid, x, y, bot, 0, world.city.hallLevel) === null;
};
