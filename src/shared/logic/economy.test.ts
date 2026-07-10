import { describe, expect, it } from 'vitest';
import type { PlayerState, Stockpile, TileState } from '../types';
import { CATALOG, investedCost } from '../catalog';
import {
  GOLDEN_CYCLE_MS,
  GOLDEN_GRACE_MS,
  GOLDEN_MULTIPLIER,
  GOLDEN_WINDOW_MS,
  accrue,
  adjacencyBonus,
  canClaim,
  emptyStockpile,
  goodsTotal,
  houseTile,
  isAutoSold,
  isGoldenWindow,
  isGoldenWindowLenient,
  levelForXp,
  nearHouse,
  plotsAllowed,
  plotsForLevel,
  streakReward,
  xpFor,
} from './economy';

const player = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  id: 'p1',
  name: 'Alice',
  coins: 0,
  wallet: { wheat: 0, logs: 0, stone: 0, flour: 0, planks: 0, bricks: 0 },
  xp: 0,
  level: 1,
  plots: 1,
  streak: 0,
  lastCheckIn: '2026-07-01',
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

const stocked = (over: Partial<Stockpile> = {}): Stockpile => ({
  ...emptyStockpile(),
  ...over,
});

describe('xpFor', () => {
  it('computes 50*L*(L-1)', () => {
    expect(xpFor(2)).toBe(100);
    expect(xpFor(3)).toBe(300);
    expect(xpFor(4)).toBe(600);
  });
});

describe('levelForXp', () => {
  it('is level 1 with zero xp', () => {
    expect(levelForXp(0)).toBe(1);
  });
  it('reaches level 2 at exactly the level-2 threshold', () => {
    expect(levelForXp(100)).toBe(2);
  });
  it('stays at level 2 just below the level-3 threshold', () => {
    expect(levelForXp(299)).toBe(2);
  });
  it('caps at MAX_LEVEL (15)', () => {
    expect(levelForXp(1_000_000_000)).toBe(15);
  });
});

describe('plotsForLevel', () => {
  it('counts PLOT_LEVELS entries at or below the given level', () => {
    expect(plotsForLevel(1)).toBe(1);
    // Second plot now arrives at level 2 (PLOT_LEVELS = [1,2,4,7,10]).
    expect(plotsForLevel(2)).toBe(2);
    expect(plotsForLevel(3)).toBe(2);
    expect(plotsForLevel(4)).toBe(3);
    expect(plotsForLevel(7)).toBe(4);
    expect(plotsForLevel(12)).toBe(5);
  });
});

describe('investedCost', () => {
  it('sums tier costs from 1 up to the given tier', () => {
    // house base cost 60: 60, round(60×2.5)=150, round(60×6)=360.
    expect(investedCost(CATALOG.house, 1)).toBe(60);
    expect(investedCost(CATALOG.house, 2)).toBe(210);
    expect(investedCost(CATALOG.house, 3)).toBe(570);
  });
});

describe('streakReward', () => {
  it('is 25 x min(streak, 7)', () => {
    expect(streakReward(1)).toBe(25);
    expect(streakReward(7)).toBe(175);
    expect(streakReward(10)).toBe(175);
  });
});

