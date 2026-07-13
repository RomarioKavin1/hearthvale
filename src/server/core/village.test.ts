import { describe, expect, it } from 'vitest';
import type { CityState, Gained, Good, PlayerState, TileState } from '../../shared/types';
import { CATALOG, KEEP_STAGE_COSTS, PAINT_COST } from '../../shared/catalog';
import { emptyStockpile } from '../../shared/logic/economy';
import { sellValue } from '../../shared/logic/market';
import {
  CHECKIN_XP,
  affordableRuns,
  applyCollect,
  applyHallBuff,
  applyKeepContribution,
  applyLevelUp,
  boostsUsedToday,
  canCheckIn,
  demolishRefund,
  expansionGate,
  flairTitle,
  landmarkComplete,
  MURAL_BUDGET,
  muralPaintedToday,
  nextFestival,
  nextStreak,
  processedUnits,
  proRataPayout,
  shareText,
  stageNameFromWords,
  stagePot,
  tryHallLevelUp,
  validateBoost,
  validateBuild,
  validateDemolish,
  validateMuralPaint,
  validateNaming,
  validatePaint,
  validateUpgrade,
} from './village';

const player = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  id: 'p1',
  name: 'Alice',
  coins: 1000,
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
  muralToday: 0,
  muralDate: '',
  muralPixels: 0,
  outfit: 0,
  questIndex: 0,
  questLap: 0,
  questBaseline: 0,
  ...overrides,
});

const tile = (overrides: Partial<TileState> = {}): TileState => ({
  owner: 'p1',
  ownerName: 'Alice',
  tier: 1,
  builtAt: 0,
  readyAt: 0,
  lastCollect: 0,
  boostUntil: 0,
  ...overrides,
});

const city = (overrides: Partial<CityState> = {}): CityState => ({
  foundedAt: 0,
  villageName: '',
  theme: 'meadow',
  festival: 'raw',
  festivalDate: '2026-07-07',
  hallLevel: 0,
  stagePlanks: 0,
  stageBricks: 0,
  totalCollected: 0,
  totalContributed: 0,
  weather: 'clear',
  weatherDate: '2026-07-07',
  population: 0,
  stageNames: [],
  crest: 0,
  crestColor: 0,
  ...overrides,
});

const stock = (overrides: Partial<Record<string, number>> = {}) => ({
  ...emptyStockpile(),
  ...overrides,
});

describe('validateBuild', () => {
  it('rejects a tile the player does not own', () => {
    const t = tile({ owner: 'someoneElse' });
    expect(validateBuild(player(), t, CATALOG.wheatfield)).not.toBeNull();
  });

  it('rejects a tile that already has a building', () => {
    const t = tile({ buildingId: 'wheatfield' });
    expect(validateBuild(player(), t, CATALOG.wheatfield)).not.toBeNull();
  });

  it('rejects the house — it is auto-placed on the first claim, never built', () => {
    expect(validateBuild(player({ coins: 1000, level: 1 }), tile(), CATALOG.house)).not.toBeNull();
  });

  it('rejects a building locked behind a higher level', () => {
    expect(validateBuild(player({ level: 1 }), tile(), CATALOG.quarry)).not.toBeNull();
  });

  it('rejects when the player cannot afford the tier-1 cost', () => {
    expect(validateBuild(player({ coins: 10 }), tile(), CATALOG.wheatfield)).not.toBeNull();
  });

  it('allows a valid build on an owned empty plot with funds and level', () => {
    expect(validateBuild(player({ coins: 100, level: 1 }), tile(), CATALOG.wheatfield)).toBeNull();
  });
});

describe('validatePaint', () => {
  it('rejects a tile the player does not own', () => {
    const t = tile({ owner: 'someoneElse', buildingId: 'house', readyAt: 0 });
    expect(validatePaint(player(), t, 1000)).not.toBeNull();
  });

  it('rejects a tile with no building', () => {
    expect(validatePaint(player(), tile(), 1000)).not.toBeNull();
  });

  it('rejects a flat building with no roof (e.g. a wheat field)', () => {
    const t = tile({ buildingId: 'wheatfield', readyAt: 0 });
    expect(validatePaint(player(), t, 1000)).not.toBeNull();
  });

  it('rejects while construction is still in progress', () => {
    const t = tile({ buildingId: 'house', readyAt: 5000 });
    expect(validatePaint(player(), t, 1000)).not.toBeNull();
  });

  it('rejects when the player cannot afford PAINT_COST', () => {
    const t = tile({ buildingId: 'house', readyAt: 0 });
    expect(validatePaint(player({ coins: PAINT_COST - 1 }), t, 1000)).not.toBeNull();
  });

  it('allows painting a completed stacked building the player owns and can afford', () => {
    const t = tile({ buildingId: 'house', readyAt: 0 });
    expect(validatePaint(player({ coins: PAINT_COST }), t, 1000)).toBeNull();
  });

  it('charges a flat 25 coins', () => {
    expect(PAINT_COST).toBe(25);
  });
});

