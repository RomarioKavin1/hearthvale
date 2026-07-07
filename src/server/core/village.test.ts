import { describe, expect, it } from 'vitest';
import type { CityState, PlayerState, TileState } from '../../shared/types';
import { CATALOG, KEEP_STAGE_COSTS } from '../../shared/catalog';
import { emptyStockpile } from '../../shared/logic/economy';
import {
  affordableRuns,
  applyCollect,
  applyKeepContribution,
  applyLevelUp,
  applyStageBuff,
  boostsUsedToday,
  canAffordOffer,
  canCheckIn,
  expansionGate,
  flairTitle,
  landmarkComplete,
  nextFestival,
  nextStreak,
  proRataPayout,
  shareText,
  stageNameFromWords,
  stagePot,
  tallyBallot,
  validateBoost,
  validateBuild,
  validateNaming,
  validateTrade,
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
  festival: 'raw',
  festivalDate: '2026-07-07',
  landmarkStage: 0,
  stagePlanks: 0,
  stageBricks: 0,
  totalCollected: 0,
  totalContributed: 0,
  weather: 'clear',
  weatherDate: '2026-07-07',
  population: 0,
  stageNames: [],
  ...overrides,
});

const stock = (overrides: Partial<Record<string, number>> = {}) => ({
  ...emptyStockpile(),
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
    expect(validateBuild(player({ level: 1 }), tile(), CATALOG.quarry)).not.toBeNull();
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
    const p = applyLevelUp(player({ level: 1, plots: 1, xp: 150 }));
    expect(p.level).toBe(2);
    expect(p.plots).toBe(1);
  });

  it('grants a second plot when crossing the level 2->3 boundary', () => {
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

describe('applyCollect — coins buildings', () => {
  it('credits a normal gain and advances lastCollect', () => {
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0 });
    const now = 60_000;
    const res = applyCollect(t, player({ coins: 0 }), city(), now, 0, emptyStockpile());
    expect(res.gained).toEqual({ coins: 2, xp: 1, goods: {} });
    expect(res.player.coins).toBe(2);
    expect(res.player.xp).toBe(1);
    expect(res.tile.lastCollect).toBe(now);
  });

  it('advances the absolute lifetimeEarned counter by the coins gained', () => {
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(t, player({ coins: 0, lifetimeEarned: 40 }), city(), 60_000, 0, emptyStockpile());
    expect(res.gained.coins).toBe(2);
    expect(res.player.lifetimeEarned).toBe(42);
  });

  it('is replay-safe: re-applying the same collect yields the same lb:earned score', () => {
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0 });
    const start = player({ coins: 0, lifetimeEarned: 40 });
    const a = applyCollect(t, start, city(), 60_000, 0, emptyStockpile());
    const b = applyCollect(t, start, city(), 60_000, 0, emptyStockpile());
    expect(a.player.lifetimeEarned).toBe(b.player.lifetimeEarned);
    expect(a.player.lifetimeEarned).toBe(42);
  });

  it('preserves fractional progress on a zero gain (lastCollect NOT advanced)', () => {
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(t, player({ coins: 0 }), city(), 1000, 0, emptyStockpile());
    expect(res.gained).toEqual({ coins: 0, xp: 0, goods: {} });
    expect(res.tile.lastCollect).toBe(0);
  });

  it('clears an expired boost after a producing collect', () => {
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0, boostUntil: 30_000, boostBy: 'bob' });
    const res = applyCollect(t, player({ coins: 0 }), city(), 120_000, 0, emptyStockpile());
    expect(res.gained.coins).toBeGreaterThan(0);
    expect(res.tile.boostUntil).toBe(0);
    expect(res.tile.boostBy).toBeUndefined();
  });

  it('keeps an unexpired boost after collecting', () => {
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0, boostUntil: 300_000, boostBy: 'bob' });
    const res = applyCollect(t, player({ coins: 0 }), city(), 120_000, 0, emptyStockpile());
    expect(res.tile.boostUntil).toBe(300_000);
    expect(res.tile.boostBy).toBe('bob');
  });

  it('clamps to the tier cap on a long absence', () => {
    const t = tile({ buildingId: 'cottage', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(t, player({ coins: 0 }), city(), 1_000_000_000, 0, emptyStockpile());
    expect(res.gained.coins).toBe(60);
  });
});