describe('accrue — coins buildings', () => {
  it('yields 1 coin for a fresh tier-1 house after 60s', () => {
    const t = tile({ buildingId: 'house' });
    const { gained, consumed } = accrue(t, 60_000, 'raw', 0, 'clear', emptyStockpile());
    // house rate 1/min: 1 coin, xp = ceil(1/10) = 1.
    expect(gained).toEqual({ coins: 1, xp: 1, goods: {} });
    expect(consumed).toEqual({});
  });

  it('clamps to the tier cap after a long absence', () => {
    const t = tile({ buildingId: 'house' });
    const { gained } = accrue(t, 1_000_000_000, 'raw', 0, 'clear', emptyStockpile());
    // house cap 60 coins, xp = ceil(60/10) = 6.
    expect(gained).toEqual({ coins: 60, xp: 6, goods: {} });
  });

  it('yields nothing while under construction', () => {
    const t = tile({ buildingId: 'house', readyAt: 100_000 });
    const { gained } = accrue(t, 50_000, 'coins', 1, 'clear', emptyStockpile());
    expect(gained).toEqual({ coins: 0, xp: 0, goods: {} });
  });

  it('doubles only the portion inside the boost window', () => {
    // 2 min elapsed, first 1 min boosted -> 3 rate-minutes * 1/min = 3 coins.
    const t = tile({ buildingId: 'house', boostUntil: 60_000 });
    const { gained } = accrue(t, 120_000, 'raw', 0, 'clear', emptyStockpile());
    expect(gained.coins).toBe(3);
  });

  it('multiplies by 1.5 when the festival matches the role', () => {
    const t = tile({ buildingId: 'house' });
    // 4 min * 1/min = 4, x1.5 = 6.
    const { gained } = accrue(t, 240_000, 'coins', 0, 'clear', emptyStockpile());
    expect(gained.coins).toBe(6);
  });

  it('multiplies by (1 + adjacency bonus)', () => {
    const t = tile({ buildingId: 'house' });
    // 4 min * 1/min = 4, x1.5 (adjacency) = 6.
    const { gained } = accrue(t, 240_000, 'raw', 0.5, 'clear', emptyStockpile());
    expect(gained.coins).toBe(6);
  });
});

describe('accrue — raw producers', () => {
  it('produces its good into gained.goods with matching xp', () => {
    const t = tile({ buildingId: 'wheatfield' });
    const { gained, consumed } = accrue(t, 60_000, 'coins', 0, 'clear', emptyStockpile());
    // 3 wheat/min * 1 min = 3.
    expect(gained).toEqual({ coins: 0, xp: 3, goods: { wheat: 3 } });
    expect(consumed).toEqual({});
  });
});

describe('accrue — processors (stockpile-limited)', () => {
  it('starves to the stockpile: potential 5, 6 wheat, per 2 -> 3 flour, 6 consumed', () => {
    // windmill 1.5 flour/min; 200s -> potential 5 runs.
    const t = tile({ buildingId: 'windmill' });
    const now = 200_000;
    const { gained, consumed } = accrue(t, now, 'coins', 0, 'clear', stocked({ wheat: 6 }));
    expect(gained).toEqual({ coins: 0, xp: 3, goods: { flour: 3 } });
    expect(consumed).toEqual({ wheat: 6 });
  });

  it('runs to potential when the stockpile is ample', () => {
    const t = tile({ buildingId: 'windmill' });
    const { gained, consumed } = accrue(t, 200_000, 'coins', 0, 'clear', stocked({ wheat: 100 }));
    expect(gained.goods).toEqual({ flour: 5 });
    expect(consumed).toEqual({ wheat: 10 });
  });

  it('bakery mints 12 coins per flour consumed', () => {
    // bakery 1 run/min; 120s -> 2 runs; 10 flour available.
    const t = tile({ buildingId: 'bakery' });
    const { gained, consumed } = accrue(t, 120_000, 'coins', 0, 'clear', stocked({ flour: 10 }));
    expect(gained).toEqual({ coins: 24, xp: 3, goods: {} });
    expect(consumed).toEqual({ flour: 2 });
  });

  it('bakery caps output at 480 coins (40 flour) on a long absence', () => {
    const t = tile({ buildingId: 'bakery' });
    const { gained, consumed } = accrue(t, 1_000_000_000, 'coins', 0, 'clear', stocked({ flour: 1000 }));
    expect(gained.coins).toBe(480);
    expect(consumed).toEqual({ flour: 40 });
  });
});