describe('mural budget (E1)', () => {
  it('reads today\'s count and resets on a date rollover', () => {
    expect(muralPaintedToday(player({ muralToday: 5, muralDate: '2026-07-13' }), '2026-07-13')).toBe(5);
    // Yesterday's count doesn't carry into today.
    expect(muralPaintedToday(player({ muralToday: 5, muralDate: '2026-07-12' }), '2026-07-13')).toBe(0);
    // Never painted.
    expect(muralPaintedToday(player(), '2026-07-13')).toBe(0);
  });

  it('grants a 12-pixel daily budget', () => {
    expect(MURAL_BUDGET).toBe(12);
  });

  it('rejects out-of-bounds pixels', () => {
    expect(validateMuralPaint(-1, 0, 0, 0, MURAL_BUDGET)).not.toBeNull();
    expect(validateMuralPaint(24, 0, 0, 0, MURAL_BUDGET)).not.toBeNull();
    expect(validateMuralPaint(0, 16, 0, 0, MURAL_BUDGET)).not.toBeNull();
    expect(validateMuralPaint(1.5, 0, 0, 0, MURAL_BUDGET)).not.toBeNull();
  });

  it('rejects colours outside 0..11', () => {
    expect(validateMuralPaint(0, 0, -1, 0, MURAL_BUDGET)).not.toBeNull();
    expect(validateMuralPaint(0, 0, 12, 0, MURAL_BUDGET)).not.toBeNull();
  });

  it('rejects once the daily budget is spent', () => {
    expect(validateMuralPaint(0, 0, 0, MURAL_BUDGET, MURAL_BUDGET)).not.toBeNull();
    expect(validateMuralPaint(0, 0, 0, MURAL_BUDGET - 1, MURAL_BUDGET)).toBeNull();
  });

  it('allows a valid in-bounds paint with budget left', () => {
    expect(validateMuralPaint(23, 15, 11, 0, MURAL_BUDGET)).toBeNull();
    expect(validateMuralPaint(0, 0, 0, 0, MURAL_BUDGET)).toBeNull();
  });
});

describe('validateUpgrade', () => {
  it('rejects a tile with no building', () => {
    expect(validateUpgrade(player(), tile(), 1000)).not.toBeNull();
  });

  it('rejects while construction is still in progress', () => {
    const t = tile({ buildingId: 'house', readyAt: 5000 });
    expect(validateUpgrade(player(), t, 1000)).not.toBeNull();
  });

  it('rejects a tier-3 building (tier cap)', () => {
    const t = tile({ buildingId: 'house', tier: 3, readyAt: 0 });
    expect(validateUpgrade(player(), t, 1000)).not.toBeNull();
  });

  it('allows upgrading a completed tier-1 building the player owns', () => {
    const t = tile({ buildingId: 'house', tier: 1, readyAt: 0 });
    expect(validateUpgrade(player(), t, 1000)).toBeNull();
  });
});

describe('applyLevelUp', () => {
  it('promotes to level 2 and grants a second plot at the level-2 threshold', () => {
    // xpFor(2) = 100; PLOT_LEVELS = [1,2,4,7,10] → level 2 unlocks plot #2.
    const p = applyLevelUp(player({ level: 1, plots: 1, xp: 100 }));
    expect(p.level).toBe(2);
    expect(p.plots).toBe(2);
  });

  it('grants a third plot when crossing into level 4', () => {
    // xpFor(4) = 600; level 4 unlocks plot #3.
    const p = applyLevelUp(player({ level: 3, plots: 2, xp: 600 }));
    expect(p.level).toBe(4);
    expect(p.plots).toBe(3);
  });

  it('leaves the player unchanged when no level is gained', () => {
    const p = applyLevelUp(player({ level: 1, plots: 1, xp: 10 }));
    expect(p.level).toBe(1);
    expect(p.plots).toBe(1);
  });
});

describe('demolishRefund', () => {
  it('refunds 50% of the invested cost, floored', () => {
    // wheatfield base cost 60: tier costs 60 / 150 / 360 → invested 60 / 210 / 570.
    expect(demolishRefund(CATALOG.wheatfield, 1)).toBe(30);
    expect(demolishRefund(CATALOG.wheatfield, 2)).toBe(105);
    expect(demolishRefund(CATALOG.wheatfield, 3)).toBe(285);
  });
});

describe('validateDemolish', () => {
  it('rejects a tile the player does not own', () => {
    const t = tile({ owner: 'someoneElse', buildingId: 'wheatfield' });
    expect(validateDemolish(player(), t)).not.toBeNull();
  });

  it('rejects a tile with no building', () => {
    expect(validateDemolish(player(), tile())).not.toBeNull();
  });

  it('refuses to demolish the house — your home cannot be torn down', () => {
    const t = tile({ buildingId: 'house', readyAt: 0 });
    expect(validateDemolish(player(), t)).toBe('Your house is your home.');
  });

  it('allows demolishing an owned building, even under construction', () => {
    const done = tile({ buildingId: 'wheatfield', readyAt: 0 });
    expect(validateDemolish(player(), done)).toBeNull();
    // Under construction is still demolishable (build already deducted the cost).
    const building = tile({ buildingId: 'wheatfield', readyAt: 9_999_999_999 });
    expect(validateDemolish(player(), building)).toBeNull();
  });
});

