import { describe, expect, it } from 'vitest';
import type { CityState, PlayerState, TileState } from '../../shared/types';
import { CATALOG } from '../../shared/catalog';
import {
  applyCollect,
  applyLevelUp,
  validateBuild,
  validateUpgrade,
} from './village';

const player = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  id: 'p1',
  name: 'Alice',
  coins: 1000,
  supplies: 0,
  xp: 0,
  level: 1,
  plots: 1,
  streak: 0,
  lastCheckIn: '',
  boostsToday: 0,
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
  festival: 'supplies',
  festivalDate: '2026-07-07',
  landmarkStage: 0,
  landmarkProgress: 0,
  totalCollected: 0,
  totalContributed: 0,
  ...overrides,
});

describe('validateBuild', () => {
  it('rejects a tile the player does not own', () => {
    const t = tile({ owner: 'someoneElse' });
    expect(validateBuild(player(), t, CATALOG.cottage)).not.toBeNull();
  });

  it('rejects a tile that already has a building', () => {
    const t = tile({ buildingId: 'cottage' });
    expect(validateBuild(player(), t, CATALOG.cottage)).not.toBeNull();
  });

  it('rejects a building locked behind a higher level', () => {
    // market unlocks at level 2; a level-1 player cannot build it.
    expect(validateBuild(player({ level: 1 }), tile(), CATALOG.market)).not.toBeNull();
  });

  it('rejects when the player cannot afford the tier-1 cost', () => {
    expect(validateBuild(player({ coins: 10 }), tile(), CATALOG.cottage)).not.toBeNull();
  });

  it('allows a valid build on an owned empty plot with funds and level', () => {
    expect(validateBuild(player({ coins: 100, level: 1 }), tile(), CATALOG.cottage)).toBeNull();
  });
});

describe('validateUpgrade', () => {
  it('rejects a tile with no building', () => {
    expect(validateUpgrade(player(), tile(), 1000)).not.toBeNull();
  });

  it('rejects while construction is still in progress', () => {
    const t = tile({ buildingId: 'cottage', readyAt: 5000 });
    expect(validateUpgrade(player(), t, 1000)).not.toBeNull();
  });

  it('rejects a tier-3 building (tier cap)', () => {
    const t = tile({ buildingId: 'cottage', tier: 3, readyAt: 0 });
    expect(validateUpgrade(player(), t, 1000)).not.toBeNull();
  });

  it('allows upgrading a completed tier-1 building the player owns', () => {
    const t = tile({ buildingId: 'cottage', tier: 1, readyAt: 0 });
    expect(validateUpgrade(player(), t, 1000)).toBeNull();
  });
});

describe('applyLevelUp', () => {
  it('promotes to level 2 at the level-2 xp threshold and keeps 1 plot', () => {
    // level-2 threshold is 150 xp; PLOT_LEVELS grants a 2nd plot only at level 3.
    const p = applyLevelUp(player({ level: 1, plots: 1, xp: 150 }));
    expect(p.level).toBe(2);
    expect(p.plots).toBe(1);
  });

  it('grants a second plot when crossing the level 2->3 boundary', () => {
    // level-3 threshold is 450 xp; plotsForLevel(3) === 2.
    const p = applyLevelUp(player({ level: 2, plots: 1, xp: 450 }));
    expect(p.level).toBe(3);
    expect(p.plots).toBe(2);
  });

  it('leaves the player unchanged when no level is gained', () => {
    const p = applyLevelUp(player({ level: 1, plots: 1, xp: 10 }));
    expect(p.level).toBe(1);
    expect(p.plots).toBe(1);
  });
});

describe('applyCollect', () => {
  it('credits a normal gain and advances lastCollect', () => {
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0 });
    const now = 60_000;
    const res = applyCollect(t, player({ coins: 0 }), city(), now, 0);
    expect(res.gained).toEqual({ coins: 3, supplies: 0, xp: 1 });
    expect(res.player.coins).toBe(3);
    expect(res.player.xp).toBe(1);
    expect(res.tile.lastCollect).toBe(now);
  });

  it('preserves fractional progress on a zero gain (lastCollect NOT advanced)', () => {
    // 1 second of a 3/min cottage floors to 0 coins.
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0 });
    const now = 1000;
    const res = applyCollect(t, player({ coins: 0 }), city(), now, 0);
    expect(res.gained).toEqual({ coins: 0, supplies: 0, xp: 0 });
    expect(res.player.coins).toBe(0);
    expect(res.tile.lastCollect).toBe(0);
  });

  it('clears an expired boost after a producing collect', () => {
    const t = tile({
      buildingId: 'cottage',
      lastCollect: 0,
      readyAt: 0,
      boostUntil: 30_000,
      boostBy: 'bob',
    });
    const res = applyCollect(t, player({ coins: 0 }), city(), 120_000, 0);
    expect(res.gained.coins).toBeGreaterThan(0);
    expect(res.tile.boostUntil).toBe(0);
    expect(res.tile.boostBy).toBeUndefined();
  });

  it('keeps an unexpired boost after collecting', () => {
    const t = tile({
      buildingId: 'cottage',
      lastCollect: 0,
      readyAt: 0,
      boostUntil: 300_000,
      boostBy: 'bob',
    });
    const res = applyCollect(t, player({ coins: 0 }), city(), 120_000, 0);
    expect(res.tile.boostUntil).toBe(300_000);
    expect(res.tile.boostBy).toBe('bob');
  });

  it('clamps to the tier cap on a long absence', () => {
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(t, player({ coins: 0 }), city(), 1_000_000_000, 0);
    // cottage tier-1 cap is 90 coins.
    expect(res.gained.coins).toBe(90);
    expect(res.player.coins).toBe(90);
  });

  it('grants a level-up (and plots) when the collected xp crosses a threshold', () => {
    // Big supplies haul yields xp === supplies; garden tier-1 cap is 60.
    const t = tile({ buildingId: 'garden', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 0, supplies: 0, xp: 440, level: 2, plots: 1 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0
    );
    // 440 + 60 = 500 xp >= 450 (level-3 threshold) -> level 3, plots 2.
    expect(res.player.xp).toBe(500);
    expect(res.player.level).toBe(3);
    expect(res.player.plots).toBe(2);
  });
});