describe('accrue — weather', () => {
  it('harvest moon x1.5 lifts every producer', () => {
    const t = tile({ buildingId: 'wheatfield' });
    // 2 min * 3 = 6, x1.5 = 9.
    const { gained } = accrue(t, 120_000, 'coins', 0, 'harvestmoon', emptyStockpile());
    expect(gained.goods).toEqual({ wheat: 9 });
  });

  it('rain x1.3 only wheat/logs producers', () => {
    const wheat = tile({ buildingId: 'wheatfield' });
    // 2 min * 3 = 6, x1.3 = 7.8 -> 7.
    expect(accrue(wheat, 120_000, 'coins', 0, 'rain', emptyStockpile()).gained.goods).toEqual({ wheat: 7 });
    const stone = tile({ buildingId: 'quarry' });
    // quarry (stone) unaffected by rain: 2 min * 2 = 4.
    expect(accrue(stone, 120_000, 'coins', 0, 'rain', emptyStockpile()).gained.goods).toEqual({ stone: 4 });
  });

  it('sunny x1.1 all producers', () => {
    const t = tile({ buildingId: 'house' });
    // 10 min * 1 = 10, x1.1 = 11.
    const { gained } = accrue(t, 600_000, 'raw', 0, 'sunny', emptyStockpile());
    expect(gained.coins).toBe(11);
  });
});

describe('accrue — decor', () => {
  it('yields nothing for decor buildings', () => {
    const t = tile({ buildingId: 'well' });
    const { gained } = accrue(t, 1_000_000, 'decor', 0.6, 'harvestmoon', emptyStockpile());
    expect(gained).toEqual({ coins: 0, xp: 0, goods: {} });
  });
});

describe('goodsTotal', () => {
  it('sums good quantities', () => {
    expect(goodsTotal({ wheat: 3, flour: 2 })).toBe(5);
    expect(goodsTotal({})).toBe(0);
  });
});

describe('isAutoSold', () => {
  it('auto-sells the raw harvests and flour, never the Hall material', () => {
    expect(isAutoSold('wheat')).toBe(true);
    expect(isAutoSold('logs')).toBe(true);
    expect(isAutoSold('stone')).toBe(true);
    expect(isAutoSold('flour')).toBe(true);
    expect(isAutoSold('planks')).toBe(false);
    expect(isAutoSold('bricks')).toBe(false);
  });
});