describe('applyCollect — coins buildings', () => {
  it('credits a normal gain and advances lastCollect', () => {
    // house rate 1/min → 1 coin after 60s.
    const t = tile({ buildingId: 'house', lastCollect: 0, readyAt: 0 });
    const now = 60_000;
    const res = applyCollect(t, player({ coins: 0 }), city(), now, 0, emptyStockpile(), 1);
    expect(res.gained).toEqual({ coins: 1, xp: 1, goods: {} });
    expect(res.player.coins).toBe(1);
    expect(res.player.xp).toBe(1);
    expect(res.tile.lastCollect).toBe(now);
  });

  it('advances the absolute lifetimeEarned counter by the coins gained', () => {
    const t = tile({ buildingId: 'house', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(t, player({ coins: 0, lifetimeEarned: 40 }), city(), 60_000, 0, emptyStockpile(), 1);
    expect(res.gained.coins).toBe(1);
    expect(res.player.lifetimeEarned).toBe(41);
  });

  it('is replay-safe: re-applying the same collect yields the same lb:earned score', () => {
    const t = tile({ buildingId: 'house', lastCollect: 0, readyAt: 0 });
    const start = player({ coins: 0, lifetimeEarned: 40 });
    const a = applyCollect(t, start, city(), 60_000, 0, emptyStockpile(), 1);
    const b = applyCollect(t, start, city(), 60_000, 0, emptyStockpile(), 1);
    expect(a.player.lifetimeEarned).toBe(b.player.lifetimeEarned);
    expect(a.player.lifetimeEarned).toBe(41);
  });

  it('preserves fractional progress on a zero gain (lastCollect NOT advanced)', () => {
    const t = tile({ buildingId: 'house', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(t, player({ coins: 0 }), city(), 1000, 0, emptyStockpile(), 1);
    expect(res.gained).toEqual({ coins: 0, xp: 0, goods: {} });
    expect(res.tile.lastCollect).toBe(0);
  });

  it('clears an expired boost after a producing collect', () => {
    const t = tile({ buildingId: 'house', lastCollect: 0, readyAt: 0, boostUntil: 30_000, boostBy: 'bob' });
    const res = applyCollect(t, player({ coins: 0 }), city(), 120_000, 0, emptyStockpile(), 1);
    expect(res.gained.coins).toBeGreaterThan(0);
    expect(res.tile.boostUntil).toBe(0);
    expect(res.tile.boostBy).toBeUndefined();
  });

  it('keeps an unexpired boost after collecting', () => {
    const t = tile({ buildingId: 'house', lastCollect: 0, readyAt: 0, boostUntil: 300_000, boostBy: 'bob' });
    const res = applyCollect(t, player({ coins: 0 }), city(), 120_000, 0, emptyStockpile(), 1);
    expect(res.tile.boostUntil).toBe(300_000);
    expect(res.tile.boostBy).toBe('bob');
  });

  it('clamps to the tier cap on a long absence', () => {
    const t = tile({ buildingId: 'house', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(t, player({ coins: 0 }), city(), 1_000_000_000, 0, emptyStockpile(), 1);
    expect(res.gained.coins).toBe(60);
  });

  it('excludes the house itself from its own +2%/tier aura (isHouse)', () => {
    // A tier-3 house would grant +6% to OTHER buildings, but never to itself.
    const t = tile({ buildingId: 'house', tier: 1, lastCollect: 0, readyAt: 0 });
    const res = applyCollect(t, player({ coins: 0 }), city(), 600_000, 0, emptyStockpile(), 3);
    // 10 min × 1/min = 10 coins, unscaled (house excluded from its own aura).
    expect(res.gained.coins).toBe(10);
  });
});

describe('applyCollect — Perfect Harvest (golden window, S2)', () => {
  it('golden doubles coins + xp on a coins building and flags the result', () => {
    const t = tile({ buildingId: 'house', lastCollect: 0, readyAt: 0 });
    const plain = applyCollect(t, player({ coins: 0 }), city(), 1_000_000_000, 0, emptyStockpile(), 1);
    const gold = applyCollect(t, player({ coins: 0 }), city(), 1_000_000_000, 0, emptyStockpile(), 1, true);
    expect(plain.gained.coins).toBe(60);
    expect(gold.gained.coins).toBe(120);
    expect(gold.gained.xp).toBe(plain.gained.xp * 2);
    expect(gold.player.coins).toBe(120);
    expect(gold.golden).toBe(true);
    expect(plain.golden).toBe(false);
  });

  it('golden doubles the produced units of a raw harvest (all to the wallet)', () => {
    const t = tile({ buildingId: 'wheatfield', lastCollect: 0, readyAt: 0 });
    // wheatfield tier-1 cap is 90 → golden doubles the harvest to 180 units, all
    // of which land in the owner's wallet (nothing is sold on collect).
    const res = applyCollect(
      t,
      player({ coins: 0 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      emptyStockpile(),
      0,
      true
    );
    expect(res.gained.goods).toEqual({ wheat: 180 });
    expect(res.player.wallet.wheat).toBe(180);
    expect(res.gained.coins).toBe(0);
    expect(res.stocked).toEqual({});
    expect(res.player.soldUnits).toBe(0);
    expect(res.golden).toBe(true);
  });

  it('does NOT double when golden is false (the collect-all default path)', () => {
    const t = tile({ buildingId: 'house', lastCollect: 0, readyAt: 0 });
    // No golden argument → defaults to false, exactly as doCollectAll calls it.
    const res = applyCollect(t, player({ coins: 0 }), city(), 1_000_000_000, 0, emptyStockpile(), 1);
    expect(res.gained.coins).toBe(60);
    expect(res.golden).toBe(false);
  });

  it('reports golden=false when a golden tap produced nothing', () => {
    // Ready but zero elapsed since lastCollect → no production, so no golden.
    const t = tile({ buildingId: 'house', lastCollect: 60_000, readyAt: 0 });
    const res = applyCollect(t, player({ coins: 0 }), city(), 60_000, 0, emptyStockpile(), 1, true);
    expect(res.gained.coins).toBe(0);
    expect(res.golden).toBe(false);
  });
});

describe('applyCollect — raw producers (to the wallet)', () => {
  it('deposits the whole harvest into the wallet, no coins, no stockpile change', () => {
    const t = tile({ buildingId: 'wheatfield', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 0, lifetimeEarned: 500 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      emptyStockpile(),
      0
    );
    // wheatfield tier-1 cap is 90 — all 90 wheat go straight to the wallet.
    expect(res.gained.coins).toBe(0);
    expect(res.gained.goods).toEqual({ wheat: 90 });
    expect(res.player.wallet.wheat).toBe(90);
    expect(res.stocked).toEqual({});
    expect(res.player.coins).toBe(0);
    // No coins minted, so lifetimeEarned is unchanged (income is realised at sell).
    expect(res.player.lifetimeEarned).toBe(500);
    // soldUnits only advances on manual Market sells — never on collect.
    expect(res.player.soldUnits).toBe(0);
  });

  it('deposits the same harvest regardless of the village stockpile level', () => {
    const t = tile({ buildingId: 'wheatfield', lastCollect: 0, readyAt: 0 });
    const start = player({ coins: 0 });
    const a = applyCollect(t, start, city({ festival: 'coins' }), 1_000_000_000, 0, stock({ wheat: 200 }), 0);
    const b = applyCollect(t, start, city({ festival: 'coins' }), 1_000_000_000, 0, emptyStockpile(), 0);
    // Collecting never touches market pricing now — the wallet gain is identical.
    expect(a.gained.goods).toEqual({ wheat: 90 });
    expect(b.gained.goods).toEqual({ wheat: 90 });
    expect(a.player.coins).toBe(b.player.coins);
  });

  it('grants a level-up (and plots) when the collected xp crosses a threshold', () => {
    const t = tile({ buildingId: 'wheatfield', lastCollect: 0, readyAt: 0 });
    // xpFor(3) = 300; starting one wheatfield-cap (90 xp) short of it at level 2.
    const res = applyCollect(
      t,
      player({ coins: 0, xp: 250, level: 2, plots: 2 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      emptyStockpile(),
      0
    );
    // xp is still granted per unit produced, before the auto-sale.
    expect(res.player.xp).toBe(340);
    expect(res.player.level).toBe(3);
    expect(res.player.plots).toBe(2);
  });
});

describe('applyCollect — processors', () => {
  it('a windmill grinds stockpile wheat into flour to the wallet, paying the wheat cost', () => {
    const t = tile({ buildingId: 'windmill', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 1000 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stock({ wheat: 100 }),
      0
    );
    // cap 45 flour; priceFor(100, wheat) === 3, per 2 → wheat cost 3×90 = 270,
    // paid from the owner's balance. Flour lands in the wallet like planks.
    expect(res.consumedStockpile).toEqual({ wheat: 90 });
    expect(res.stocked).toEqual({});
    expect(res.gained.goods.flour).toBe(45);
    expect(res.player.wallet.flour).toBe(45);
    expect(res.gained.coins).toBe(0);
    expect(res.player.coins).toBe(1000 - 270);
    // No coins minted → lifetimeEarned unchanged; soldUnits only bumps on sells.
    expect(res.player.lifetimeEarned).toBe(0);
    expect(res.player.soldUnits).toBe(0);
  });

  it('a sawmill outputs planks to the wallet and pays inputs from the balance', () => {
    const t = tile({ buildingId: 'sawmill', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 1000 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stock({ logs: 100 }),
      0
    );
    // cap 36 planks; priceFor(100, logs) === 4, per 2 → cost 4×72 = 288.
    expect(res.gained.goods.planks).toBe(36);
    expect(res.player.wallet.planks).toBe(36);
    expect(res.consumedStockpile).toEqual({ logs: 72 });
    expect(res.stocked).toEqual({});
    expect(res.player.coins).toBe(1000 - 288);
    expect(res.player.lifetimeEarned).toBe(0);
    expect(res.player.soldUnits).toBe(0);
  });

  it('limits sawmill runs to what the owner can afford when short on coins', () => {
    const t = tile({ buildingId: 'sawmill', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 10 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stock({ logs: 100 }),
      0
    );
    // cost/run = price 4 × per 2 = 8; floor(10/8) = 1 run only.
    expect(res.gained.goods.planks).toBe(1);
    expect(res.consumedStockpile).toEqual({ logs: 2 });
    expect(res.player.coins).toBe(10 - 8);
  });

  it('does not advance lastCollect when the owner can afford zero runs', () => {
    const t = tile({ buildingId: 'sawmill', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 5 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stock({ logs: 100 }),
      0
    );
    // floor(5/8) = 0 runs. Nothing bought, wallet empty → both splits empty.
    expect(res.gained.goods.planks).toBeUndefined();
    expect(res.consumedStockpile).toEqual({});
    expect(res.consumedWallet).toEqual({});
    expect(res.tile.lastCollect).toBe(0);
  });

  it('a bakery nets the flour cost out of its minted coins', () => {
    const t = tile({ buildingId: 'bakery', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 0 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stock({ flour: 100 }),
      0
    );
    // cap 480 → 40 runs × 12 = 480 coins; priceFor(100, flour) === 5, cost 5×40 = 200.
    expect(res.consumedStockpile).toEqual({ flour: 40 });
    expect(res.stocked).toEqual({});
    expect(res.gained.coins).toBe(280);
    expect(res.player.coins).toBe(280);
    expect(res.player.lifetimeEarned).toBe(280);
    // The bakery sells nothing into the stockpile — no harvest units counted.
    expect(res.player.soldUnits).toBe(0);
  });

  it('grinds the owner wallet wheat FREE, charging no coins (the reported bug fix)', () => {
    const t = tile({ buildingId: 'windmill', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({
        coins: 500,
        wallet: { wheat: 100, logs: 0, stone: 0, flour: 0, planks: 0, bricks: 0 },
      }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      emptyStockpile(), // stockpile EMPTY — only the owner's wallet feeds the mill
      0
    );
    // cap 45 flour → 90 wheat, all pulled FREE from the wallet.
    expect(res.gained.goods.flour).toBe(45);
    expect(res.consumedWallet).toEqual({ wheat: 90 });
    expect(res.consumedStockpile).toEqual({});
    expect(res.player.wallet.wheat).toBe(10);
    expect(res.player.wallet.flour).toBe(45);
    // No coins charged — the grain was the owner's own.
    expect(res.player.coins).toBe(500);
  });

  it('splits wallet-first then buys the rest, charging only the stockpile part', () => {
    const t = tile({ buildingId: 'windmill', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({
        coins: 1000,
        wallet: { wheat: 10, logs: 0, stone: 0, flour: 0, planks: 0, bricks: 0 },
      }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stock({ wheat: 100 }),
      0
    );
    // 45 runs → 90 wheat: 10 free from wallet, 80 bought from the stockpile.
    expect(res.gained.goods.flour).toBe(45);
    expect(res.consumedWallet).toEqual({ wheat: 10 });
    expect(res.consumedStockpile).toEqual({ wheat: 80 });
    // priceFor(100, wheat) === 3; only the 80 stockpile units cost coins: 3×80 = 240.
    expect(res.player.coins).toBe(1000 - 240);
    expect(res.player.wallet.wheat).toBe(0);
  });

  it('bakery mints the full 12c/flour when the flour comes free from the wallet', () => {
    const t = tile({ buildingId: 'bakery', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({
        coins: 0,
        wallet: { wheat: 0, logs: 0, stone: 0, flour: 100, planks: 0, bricks: 0 },
      }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      emptyStockpile(),
      0
    );
    // cap 480 → 40 runs × 12 = 480 coins; flour all from the wallet → nothing bought.
    expect(res.consumedWallet).toEqual({ flour: 40 });
    expect(res.consumedStockpile).toEqual({});
    expect(res.gained.coins).toBe(480);
    expect(res.player.coins).toBe(480);
    expect(res.player.wallet.flour).toBe(60);
    expect(res.player.lifetimeEarned).toBe(480);
  });
});

describe('manual selling loop (P1) — collect to wallet, sell to refill stockpile', () => {
  it('collects wheat to the wallet, then a sell refills the stockpile a processor draws from', () => {
    // 1) Harvest a wheat field into the wallet — no coins, no stockpile change.
    const field = tile({ buildingId: 'wheatfield', lastCollect: 0, readyAt: 0 });
    const emptyStock = emptyStockpile();
    const collected = applyCollect(
      field,
      player({ coins: 100, soldUnits: 0, lifetimeEarned: 0 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      emptyStock,
      0
    );
    expect(collected.gained.goods.wheat).toBe(90);
    expect(collected.gained.coins).toBe(0);
    expect(collected.player.wallet.wheat).toBe(90);
    expect(collected.player.soldUnits).toBe(0);
    expect(emptyStock.wheat).toBe(0); // collect never touches the stockpile

    // 2) Manually sell 50 wheat into the (empty) stockpile — the doSell maths.
    const held = collected.player.wallet.wheat;
    const sellAmt = 50;
    const coins = sellValue(sellAmt, 0, 'wheat');
    expect(coins).toBeGreaterThan(0);
    const afterSell: PlayerState = {
      ...collected.player,
      coins: collected.player.coins + coins,
      wallet: { ...collected.player.wallet, wheat: held - sellAmt },
      lifetimeEarned: collected.player.lifetimeEarned + coins,
      soldUnits: collected.player.soldUnits + sellAmt,
    };
    const stockAfter = { ...emptyStock, wheat: sellAmt };
    expect(afterSell.wallet.wheat).toBe(40);
    expect(afterSell.soldUnits).toBe(50); // sell bumps the quest counter
    expect(afterSell.lifetimeEarned).toBe(coins); // sell income → lb:earned

    // 3) A windmill can now grind the wheat the sale put into the stockpile.
    const mill = tile({ buildingId: 'windmill', lastCollect: 0, readyAt: 0 });
    const milled = applyCollect(
      mill,
      player({ coins: 1000 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stockAfter,
      0
    );
    // 50 wheat / 2 per run = 25 flour runs (capped below the tier cap of 45).
    expect(milled.consumedStockpile).toEqual({ wheat: 50 });
    expect(milled.gained.goods.flour).toBe(25);
    expect(milled.player.wallet.flour).toBe(25);
  });
});

describe('applyHallBuff', () => {
  it('is a no-op at Hall level 0 with no house aura', () => {
    const g = { coins: 100, xp: 5, goods: { wheat: 10 } };
    expect(applyHallBuff(g, 0, 0, false)).toEqual(g);
  });

  it('adds +3% per Hall level, floored, and never buffs xp', () => {
    const g = { coins: 100, xp: 5, goods: { wheat: 10 } };
    const out = applyHallBuff(g, 3, 0, false); // ×1.09
    expect(out.coins).toBe(109);
    expect(out.goods.wheat).toBe(10); // 10.9 → 10
    expect(out.xp).toBe(5);
  });

  it('caps the Hall multiplier at +15% (5 levels)', () => {
    const g = { coins: 100, xp: 0, goods: {} };
    expect(applyHallBuff(g, 5, 0, false).coins).toBe(115);
    expect(applyHallBuff(g, 10, 0, false).coins).toBe(115);
  });

  it("adds the owner's house aura (+2%/tier) to non-house buildings", () => {
    const g = { coins: 100, xp: 0, goods: {} };
    // Hall 0, house tier 3 → +6%.
    expect(applyHallBuff(g, 0, 3, false).coins).toBe(106);
    // The house itself is excluded from its own aura.
    expect(applyHallBuff(g, 0, 3, true).coins).toBe(100);
  });

  it('sums the Hall and house percentages exactly (single integer numerator)', () => {
    const g = { coins: 100, xp: 0, goods: { wheat: 10 } };
    // +9% (Hall 3) + 4% (house tier 2) = +13% → 113; wheat floor(11.3) = 11.
    const out = applyHallBuff(g, 3, 2, false);
    expect(out.coins).toBe(113);
    expect(out.goods.wheat).toBe(11);
  });
});

describe('affordableRuns', () => {
  it('caps runs by the budget', () => {
    expect(affordableRuns(1000, 3, 2, 45)).toBe(45); // floor(1000/6)=166
    expect(affordableRuns(10, 3, 2, 45)).toBe(1); // floor(10/6)=1
    expect(affordableRuns(5, 3, 2, 45)).toBe(0); // floor(5/6)=0
  });

  it('allows all runs for a free recipe', () => {
    expect(affordableRuns(0, 0, 2, 9)).toBe(9);
    expect(affordableRuns(0, 3, 0, 9)).toBe(9);
  });

  it('keeps wallet-funded runs affordable even with zero coins (wallet-first)', () => {
    // 6 free wallet units, per 2, 0 coins → 3 free runs are still affordable.
    expect(affordableRuns(0, 3, 2, 45, 6)).toBe(3);
    // Coins extend beyond the free runs: 6 free units + floor(10/3)=3 paid units
    // → floor(9/2)=4 runs affordable.
    expect(affordableRuns(10, 3, 2, 45, 6)).toBe(4);
  });
});

describe('applyKeepContribution', () => {
  const costs = KEEP_STAGE_COSTS; // [(30,15),(60,40),...]

  it('fills only the contributed good, recording a split for the current level', () => {
    const res = applyKeepContribution(city(), 'planks', 20, costs);
    expect(res.applied).toBe(20);
    expect(res.refunded).toBe(0);
    expect(res.stagePlanks).toBe(20);
    expect(res.stageBricks).toBe(0);
    expect(res.splits).toEqual([{ stage: 0, amount: 20 }]);
  });

  it('caps at the current level need and refunds the excess (no carry to next level)', () => {
    // 50 planks: 30 fills the level-0 planks requirement; the other 20 cannot
    // pre-pay a future level and are refunded.
    const res = applyKeepContribution(city(), 'planks', 50, costs);
    expect(res.applied).toBe(30);
    expect(res.refunded).toBe(20);
    expect(res.stagePlanks).toBe(30);
  });

  it('fills a good to its requirement without itself advancing the level', () => {
    // Resources completing does NOT level up on its own — tryHallLevelUp does,
    // and only when the population threshold is also met.
    const res = applyKeepContribution(
      city({ hallLevel: 0, stagePlanks: 30, stageBricks: 0 }),
      'bricks',
      15,
      costs
    );
    expect(res.applied).toBe(15);
    expect(res.stagePlanks).toBe(30);
    expect(res.stageBricks).toBe(15);
    expect(res.splits).toEqual([{ stage: 0, amount: 15 }]);
  });

  it('refunds beyond an almost-full requirement', () => {
    // Bricks at 14/15: only 1 more is needed, the other 99 are refunded.
    const res = applyKeepContribution(
      city({ hallLevel: 0, stagePlanks: 30, stageBricks: 14 }),
      'bricks',
      100,
      costs
    );
    expect(res.applied).toBe(1);
    expect(res.refunded).toBe(99);
    expect(res.stageBricks).toBe(15);
    expect(res.stagePlanks).toBe(30);
    expect(res.splits).toEqual([{ stage: 0, amount: 1 }]);
  });

  it('reports the Village Hall complete once every level is built', () => {
    expect(landmarkComplete(city({ hallLevel: KEEP_STAGE_COSTS.length }))).toBe(true);
    expect(landmarkComplete(city({ hallLevel: 4 }))).toBe(false);
  });
});

describe('tryHallLevelUp (resources AND population gate)', () => {
  const costs = KEEP_STAGE_COSTS; // level 0 needs planks 30, bricks 15; pop 2.

  it('does not level up when resources are met but population is short', () => {
    const c = city({ hallLevel: 0, stagePlanks: 30, stageBricks: 15 });
    const res = tryHallLevelUp(c, 1, costs); // HALL_POPULATION[0] = 2
    expect(res.hallLevel).toBe(0);
    expect(res.leveled).toEqual([]);
    expect(res.stagePlanks).toBe(30);
    expect(res.stageBricks).toBe(15);
  });

  it('does not level up when population is met but resources are short', () => {
    const c = city({ hallLevel: 0, stagePlanks: 10, stageBricks: 5 });
    const res = tryHallLevelUp(c, 5, costs);
    expect(res.hallLevel).toBe(0);
    expect(res.leveled).toEqual([]);
  });

  it('levels up and resets resources when BOTH gates are met', () => {
    const c = city({ hallLevel: 0, stagePlanks: 30, stageBricks: 15 });
    const res = tryHallLevelUp(c, 2, costs);
    expect(res.hallLevel).toBe(1);
    expect(res.leveled).toEqual([1]);
    expect(res.stagePlanks).toBe(0);
    expect(res.stageBricks).toBe(0);
  });

  it('gains at most one level per call (resources reset each level)', () => {
    // Even with a huge population, only the current level is funded.
    const c = city({ hallLevel: 0, stagePlanks: 30, stageBricks: 15 });
    const res = tryHallLevelUp(c, 99, costs);
    expect(res.hallLevel).toBe(1);
    expect(res.leveled).toEqual([1]);
  });
});

describe('stage payout (pro-rata)', () => {
  it('scales the pot by the stage number', () => {
    expect(stagePot(0)).toBe(400);
    expect(stagePot(1)).toBe(800);
    expect(stagePot(4)).toBe(2000);
  });

  it('splits the pot by contributed units', () => {
    expect(proRataPayout(400, 10, 40)).toBe(100);
    expect(proRataPayout(800, 30, 40)).toBe(600);
  });

  it('floors small shares to the minimum payout', () => {
    expect(proRataPayout(400, 1, 1000)).toBe(25);
  });

  it('pays a non-contributor nothing', () => {
    expect(proRataPayout(400, 0, 40)).toBe(0);
    expect(proRataPayout(400, 10, 0)).toBe(0);
  });
});

describe('expansion claim gating', () => {
  it('allows a tile inside the current ring', () => {
    // Hall level 0 → ring [3,14] (a bigger 12×12 starting playfield).
    expect(expansionGate(3, 3, 0)).toBeNull();
    expect(expansionGate(14, 14, 0)).toBeNull();
  });

  it('rejects a locked outer tile with the Village Hall nudge', () => {
    // (2,2) is outside [3,14]; the next ring opens when the Hall levels up.
    expect(expansionGate(2, 2, 0)).toBe(
      'Upgrade the Village Hall to unlock this land.'
    );
  });

  it('opens the next ring as the Hall levels up', () => {
    // Hall level 1 → ring [2,15]; (2,2) is now unlocked, (1,1) still locked.
    expect(expansionGate(2, 2, 1)).toBeNull();
    expect(expansionGate(1, 1, 1)).not.toBeNull();
    // Hall level 2 → ring [1,16]; (1,1) unlocks.
    expect(expansionGate(1, 1, 2)).toBeNull();
  });
});

describe('stage naming', () => {
  it('joins word-list picks and rejects out-of-range indices', () => {
    expect(stageNameFromWords(0, 0)).toBe('Ancient Keep');
    expect(stageNameFromWords(999, 0)).toBeNull();
    expect(stageNameFromWords(0, 999)).toBeNull();
  });

  it('permits only the last-completed stage’s top contributor', () => {
    expect(validateNaming(0, [], 'p1', 'p1')).toBe('No stage has been completed yet.');
    expect(validateNaming(1, ['Old Keep'], 'p1', 'p1')).toBe('That stage has already been named.');
    expect(validateNaming(1, [], 'p2', 'p1')).toBe('Only the stage’s top contributor may name it.');
    expect(validateNaming(1, [], 'p1', 'p1')).toBeNull();
  });
});

describe('check-in streak', () => {
  it('rejects a second check-in on the same UTC day', () => {
    expect(canCheckIn('2026-07-07', '2026-07-07')).not.toBeNull();
  });

  it('allows a check-in on a fresh day', () => {
    expect(canCheckIn('2026-07-06', '2026-07-07')).toBeNull();
  });

  it('increments the streak when checking in on consecutive days', () => {
    expect(nextStreak('2026-07-06', 3, '2026-07-07')).toBe(4);
  });

  it('resets the streak to 1 after a gap of more than one day', () => {
    expect(nextStreak('2026-07-04', 5, '2026-07-07')).toBe(1);
  });

  it('starts a first-ever check-in at streak 1', () => {
    expect(nextStreak('', 0, '2026-07-07')).toBe(1);
  });
});

describe('check-in xp', () => {
  it('grants 50 xp per check-in', () => {
    expect(CHECKIN_XP).toBe(50);
  });

  it('a check-in that crosses a level threshold grants a plot', () => {
    // xpFor(2) = 100; a level-1 player one check-in short of it. Crediting the
    // +50 xp through the level-up helper promotes them and unlocks plot #2.
    const before = player({ level: 1, plots: 1, xp: 50 });
    const after = applyLevelUp({ ...before, xp: before.xp + CHECKIN_XP });
    expect(after.xp).toBe(100);
    expect(after.level).toBe(2);
    expect(after.plots).toBe(2);
  });
});

describe('boost validation', () => {
  const producer = (over: Partial<TileState> = {}): TileState =>
    tile({ owner: 'owner', buildingId: 'wheatfield', readyAt: 1000, ...over });

  it("rejects boosting one's own plot", () => {
    expect(validateBoost('me', producer({ owner: 'me' }), 5000, 0, 5)).not.toBeNull();
  });

  it('rejects a plot with no building', () => {
    expect(validateBoost('me', tile({ owner: 'owner', readyAt: 0 }), 5000, 0, 5)).not.toBeNull();
  });

  it('rejects a decoration (non-producer)', () => {
    expect(validateBoost('me', producer({ buildingId: 'well' }), 5000, 0, 5)).not.toBeNull();
  });

  it('rejects a building still under construction', () => {
    expect(validateBoost('me', producer({ readyAt: 10_000 }), 5000, 0, 5)).not.toBeNull();
  });

  it('rejects a tile that already has an active boost', () => {
    expect(validateBoost('me', producer({ boostUntil: 9000 }), 5000, 0, 5)).not.toBeNull();
  });

  it('rejects once the daily boost limit is reached', () => {
    expect(validateBoost('me', producer(), 5000, 5, 5)).not.toBeNull();
  });

  it('allows boosting a completed neighbour producer under the limit', () => {
    expect(validateBoost('me', producer(), 5000, 4, 5)).toBeNull();
  });

  it('honours a raised limit from the Hall boostLimit perk', () => {
    // Used 5 today: blocked at the base limit, allowed at the level-4 limit of 7.
    expect(validateBoost('me', producer(), 5000, 5, 5)).not.toBeNull();
    expect(validateBoost('me', producer(), 5000, 5, 7)).toBeNull();
  });

  it('counts boosts only for the current day (date rollover resets)', () => {
    const p = player({ boostsToday: 5, boostsDate: '2026-07-06' });
    expect(boostsUsedToday(p, '2026-07-07')).toBe(0);
    expect(boostsUsedToday(p, '2026-07-06')).toBe(5);
  });
});

describe('festival auto-rotation (ballot retired)', () => {
  it('rotates coins -> raw -> processed -> decor -> coins', () => {
    expect(nextFestival('coins')).toBe('raw');
    expect(nextFestival('raw')).toBe('processed');
    expect(nextFestival('processed')).toBe('decor');
    expect(nextFestival('decor')).toBe('coins');
  });

  it('returns to the start after a full four-day cycle', () => {
    expect(nextFestival(nextFestival(nextFestival(nextFestival('raw'))))).toBe('raw');
  });
});

describe('sharing', () => {
  it('maps levels to flair-title bands', () => {
    expect(flairTitle(1)).toBe('Settler');
    expect(flairTitle(3)).toBe('Builder');
    expect(flairTitle(6)).toBe('Architect');
    expect(flairTitle(9)).toBe('Alderman');
    expect(flairTitle(12)).toBe('Founder');
  });

  it('builds a level-up comment with the villager and their title (no emoji)', () => {
    expect(shareText('levelup', 6, 'ada', 'cozytown')).toBe(
      'u/ada just reached Level 6 in Hearthvale — Architect!'
    );
  });

  it('builds a Village Hall level comment crediting the subreddit', () => {
    expect(shareText('stage', 3, 'ada', 'cozytown')).toBe(
      'The Village Hall reached Level 3/5 — built together by the villagers of r/cozytown!'
    );
  });
});

describe('processedUnits quest counter', () => {
  const gained = (
    goods: Partial<Record<Good, number>>,
    coins = 0
  ): Gained => ({ coins, xp: 0, goods });

  it('counts wallet-bound output units for a sawmill', () => {
    // Sawmill: input logs/2 → 1 plank per run; 4 planks produced === 4 runs.
    expect(processedUnits('sawmill', gained({ planks: 4 }), { logs: 8 })).toBe(4);
  });

  it('counts wallet-bound flour units for a windmill', () => {
    // Windmill: input wheat/2 → 1 flour per run to the wallet; 4 flour === 4 runs.
    expect(processedUnits('windmill', gained({ flour: 4 }), { wheat: 8 })).toBe(4);
  });

  it('counts flour runs consumed for the bakery (output is coins)', () => {
    // Bakery: input flour/1 → coins; 5 flour consumed === 5 runs processed.
    expect(processedUnits('bakery', gained({}, 60), { flour: 5 })).toBe(5);
  });

  it('is 0 for non-processor buildings and empty tiles', () => {
    expect(processedUnits('wheatfield', gained({ wheat: 9 }), {})).toBe(0);
    expect(processedUnits('house', gained({}, 12), {})).toBe(0);
    expect(processedUnits(undefined, gained({}), {})).toBe(0);
  });
});
