import { describe, expect, it } from 'vitest';
import type { PlayerState, Stockpile, TileState } from '../types';
import {
  accrue,
  adjacencyBonus,
  canClaim,
  emptyStockpile,
  goodsTotal,
  levelForXp,
  plotsForLevel,
  streakReward,
  xpFor,
} from './economy';

const player = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  id: 'p1',
  name: 'Alice',
  coins: 0,
  supplies: 0,
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
  it('computes 75*L*(L-1)', () => {
    expect(xpFor(2)).toBe(150);
    expect(xpFor(3)).toBe(450);
  });
});

describe('levelForXp', () => {
  it('is level 1 with zero xp', () => {
    expect(levelForXp(0)).toBe(1);
  });
  it('reaches level 2 at exactly the level-2 threshold', () => {
    expect(levelForXp(150)).toBe(2);
  });
  it('stays at level 2 just below the level-3 threshold', () => {
    expect(levelForXp(449)).toBe(2);
  });
  it('caps at MAX_LEVEL (15)', () => {
    expect(levelForXp(1_000_000_000)).toBe(15);
  });
});

describe('plotsForLevel', () => {
  it('counts PLOT_LEVELS entries at or below the given level', () => {
    expect(plotsForLevel(1)).toBe(1);
    expect(plotsForLevel(3)).toBe(2);
    expect(plotsForLevel(12)).toBe(5);
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
  it('yields 2 coins for a fresh tier-1 cottage after 60s', () => {
    const t = tile({ buildingId: 'cottage' });
    const { gained, consumed } = accrue(t, 60_000, 'raw', 0, 'clear', emptyStockpile());
    expect(gained).toEqual({ coins: 2, xp: 1, goods: {} });
    expect(consumed).toEqual({});
  });

  it('clamps to the tier cap after a long absence', () => {
    const t = tile({ buildingId: 'cottage' });
    const { gained } = accrue(t, 1_000_000_000, 'raw', 0, 'clear', emptyStockpile());
    // cottage cap 60 coins, xp = ceil(60/10) = 6.
    expect(gained).toEqual({ coins: 60, xp: 6, goods: {} });
  });

  it('yields nothing while under construction', () => {
    const t = tile({ buildingId: 'cottage', readyAt: 100_000 });
    const { gained } = accrue(t, 50_000, 'coins', 1, 'clear', emptyStockpile());
    expect(gained).toEqual({ coins: 0, xp: 0, goods: {} });
  });

  it('doubles only the portion inside the boost window', () => {
    // 2 min elapsed, first 1 min boosted -> 3 rate-minutes * 2/min = 6 coins.
    const t = tile({ buildingId: 'cottage', boostUntil: 60_000 });
    const { gained } = accrue(t, 120_000, 'raw', 0, 'clear', emptyStockpile());
    expect(gained.coins).toBe(6);
  });

  it('multiplies by 1.5 when the festival matches the role', () => {
    const t = tile({ buildingId: 'cottage' });
    // 2 min * 2/min = 4, x1.5 = 6.
    const { gained } = accrue(t, 120_000, 'coins', 0, 'clear', emptyStockpile());
    expect(gained.coins).toBe(6);
  });

  it('multiplies by (1 + adjacency bonus)', () => {
    const t = tile({ buildingId: 'cottage' });
    // 2 min * 2/min = 4, x1.5 (adjacency) = 6.
    const { gained } = accrue(t, 120_000, 'raw', 0.5, 'clear', emptyStockpile());
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
    const t = tile({ buildingId: 'cottage' });
    // 5 min * 2 = 10, x1.1 = 11.
    const { gained } = accrue(t, 300_000, 'raw', 0, 'sunny', emptyStockpile());
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
      '2,2': tile({ buildingId: 'cottage', readyAt: 0 }),
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

describe('canClaim', () => {
  it('rejects a plaza tile', () => {
    expect(canClaim({}, 8, 8, player(), 0)).not.toBeNull();
  });
  it('rejects an already-occupied tile', () => {
    expect(canClaim({ '5,5': tile({ owner: 'other' }) }, 5, 5, player(), 0)).not.toBeNull();
  });
  it('rejects when at the plot limit', () => {
    expect(canClaim({}, 0, 0, player({ level: 1 }), 1)).not.toBeNull();
  });
  it('allows a valid claim', () => {
    expect(canClaim({}, 0, 0, player({ level: 1 }), 0)).toBeNull();
  });
});