describe('adjacencyBonus', () => {
  it('sums 0.1 x tier for adjacent completed decor', () => {
    const grid: Record<string, TileState> = {
      '1,2': tile({ buildingId: 'well', tier: 1, readyAt: 0 }),
      '3,2': tile({ buildingId: 'trees', tier: 1, readyAt: 0 }),
    };
    expect(adjacencyBonus(grid, 2, 2, 'coins', 1000)).toBeCloseTo(0.2);
  });

  it('caps the decor sum at 0.6 and doubles it on a decor festival, capped overall at 1.0', () => {
    const grid: Record<string, TileState> = {
      '1,2': tile({ buildingId: 'well', tier: 3, readyAt: 0 }),
      '3,2': tile({ buildingId: 'well', tier: 3, readyAt: 0 }),
      '2,1': tile({ buildingId: 'well', tier: 3, readyAt: 0 }),
      '2,3': tile({ buildingId: 'well', tier: 3, readyAt: 0 }),
      '2,2': tile({ buildingId: 'house', readyAt: 0 }),
    };
    expect(adjacencyBonus(grid, 2, 2, 'coins', 1000)).toBeCloseTo(0.6);
    // 0.6 * 2 = 1.2 -> overall cap 1.0.
    expect(adjacencyBonus(grid, 2, 2, 'decor', 1000)).toBeCloseTo(1.0);
  });

  it('adds +0.25 per matching chain pair (wheatfield<->windmill)', () => {
    const grid: Record<string, TileState> = {
      '5,5': tile({ buildingId: 'wheatfield', readyAt: 0 }),
      '4,5': tile({ buildingId: 'windmill', readyAt: 0 }),
      '6,5': tile({ buildingId: 'well', tier: 1, readyAt: 0 }),
    };
    // chain 0.25 + decor 0.1 = 0.35.
    expect(adjacencyBonus(grid, 5, 5, 'coins', 1000)).toBeCloseTo(0.35);
  });

  it('adds +0.5 to a river-adjacent raw producer and caps the total at 1.0', () => {
    // (3,6) neighbours (2,6) which is a river tile.
    const grid: Record<string, TileState> = {
      '3,6': tile({ buildingId: 'wheatfield', readyAt: 0 }),
      '4,6': tile({ buildingId: 'windmill', readyAt: 0 }),
      '3,5': tile({ buildingId: 'well', tier: 3, readyAt: 0 }),
      '3,7': tile({ buildingId: 'trees', tier: 1, readyAt: 0 }),
    };
    // river 0.5 + chain 0.25 + decor (0.3 + 0.1 = 0.4) = 1.15 -> cap 1.0.
    expect(adjacencyBonus(grid, 3, 6, 'coins', 1000)).toBeCloseTo(1.0);
  });

  it('ignores river adjacency for a non-raw building', () => {
    const grid: Record<string, TileState> = {
      '3,6': tile({ buildingId: 'windmill', readyAt: 0 }),
    };
    expect(adjacencyBonus(grid, 3, 6, 'coins', 1000)).toBe(0);
  });

  it('ignores decor neighbours still under construction', () => {
    const grid: Record<string, TileState> = {
      '1,2': tile({ buildingId: 'well', tier: 1, readyAt: 5000 }),
    };
    expect(adjacencyBonus(grid, 2, 2, 'coins', 1000)).toBe(0);
  });
});

describe('plotsAllowed', () => {
  it('is the level plots plus the Hall level-3 bonus plot', () => {
    expect(plotsAllowed(1, 0)).toBe(1);
    expect(plotsAllowed(1, 3)).toBe(2);
    expect(plotsAllowed(4, 2)).toBe(3);
    expect(plotsAllowed(4, 3)).toBe(4);
  });
});

describe('houseTile / nearHouse', () => {
  const withHouse = (): Record<string, TileState> => ({
    '5,5': tile({ owner: 'p1', buildingId: 'house' }),
    '9,9': tile({ owner: 'p2', buildingId: 'house' }),
  });

  it('finds the owner house tile, null when unsettled', () => {
    expect(houseTile(withHouse(), 'p1')).toEqual({ x: 5, y: 5 });
    expect(houseTile(withHouse(), 'nobody')).toBeNull();
  });

  it('accepts tiles within Chebyshev 2 of the house', () => {
    const g = withHouse();
    expect(nearHouse(g, 'p1', 7, 7)).toBe(true); // diagonal distance 2
    expect(nearHouse(g, 'p1', 3, 5)).toBe(true); // distance 2 on x
    expect(nearHouse(g, 'p1', 5, 5)).toBe(true); // the house tile itself
  });

  it('rejects tiles more than 2 away, and any tile when unsettled', () => {
    const g = withHouse();
    expect(nearHouse(g, 'p1', 8, 5)).toBe(false); // distance 3
    expect(nearHouse(g, 'p1', 8, 8)).toBe(false);
    expect(nearHouse(g, 'nobody', 5, 5)).toBe(false);
  });
});

