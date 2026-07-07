import { describe, expect, it } from 'vitest';
import type { CityState, PlayerState, TileState } from '../../shared/types';
import { CATALOG, LANDMARK_THRESHOLDS } from '../../shared/catalog';
import {
  applyCollect,
  applyContribution,
  applyLevelUp,
  boostsUsedToday,
  canCheckIn,
  computePayout,
  landmarkComplete,
  nextFestival,
  nextStreak,
  stageReward,
  tallyBallot,
  validateBoost,
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
  boostsDate: '',
  paidStage: 0,
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

describe('boost validation', () => {
  const producer = (over: Partial<TileState> = {}): TileState =>
    tile({ owner: 'owner', buildingId: 'cottage', readyAt: 1000, ...over });

  it("rejects boosting one's own plot", () => {
    const t = producer({ owner: 'me' });
    expect(validateBoost('me', t, 5000, 0)).not.toBeNull();
  });

  it('rejects a plot with no building', () => {
    const t = tile({ owner: 'owner', readyAt: 0 });
    expect(validateBoost('me', t, 5000, 0)).not.toBeNull();
  });

  it('rejects a decoration (non-producer)', () => {
    const t = producer({ buildingId: 'lantern' });
    expect(validateBoost('me', t, 5000, 0)).not.toBeNull();
  });

  it('rejects a building still under construction', () => {
    const t = producer({ readyAt: 10_000 });
    expect(validateBoost('me', t, 5000, 0)).not.toBeNull();
  });

  it('rejects a tile that already has an active boost', () => {
    const t = producer({ boostUntil: 9000 });
    expect(validateBoost('me', t, 5000, 0)).not.toBeNull();
  });

  it('rejects once the daily boost limit is reached', () => {
    const t = producer();
    expect(validateBoost('me', t, 5000, 5)).not.toBeNull();
  });

  it('allows boosting a completed neighbour producer under the limit', () => {
    const t = producer();
    expect(validateBoost('me', t, 5000, 4)).toBeNull();
  });

  it('counts boosts only for the current day (date rollover resets)', () => {
    const p = player({ boostsToday: 5, boostsDate: '2026-07-06' });
    expect(boostsUsedToday(p, '2026-07-07')).toBe(0);
    expect(boostsUsedToday(p, '2026-07-06')).toBe(5);
  });
});

describe('landmark contribution', () => {
  const t = LANDMARK_THRESHOLDS; // [300, 900, 2000, 4000, 7500]

  it('clamps the amount to the player supplies', () => {
    const res = applyContribution(city({ landmarkStage: 0 }), 10, 100, t);
    expect(res.applied).toBe(10);
    expect(res.landmarkProgress).toBe(10);
    expect(res.landmarkStage).toBe(0);
    expect(res.splits).toEqual([{ stage: 0, amount: 10 }]);
    expect(res.completed).toEqual([]);
  });

  it('adds to progress without completing a stage', () => {
    const res = applyContribution(
      city({ landmarkStage: 0, landmarkProgress: 50 }),
      500,
      100,
      t
    );
    expect(res.applied).toBe(100);
    expect(res.landmarkProgress).toBe(150);
    expect(res.landmarkStage).toBe(0);
    expect(res.completed).toEqual([]);
  });

  it('completes a stage exactly at the threshold', () => {
    const res = applyContribution(
      city({ landmarkStage: 0, landmarkProgress: 250 }),
      500,
      50,
      t
    );
    expect(res.applied).toBe(50);
    expect(res.landmarkStage).toBe(1);
    expect(res.landmarkProgress).toBe(0);
    expect(res.completed).toEqual([1]);
    expect(res.splits).toEqual([{ stage: 0, amount: 50 }]);
  });

  it('carries the remainder into the next stage with a split zset record', () => {
    const res = applyContribution(
      city({ landmarkStage: 0, landmarkProgress: 250 }),
      500,
      120,
      t
    );
    // 50 finishes stage 0 (threshold 300); 70 carries into stage 1.
    expect(res.applied).toBe(120);
    expect(res.landmarkStage).toBe(1);
    expect(res.landmarkProgress).toBe(70);
    expect(res.completed).toEqual([1]);
    expect(res.splits).toEqual([
      { stage: 0, amount: 50 },
      { stage: 1, amount: 70 },
    ]);
  });

  it('completes multiple stages in one huge contribution', () => {
    // From stage 0 progress 0: 300 finishes stage 0, 900 finishes stage 1,
    // leaving 100 toward stage 2.
    const res = applyContribution(
      city({ landmarkStage: 0, landmarkProgress: 0 }),
      5000,
      1300,
      t
    );
    expect(res.applied).toBe(1300);
    expect(res.landmarkStage).toBe(2);
    expect(res.landmarkProgress).toBe(100);
    expect(res.completed).toEqual([1, 2]);
    expect(res.splits).toEqual([
      { stage: 0, amount: 300 },
      { stage: 1, amount: 900 },
      { stage: 2, amount: 100 },
    ]);
  });

  it('ignores the excess once the final stage completes', () => {
    // Final stage index 4, threshold 7500. Overpaying wastes the excess.
    const res = applyContribution(
      city({ landmarkStage: 4, landmarkProgress: 7400 }),
      5000,
      500,
      t
    );
    expect(res.applied).toBe(100);
    expect(res.landmarkStage).toBe(5);
    expect(res.landmarkProgress).toBe(0);
    expect(res.completed).toEqual([5]);
    expect(res.splits).toEqual([{ stage: 4, amount: 100 }]);
  });

  it('reports the landmark complete once every stage is built', () => {
    expect(landmarkComplete(city({ landmarkStage: 5 }), t)).toBe(true);
    expect(landmarkComplete(city({ landmarkStage: 4 }), t)).toBe(false);
  });
});

describe('ballot tally', () => {
  it('picks the strict majority winner', () => {
    expect(tallyBallot({ coins: 5, supplies: 2, decor: 1 }, 'coins')).toBe(
      'coins'
    );
  });

  it('rotates to the next category from the current festival on a tie', () => {
    expect(tallyBallot({ coins: 3, supplies: 3, decor: 0 }, 'coins')).toBe(
      'supplies'
    );
  });

  it('rotates when no votes were cast', () => {
    expect(tallyBallot({ coins: 0, supplies: 0, decor: 0 }, 'supplies')).toBe(
      'decor'
    );
    expect(tallyBallot({ coins: 0, supplies: 0, decor: 0 }, 'decor')).toBe(
      'coins'
    );
  });

  it('rotates coins -> supplies -> decor -> coins', () => {
    expect(nextFestival('coins')).toBe('supplies');
    expect(nextFestival('supplies')).toBe('decor');
    expect(nextFestival('decor')).toBe('coins');
  });
});

describe('stage payout', () => {
  it('pays a stage-0 contributor 100 coins when landmarkStage reaches 1', () => {
    const contributed = (n: number): boolean => n === 0;
    expect(computePayout(0, 1, contributed)).toBe(100);
    expect(stageReward(0)).toBe(100);
  });

  it('pays a non-contributor nothing', () => {
    const contributed = (): boolean => false;
    expect(computePayout(0, 1, contributed)).toBe(0);
  });

  it('sums (n+1)*100 across every unpaid completed stage the player funded', () => {
    // Stages 0,1,2 complete; contributed to 0 and 2 only.
    const contributed = (n: number): boolean => n === 0 || n === 2;
    // (0+1)*100 + (2+1)*100 = 100 + 300 = 400.
    expect(computePayout(0, 3, contributed)).toBe(400);
  });

  it('pays nothing when paidStage already covers the current stage', () => {
    const contributed = (): boolean => true;
    expect(computePayout(3, 3, contributed)).toBe(0);
  });
});