describe('applyCollect — raw producers (goods, not lb:earned)', () => {
  it('routes goods into the wallet and never touches lifetimeEarned', () => {
    const t = tile({ buildingId: 'wheatfield', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 0, lifetimeEarned: 500 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      emptyStockpile()
    );
    // wheatfield tier-1 cap is 90.
    expect(res.gained.goods.wheat).toBe(90);
    expect(res.player.wallet.wheat).toBe(90);
    expect(res.player.coins).toBe(0);
    // Production of goods is not coin income → lb:earned unchanged.
    expect(res.player.lifetimeEarned).toBe(500);
  });

  it('grants a level-up (and plots) when the collected xp crosses a threshold', () => {
    const t = tile({ buildingId: 'wheatfield', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 0, xp: 440, level: 2, plots: 1 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      emptyStockpile()
    );
    expect(res.player.xp).toBe(530);
    expect(res.player.level).toBe(3);
    expect(res.player.plots).toBe(2);
  });
});

describe('applyCollect — processors', () => {
  it('a windmill grinds stockpile wheat into wallet flour and charges the owner', () => {
    const t = tile({ buildingId: 'windmill', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 1000 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stock({ wheat: 100 })
    );
    // cap 45 flour; priceFor(100, wheat) === 3, per 2 → cost 3×90 = 270.
    expect(res.gained.goods.flour).toBe(45);
    expect(res.player.wallet.flour).toBe(45);
    expect(res.consumed).toEqual({ wheat: 90 });
    expect(res.player.coins).toBe(1000 - 270);
    expect(res.player.lifetimeEarned).toBe(0);
  });

  it('limits runs to what the owner can afford when short on coins', () => {
    const t = tile({ buildingId: 'windmill', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 10 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stock({ wheat: 100 })
    );
    // cost/run = price 3 × per 2 = 6; floor(10/6) = 1 run only.
    expect(res.gained.goods.flour).toBe(1);
    expect(res.consumed).toEqual({ wheat: 2 });
    expect(res.player.coins).toBe(10 - 6);
  });

  it('does not advance lastCollect when the owner can afford zero runs', () => {
    const t = tile({ buildingId: 'windmill', lastCollect: 0, readyAt: 0 });
    const res = applyCollect(
      t,
      player({ coins: 5 }),
      city({ festival: 'coins' }),
      1_000_000_000,
      0,
      stock({ wheat: 100 })
    );
    // floor(5/6) = 0 runs.
    expect(res.gained.goods.flour).toBeUndefined();
    expect(res.consumed).toEqual({ wheat: 0 });
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
      stock({ flour: 100 })
    );
    // cap 480 → 40 runs × 12 = 480 coins; priceFor(100, flour) === 5, cost 5×40 = 200.
    expect(res.consumed).toEqual({ flour: 40 });
    expect(res.gained.coins).toBe(280);
    expect(res.player.coins).toBe(280);
    expect(res.player.lifetimeEarned).toBe(280);
  });
});

describe('applyStageBuff', () => {
  it('is a no-op at stage 0', () => {
    const g = { coins: 100, xp: 5, goods: { wheat: 10 } };
    expect(applyStageBuff(g, 0)).toEqual(g);
  });

  it('adds +3% per stage, floored, and never buffs xp', () => {
    const g = { coins: 100, xp: 5, goods: { wheat: 10 } };
    const out = applyStageBuff(g, 3); // ×1.09
    expect(out.coins).toBe(109);
    expect(out.goods.wheat).toBe(10); // 10.9 → 10
    expect(out.xp).toBe(5);
  });

  it('caps the multiplier at +15% (5 stages)', () => {
    const g = { coins: 100, xp: 0, goods: {} };
    expect(applyStageBuff(g, 5).coins).toBe(115);
    expect(applyStageBuff(g, 10).coins).toBe(115);
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
});

describe('applyKeepContribution', () => {
  const costs = KEEP_STAGE_COSTS; // [(30,15),(60,40),...]

  it('fills only the contributed good and does not complete a mixed stage', () => {
    const res = applyKeepContribution(city(), 'planks', 20, costs);
    expect(res.applied).toBe(20);
    expect(res.refunded).toBe(0);
    expect(res.stagePlanks).toBe(20);
    expect(res.stageBricks).toBe(0);
    expect(res.landmarkStage).toBe(0);
    expect(res.completed).toEqual([]);
    expect(res.splits).toEqual([{ stage: 0, amount: 20 }]);
  });

  it('refunds excess of a completed good when the stage cannot advance', () => {
    // 50 planks: 30 fills the requirement, the other 20 cannot be used (bricks
    // requirement unmet) and cannot carry, so they are refunded.
    const res = applyKeepContribution(city(), 'planks', 50, costs);
    expect(res.applied).toBe(30);
    expect(res.refunded).toBe(20);
    expect(res.stagePlanks).toBe(30);
    expect(res.landmarkStage).toBe(0);
    expect(res.completed).toEqual([]);
  });

  it('completes a stage once BOTH goods are met', () => {
    const res = applyKeepContribution(
      city({ landmarkStage: 0, stagePlanks: 30, stageBricks: 0 }),
      'bricks',
      15,
      costs
    );
    expect(res.applied).toBe(15);
    expect(res.landmarkStage).toBe(1);
    expect(res.stagePlanks).toBe(0);
    expect(res.stageBricks).toBe(0);
    expect(res.completed).toEqual([1]);
  });

  it('carries leftover into the next stage across a completion, then refunds', () => {
    // Stage 0 planks already full (30), bricks 14/15. A big bricks contribution
    // finishes stage 0 (carry into stage 1's bricks), fills stage 1 bricks (40),
    // but stage 1 planks are 0 so the rest is refunded.
    const res = applyKeepContribution(
      city({ landmarkStage: 0, stagePlanks: 30, stageBricks: 14 }),
      'bricks',
      100,
      costs
    );
    expect(res.completed).toEqual([1]);
    expect(res.landmarkStage).toBe(1);
    expect(res.stageBricks).toBe(40);
    expect(res.stagePlanks).toBe(0);
    expect(res.applied).toBe(1 + 40);
    expect(res.refunded).toBe(100 - 41);
    expect(res.splits).toEqual([
      { stage: 0, amount: 1 },
      { stage: 1, amount: 40 },
    ]);
  });

  it('reports the keep complete once every stage is built', () => {
    expect(landmarkComplete(city({ landmarkStage: KEEP_STAGE_COSTS.length }))).toBe(true);
    expect(landmarkComplete(city({ landmarkStage: 4 }))).toBe(false);
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
    // population 0 → ring [5,11].
    expect(expansionGate(5, 5, 0)).toBeNull();
    expect(expansionGate(11, 11, 0)).toBeNull();
  });

  it('rejects a locked outer tile, naming the villagers needed', () => {
    // (4,4) is outside [5,11]; next ring unlocks at population 3.
    expect(expansionGate(4, 4, 0)).toBe(
      'The village must grow first (3 more villagers unlock new land).'
    );
    // population 2 needs 1 more to reach the pop-3 ring.
    expect(expansionGate(4, 10, 2)).toBe(
      'The village must grow first (1 more villagers unlock new land).'
    );
  });

  it('opens the next ring after crossing a threshold', () => {
    // population 3 → ring [4,13]; (4,4) is now unlocked, (3,3) still locked.
    expect(expansionGate(4, 4, 3)).toBeNull();
    expect(expansionGate(3, 3, 3)).not.toBeNull();
    // population 6 → ring [3,14]; (3,3) unlocks.
    expect(expansionGate(3, 3, 6)).toBeNull();
  });
});

describe('trader validation', () => {
  const offer = { give: { good: 'logs' as const, qty: 6 }, get: { good: 'bricks' as const, qty: 4 } };

  it('rejects a second trade the same day', () => {
    expect(validateTrade(true, player().wallet, offer)).toBe('You have already traded today.');
  });

  it('rejects an unaffordable give side', () => {
    const wallet = { ...player().wallet, logs: 2 };
    expect(validateTrade(false, wallet, offer)).toBe('You need 6 logs.');
    expect(canAffordOffer(wallet, offer)).toBe(false);
  });

  it('allows an affordable, first-of-day trade', () => {
    const wallet = { ...player().wallet, logs: 10 };
    expect(validateTrade(false, wallet, offer)).toBeNull();
    expect(canAffordOffer(wallet, offer)).toBe(true);
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

describe('boost validation', () => {
  const producer = (over: Partial<TileState> = {}): TileState =>
    tile({ owner: 'owner', buildingId: 'cottage', readyAt: 1000, ...over });

  it("rejects boosting one's own plot", () => {
    expect(validateBoost('me', producer({ owner: 'me' }), 5000, 0)).not.toBeNull();
  });

  it('rejects a plot with no building', () => {
    expect(validateBoost('me', tile({ owner: 'owner', readyAt: 0 }), 5000, 0)).not.toBeNull();
  });

  it('rejects a decoration (non-producer)', () => {
    expect(validateBoost('me', producer({ buildingId: 'well' }), 5000, 0)).not.toBeNull();
  });

  it('rejects a building still under construction', () => {
    expect(validateBoost('me', producer({ readyAt: 10_000 }), 5000, 0)).not.toBeNull();
  });

  it('rejects a tile that already has an active boost', () => {
    expect(validateBoost('me', producer({ boostUntil: 9000 }), 5000, 0)).not.toBeNull();
  });

  it('rejects once the daily boost limit is reached', () => {
    expect(validateBoost('me', producer(), 5000, 5)).not.toBeNull();
  });

  it('allows boosting a completed neighbour producer under the limit', () => {
    expect(validateBoost('me', producer(), 5000, 4)).toBeNull();
  });

  it('counts boosts only for the current day (date rollover resets)', () => {
    const p = player({ boostsToday: 5, boostsDate: '2026-07-06' });
    expect(boostsUsedToday(p, '2026-07-07')).toBe(0);
    expect(boostsUsedToday(p, '2026-07-06')).toBe(5);
  });
});

describe('ballot tally', () => {
  it('picks the strict majority winner', () => {
    expect(tallyBallot({ coins: 5, raw: 2, processed: 1, decor: 0 }, 'coins')).toBe('coins');
  });

  it('rotates to the next category from the current festival on a tie', () => {
    expect(tallyBallot({ coins: 3, raw: 3, processed: 0, decor: 0 }, 'coins')).toBe('raw');
  });

  it('rotates when no votes were cast', () => {
    expect(tallyBallot({ coins: 0, raw: 0, processed: 0, decor: 0 }, 'raw')).toBe('processed');
    expect(tallyBallot({ coins: 0, raw: 0, processed: 0, decor: 0 }, 'decor')).toBe('coins');
  });

  it('rotates coins -> raw -> processed -> decor -> coins', () => {
    expect(nextFestival('coins')).toBe('raw');
    expect(nextFestival('raw')).toBe('processed');
    expect(nextFestival('processed')).toBe('decor');
    expect(nextFestival('decor')).toBe('coins');
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

  it('builds a Grand Keep stage comment crediting the subreddit', () => {
    expect(shareText('stage', 3, 'ada', 'cozytown')).toBe(
      'The Grand Keep reached Stage 3/5 — built together by the villagers of r/cozytown!'
    );
  });
});
