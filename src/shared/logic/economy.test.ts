import { describe, expect, it } from 'vitest';
import type { PlayerState, TileState } from '../types';
import {
  accrue,
  adjacencyBonus,
  canClaim,
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

  it('caps at MAX_LEVEL (15) no matter how much xp is given', () => {
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

describe('accrue', () => {
  it('yields 3 coins for a fresh tier-1 cottage after 60s', () => {
    const t = tile({ buildingId: 'cottage' });
    const gained = accrue(t, 60_000, 'supplies', 0);
    expect(gained).toEqual({ coins: 3, supplies: 0, xp: 1 });
  });

  it('clamps to the tier cap after a long absence', () => {
    const t = tile({ buildingId: 'cottage' });
    const gained = accrue(t, 1_000_000_000, 'supplies', 0);
    expect(gained).toEqual({ coins: 90, supplies: 0, xp: 9 });
  });

  it('yields nothing while the building is under construction', () => {
    const t = tile({ buildingId: 'cottage', readyAt: 100_000 });
    const gained = accrue(t, 50_000, 'coins', 1);
    expect(gained).toEqual({ coins: 0, supplies: 0, xp: 0 });
  });

  it('doubles only the portion of elapsed time inside the boost window', () => {
    // 2 minutes elapsed, but only the first 1 minute is boosted:
    // effective = 1min*2 + 1min*1 = 3 "rate minutes" of accrual.
    const t = tile({ buildingId: 'cottage', boostUntil: 60_000 });
    const gained = accrue(t, 120_000, 'supplies', 0);
    expect(gained).toEqual({ coins: 9, supplies: 0, xp: 1 });
  });

  it('multiplies by 1.5 when the festival matches the building category', () => {
    const t = tile({ buildingId: 'cottage' });
    const gained = accrue(t, 120_000, 'coins', 0);
    // base = 3/min * 2min = 6, x1.5 = 9
    expect(gained).toEqual({ coins: 9, supplies: 0, xp: 1 });
  });

  it('multiplies by (1 + adjacentDecorBonus)', () => {
    const t = tile({ buildingId: 'bakery' });
    const gained = accrue(t, 60_000, 'decor', 0.5);
    // base = 6/min * 1min = 6, x1.5 (adjacency) = 9
    expect(gained).toEqual({ coins: 9, supplies: 0, xp: 1 });
  });

  it('yields nothing for decor buildings regardless of other inputs', () => {
    const t = tile({ buildingId: 'lantern', readyAt: 0 });
    const gained = accrue(t, 1_000_000, 'decor', 0.6);
    expect(gained).toEqual({ coins: 0, supplies: 0, xp: 0 });
  });

  it('yields supplies (and equal xp) for a supplies building', () => {
    const t = tile({ buildingId: 'garden' });
    const gained = accrue(t, 60_000, 'coins', 0);
    expect(gained).toEqual({ coins: 0, supplies: 2, xp: 2 });
  });
});

describe('adjacencyBonus', () => {
  it('sums 0.1 x tier for each adjacent completed decor building', () => {
    const grid: Record<string, TileState> = {
      '1,2': tile({ buildingId: 'lantern', tier: 1, readyAt: 0 }),
      '3,2': tile({ buildingId: 'lantern', tier: 1, readyAt: 0 }),
    };
    expect(adjacencyBonus(grid, 2, 2, 'coins', 1000)).toBeCloseTo(0.2);
  });

  it('caps the pre-doubling sum at 0.6', () => {
    const grid: Record<string, TileState> = {
      '1,2': tile({ buildingId: 'topiary', tier: 3, readyAt: 0 }),
      '3,2': tile({ buildingId: 'topiary', tier: 3, readyAt: 0 }),
      '2,1': tile({ buildingId: 'topiary', tier: 3, readyAt: 0 }),
      '2,3': tile({ buildingId: 'topiary', tier: 3, readyAt: 0 }),
    };
    expect(adjacencyBonus(grid, 2, 2, 'coins', 1000)).toBeCloseTo(0.6);
  });

  it('doubles the capped sum during a decor festival (max 1.2)', () => {
    const grid: Record<string, TileState> = {
      '1,2': tile({ buildingId: 'topiary', tier: 3, readyAt: 0 }),
      '3,2': tile({ buildingId: 'topiary', tier: 3, readyAt: 0 }),
      '2,1': tile({ buildingId: 'topiary', tier: 3, readyAt: 0 }),
      '2,3': tile({ buildingId: 'topiary', tier: 3, readyAt: 0 }),
    };
    expect(adjacencyBonus(grid, 2, 2, 'decor', 1000)).toBeCloseTo(1.2);
  });

  it('ignores decor neighbors that are still under construction', () => {
    const grid: Record<string, TileState> = {
      '1,2': tile({ buildingId: 'lantern', tier: 1, readyAt: 5000 }),
    };
    expect(adjacencyBonus(grid, 2, 2, 'coins', 1000)).toBe(0);
  });
});

describe('canClaim', () => {
  it('rejects a plaza tile', () => {
    const grid: Record<string, TileState> = {};
    expect(canClaim(grid, 8, 8, player(), 0)).not.toBeNull();
  });

  it('rejects an already-occupied tile', () => {
    const grid: Record<string, TileState> = {
      '5,5': tile({ owner: 'other' }),
    };
    expect(canClaim(grid, 5, 5, player(), 0)).not.toBeNull();
  });

  it('rejects when the player already owns their plot limit', () => {
    const grid: Record<string, TileState> = {};
    // level 1 => plotsForLevel(1) === 1
    expect(canClaim(grid, 0, 0, player({ level: 1 }), 1)).not.toBeNull();
  });

  it('allows claiming an empty, in-bounds, non-plaza tile within the plot limit', () => {
    const grid: Record<string, TileState> = {};
    expect(canClaim(grid, 0, 0, player({ level: 1 }), 0)).toBeNull();
  });
});
