import { describe, expect, it } from 'vitest';
import type { PlayerState, TileState } from './types';
import {
  QUEST_CHAIN,
  REPEATABLE,
  SCALE_PER_LAP,
  advanceQuest,
  claimQuestError,
  questAt,
  questBaselineFor,
  questMetricValue,
  questProgress,
  questSnapshot,
  type QuestSnapshot,
} from './quests';

const CH = QUEST_CHAIN.length;

const player = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  id: 'p1',
  name: 'Alice',
  coins: 0,
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
  ...overrides,
});

const emptySnap = (): QuestSnapshot => ({
  owned: 0,
  wheatfieldBuilt: false,
  processorBuilt: false,
  rawBuildings: 0,
  tier2Owned: false,
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

describe('QUEST_CHAIN content (v3 — the great simplification)', () => {
  it('has exactly 17 quests (vote + trader retired; Perfect Harvest added)', () => {
    expect(QUEST_CHAIN).toHaveLength(17);
  });

  it('has unique ids across chain and repeatables', () => {
    const ids = [...QUEST_CHAIN, ...REPEATABLE].map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every quest a positive reward and target', () => {
    for (const q of [...QUEST_CHAIN, ...REPEATABLE]) {
      const total = (q.reward.coins ?? 0) + (q.reward.xp ?? 0);
      expect(total).toBeGreaterThan(0);
      expect(q.target).toBeGreaterThan(0);
    }
  });

  it('matches the design table for a few key rungs', () => {
    expect(QUEST_CHAIN[0]).toMatchObject({ metric: 'owned', target: 1, reward: { coins: 20 } });
    // q4 (S2): Catch a Perfect Harvest, right after the first-harvest quest.
    expect(QUEST_CHAIN[3]).toMatchObject({ metric: 'goldenHarvests', target: 1, reward: { coins: 40 } });
    // q5: sell goods at the Market — soldUnits counts manual sales (P1).
    expect(QUEST_CHAIN[4]).toMatchObject({ metric: 'soldUnits', target: 10 });
    // q10: sell goods — soldUnits is the manual-sell counter.
    expect(QUEST_CHAIN[9]).toMatchObject({ metric: 'soldUnits', target: 150 });
    expect(QUEST_CHAIN[11]).toMatchObject({ metric: 'processedUnits', target: 15, reward: { coins: 50, xp: 50 } });
    expect(QUEST_CHAIN[15]).toMatchObject({ metric: 'lifetimeEarned', target: 1000, reward: { xp: 100 } });
    expect(QUEST_CHAIN[16]).toMatchObject({ metric: 'level', target: 4, reward: { coins: 150 } });
  });

  it('has no vote or trader quests left', () => {
    const metrics = [...QUEST_CHAIN, ...REPEATABLE].map((q) => q.metric);
    expect(metrics).not.toContain('votesCast');
    expect(metrics).not.toContain('tradesDone');
  });

  it('reshapes the sell repeatable to 400 units', () => {
    const rSell = REPEATABLE.find((q) => q.id === 'r-sell');
    expect(rSell).toMatchObject({ metric: 'soldUnits', target: 400 });
  });
});

describe('questAt', () => {
  it('returns the chain quest for in-range indices (lap ignored)', () => {
    expect(questAt(0, 0)).toBe(QUEST_CHAIN[0]);
    expect(questAt(5, 3)).toBe(QUEST_CHAIN[5]);
    expect(questAt(CH - 1, 0)).toBe(QUEST_CHAIN[CH - 1]);
  });

  it('rotates through the three repeatables past the chain', () => {
    expect(questAt(CH, 0).id).toBe('r-earn');
    expect(questAt(CH + 1, 0).id).toBe('r-sell');
    expect(questAt(CH + 2, 0).id).toBe('r-contrib');
    expect(questAt(CH + 3, 1).id).toBe('r-earn');
  });

  it('scales repeatable target and reward by 1.6^lap (rounded)', () => {
    expect(questAt(CH, 0).target).toBe(2500);
    expect(questAt(CH, 1).target).toBe(Math.round(2500 * SCALE_PER_LAP));
    expect(questAt(CH, 2).target).toBe(Math.round(2500 * SCALE_PER_LAP ** 2));
    expect(questAt(CH, 0).reward.coins).toBe(200);
    expect(questAt(CH, 1).reward.coins).toBe(Math.round(200 * SCALE_PER_LAP));
    expect(questAt(CH, 2).reward.coins).toBe(Math.round(200 * SCALE_PER_LAP ** 2));
  });

  it('scales the contrib repeatable coins + xp together', () => {
    const q = questAt(CH + 2, 1);
    expect(q.reward.coins).toBe(Math.round(150 * SCALE_PER_LAP));
    expect(q.reward.xp).toBe(Math.round(100 * SCALE_PER_LAP));
  });
});

describe('questMetricValue', () => {
  it('reads counter metrics off the player', () => {
    const p = player({ soldUnits: 7, collects: 3, level: 5, streak: 2, boostsGiven: 1, goldenHarvests: 4 });
    const s = emptySnap();
    expect(questMetricValue('soldUnits', p, s)).toBe(7);
    expect(questMetricValue('collects', p, s)).toBe(3);
    expect(questMetricValue('level', p, s)).toBe(5);
    expect(questMetricValue('streak', p, s)).toBe(2);
    expect(questMetricValue('boostsGiven', p, s)).toBe(1);
    expect(questMetricValue('goldenHarvests', p, s)).toBe(4);
  });

  it('reads snapshot metrics (booleans as 1|0)', () => {
    const s: QuestSnapshot = {
      owned: 4,
      wheatfieldBuilt: true,
      processorBuilt: false,
      rawBuildings: 2,
      tier2Owned: true,
    };
    const p = player();
    expect(questMetricValue('owned', p, s)).toBe(4);
    expect(questMetricValue('wheatfieldBuilt', p, s)).toBe(1);
    expect(questMetricValue('processorBuilt', p, s)).toBe(0);
    expect(questMetricValue('rawBuildings', p, s)).toBe(2);
    expect(questMetricValue('tier2Owned', p, s)).toBe(1);
  });
});

describe('questProgress', () => {
  it('reads chain progress directly (baseline 0), clamped to target', () => {
    const q = QUEST_CHAIN[4]; // soldUnits ≥ 10 (manual Market sales)
    if (!q) throw new Error('missing quest');
    expect(questProgress(q, player({ soldUnits: 4 }), emptySnap(), 0)).toEqual({ have: 4, done: false });
    expect(questProgress(q, player({ soldUnits: 10 }), emptySnap(), 0)).toEqual({ have: 10, done: true });
    // Over-target clamps have to the target.
    expect(questProgress(q, player({ soldUnits: 999 }), emptySnap(), 0)).toEqual({ have: 10, done: true });
  });

  it('handles a boolean snapshot metric', () => {
    const q = QUEST_CHAIN[1]; // wheatfield built
    if (!q) throw new Error('missing quest');
    const built: QuestSnapshot = { ...emptySnap(), wheatfieldBuilt: true };
    expect(questProgress(q, player(), emptySnap(), 0).done).toBe(false);
    expect(questProgress(q, player(), built, 0)).toEqual({ have: 1, done: true });
  });

  it('measures repeatable quests as a delta from the baseline', () => {
    const q = questAt(CH, 0); // earn 2500 more
    const base = 1000;
    expect(questProgress(q, player({ lifetimeEarned: 2500 }), emptySnap(), base)).toEqual({
      have: 1500,
      done: false,
    });
    expect(questProgress(q, player({ lifetimeEarned: 3500 }), emptySnap(), base)).toEqual({
      have: 2500,
      done: true,
    });
  });

  it('never reports negative progress', () => {
    const q = questAt(CH, 0);
    expect(questProgress(q, player({ lifetimeEarned: 500 }), emptySnap(), 1000)).toEqual({
      have: 0,
      done: false,
    });
  });
});

describe('advanceQuest', () => {
  it('walks the chain by index alone', () => {
    expect(advanceQuest(0, 0)).toEqual({ index: 1, lap: 0 });
    expect(advanceQuest(CH - 2, 0)).toEqual({ index: CH - 1, lap: 0 });
  });

  it('crosses from chain into the first repeatable at lap 0', () => {
    expect(advanceQuest(CH - 1, 0)).toEqual({ index: CH, lap: 0 });
  });

  it('increments the lap each time a full repeatable rotation completes', () => {
    expect(advanceQuest(CH, 0)).toEqual({ index: CH + 1, lap: 0 });
    expect(advanceQuest(CH + 1, 0)).toEqual({ index: CH + 2, lap: 0 });
    // Last repeatable of the rotation → wraps to r-earn as a new lap.
    expect(advanceQuest(CH + 2, 0)).toEqual({ index: CH + 3, lap: 1 });
    expect(advanceQuest(CH + 3, 1)).toEqual({ index: CH + 4, lap: 1 });
    expect(advanceQuest(CH + 5, 1)).toEqual({ index: CH + 6, lap: 2 });
  });
});

describe('questBaselineFor', () => {
  it('is 0 for chain quests', () => {
    expect(questBaselineFor(0, 0, player({ soldUnits: 5 }), emptySnap())).toBe(0);
    expect(questBaselineFor(CH - 1, 0, player({ level: 3 }), emptySnap())).toBe(0);
  });

  it('captures the current metric value for a repeatable', () => {
    // r-earn measures lifetimeEarned.
    expect(questBaselineFor(CH, 0, player({ lifetimeEarned: 1234 }), emptySnap())).toBe(1234);
    // r-sell measures soldUnits.
    expect(questBaselineFor(CH + 1, 0, player({ soldUnits: 88 }), emptySnap())).toBe(88);
  });
});

describe('claimQuestError', () => {
  it('rejects an incomplete quest with a have/target message', () => {
    const q = QUEST_CHAIN[4]; // soldUnits ≥ 10
    if (!q) throw new Error('missing quest');
    expect(claimQuestError(q, player({ soldUnits: 4 }), emptySnap(), 0)).toBe('Not there yet — 4/10');
  });

  it('returns null for a completed quest', () => {
    const q = QUEST_CHAIN[4];
    if (!q) throw new Error('missing quest');
    expect(claimQuestError(q, player({ soldUnits: 10 }), emptySnap(), 0)).toBeNull();
  });
});

describe('questSnapshot', () => {
  it('counts owned plots, wheat field, processor, raw producers and tier-2', () => {
    const grid: Record<string, TileState> = {
      '5,5': tile({ buildingId: 'wheatfield' }),
      '5,6': tile({ buildingId: 'grove', tier: 2 }),
      '5,7': tile({ buildingId: 'windmill' }),
      '5,8': tile(), // bare claimed plot
      '9,9': tile({ owner: 'other', ownerName: 'Bob', buildingId: 'quarry' }),
    };
    expect(questSnapshot(grid, 'p1')).toEqual({
      owned: 4,
      wheatfieldBuilt: true,
      processorBuilt: true,
      rawBuildings: 2,
      tier2Owned: true,
    });
  });

  it('returns all-zero/false for a player with no plots', () => {
    expect(questSnapshot({}, 'p1')).toEqual(emptySnap());
  });
});