describe('canClaim', () => {
  it('rejects a plaza tile', () => {
    expect(canClaim({}, 8, 8, player(), 0, 0)).not.toBeNull();
  });
  it('rejects an already-occupied tile', () => {
    expect(canClaim({ '5,5': tile({ owner: 'other' }) }, 5, 5, player(), 0, 0)).not.toBeNull();
  });
  it('rejects when at the plot limit', () => {
    expect(canClaim({}, 0, 0, player({ level: 1 }), 1, 0)).not.toBeNull();
  });
  it('allows the first claim anywhere in the ring', () => {
    // owned 0: the homestead-radius rule does not apply to the first claim.
    expect(canClaim({}, 0, 0, player({ level: 1 }), 0, 0)).toBeNull();
  });
  it('rejects a river tile', () => {
    expect(canClaim({}, 1, 4, player({ level: 1 }), 0, 0)).not.toBeNull();
  });
  it('rejects a later claim far from the house, allows one within 2 tiles', () => {
    const grid: Record<string, TileState> = {
      '5,5': tile({ owner: 'p1', buildingId: 'house' }),
    };
    const p = player({ level: 2 });
    // (5,11) is inside the ring but 6 tiles from the house; (6,6) is 1 tile away.
    expect(canClaim(grid, 5, 11, p, 1, 0)).toBe(
      'Build closer to your house (within 2 tiles).'
    );
    expect(canClaim(grid, 6, 6, p, 1, 0)).toBeNull();
  });
});

describe('Perfect Harvest golden window (S2)', () => {
  it('is deterministic — the same (key, now) always yields the same verdict', () => {
    const now = 1_700_000_000_000;
    expect(isGoldenWindow('3,4', now)).toBe(isGoldenWindow('3,4', now));
    expect(isGoldenWindowLenient('3,4', now)).toBe(isGoldenWindowLenient('3,4', now));
  });

  it('gives different tiles different phase offsets (windows are spread out)', () => {
    // Scan one cycle at fine resolution: the first golden instant differs by tile.
    const firstGolden = (key: string): number => {
      for (let t = 0; t < GOLDEN_CYCLE_MS; t += 20) {
        if (isGoldenWindow(key, t)) return t;
      }
      return -1;
    };
    const starts = new Set(
      ['0,0', '1,0', '2,0', '0,1', '5,7', '9,9', '3,4', '8,2'].map(firstGolden)
    );
    // At least several distinct start instants — not all tiles flash together.
    expect(starts.size).toBeGreaterThan(3);
  });

  it('has a window duty cycle of roughly WINDOW/CYCLE over a full period', () => {
    const key = '3,4';
    let hits = 0;
    const step = 1;
    for (let t = 0; t < GOLDEN_CYCLE_MS; t += step) {
      if (isGoldenWindow(key, t)) hits += 1;
    }
    const fraction = (hits * step) / GOLDEN_CYCLE_MS;
    expect(fraction).toBeCloseTo(GOLDEN_WINDOW_MS / GOLDEN_CYCLE_MS, 2);
  });

  it('lenient is a strict superset of the strict window', () => {
    const key = '7,1';
    for (let t = 0; t < GOLDEN_CYCLE_MS; t += 1) {
      if (isGoldenWindow(key, t)) expect(isGoldenWindowLenient(key, t)).toBe(true);
    }
  });

  it('lenient accepts the grace margin just after the strict window closes', () => {
    // Find the strict window start, then probe just past its end.
    const key = '2,6';
    let start = -1;
    for (let t = 0; t < GOLDEN_CYCLE_MS; t += 1) {
      if (isGoldenWindow(key, t)) {
        start = t;
        break;
      }
    }
    expect(start).toBeGreaterThanOrEqual(0);
    const justAfter = start + GOLDEN_WINDOW_MS + Math.floor(GOLDEN_GRACE_MS / 2);
    expect(isGoldenWindow(key, justAfter)).toBe(false);
    expect(isGoldenWindowLenient(key, justAfter)).toBe(true);
    // Well beyond the grace margin: neither strict nor lenient.
    const wayAfter = start + GOLDEN_WINDOW_MS + GOLDEN_GRACE_MS + 100;
    expect(isGoldenWindowLenient(key, wayAfter)).toBe(false);
  });

  it('GOLDEN_MULTIPLIER doubles', () => {
    expect(GOLDEN_MULTIPLIER).toBe(2);
  });
});
