import type { PlayerState, TileState } from './types';
import { CATALOG } from './catalog';

/**
 * The Villager's Journal quest domain — a single sequenced chain (steps 1–18)
 * followed by three rotating repeatable tiers whose targets/rewards scale by
 * `SCALE_PER_LAP` each lap. Everything here is pure and fully unit-tested; the
 * server derives a grid snapshot and applies these functions to validate a
 * claim and advance the ladder.
 */

/** What a quest measures. Grid-derived metrics read from a `QuestSnapshot`; the
 * rest read a player counter (or level/streak/lifetime totals). */
export type QuestMetric =
  | 'owned'
  | 'wheatfieldBuilt'
  | 'collects'
  | 'soldUnits'
  | 'streak'
  | 'level'
  | 'rawBuildings'
  | 'processorBuilt'
  | 'processedUnits'
  | 'boostsGiven'
  | 'votesCast'
  | 'tradesDone'
  | 'tier2Owned'
  | 'lifetimeContributed'
  | 'lifetimeEarned';

export type Quest = {
  id: string;
  title: string;
  blurb: string;
  metric: QuestMetric;
  target: number;
  reward: { coins?: number; xp?: number };
};

/**
 * The fixed 18-step ladder. Titles/metrics/targets/rewards follow the design
 * doc's quest table verbatim; each blurb is one warm line of flavour.
 */
export const QUEST_CHAIN: Quest[] = [
  {
    id: 'q01',
    title: 'Settle your first plot',
    blurb: 'Every great village begins with a single claimed plot — stake yours.',
    metric: 'owned',
    target: 1,
    reward: { coins: 20 },
  },
  {
    id: 'q02',
    title: 'Build a Wheat Field',
    blurb: 'Golden wheat feeds the whole village; raise your first field.',
    metric: 'wheatfieldBuilt',
    target: 1,
    reward: { coins: 15 },
  },
  {
    id: 'q03',
    title: 'Collect your first harvest',
    blurb: 'Tap a ready building to gather what it has quietly made for you.',
    metric: 'collects',
    target: 1,
    reward: { coins: 25 },
  },
  {
    id: 'q04',
    title: 'Sell 10 goods at the Market',
    blurb: 'Carry your goods to the market and turn them into honest coin.',
    metric: 'soldUnits',
    target: 10,
    reward: { coins: 30 },
  },
  {
    id: 'q05',
    title: 'Check in at the Hearth',
    blurb: 'Warm yourself at the Hearth each day to keep your streak alive.',
    metric: 'streak',
    target: 1,
    reward: { xp: 50 },
  },
  {
    id: 'q06',
    title: 'Reach level 2',
    blurb: 'Earn a little experience to grow from settler to seasoned builder.',
    metric: 'level',
    target: 2,
    reward: { coins: 40 },
  },
  {
    id: 'q07',
    title: 'Claim a second plot',
    blurb: 'Your village is ready to spread — claim a second plot of land.',
    metric: 'owned',
    target: 2,
    reward: { coins: 30 },
  },
  {
    id: 'q08',
    title: 'Build a Grove or Quarry',
    blurb: 'Raw materials fuel everything; raise a grove or a quarry.',
    metric: 'rawBuildings',
    target: 2,
    reward: { coins: 50 },
  },
  {
    id: 'q09',
    title: 'Sell 60 goods',
    blurb: 'Keep the market bustling by selling sixty goods in all.',
    metric: 'soldUnits',
    target: 60,
    reward: { coins: 60 },
  },
  {
    id: 'q10',
    title: 'Build a processor (Windmill/Sawmill/Kiln)',
    blurb: 'Refine your raw goods by building a windmill, sawmill, or kiln.',
    metric: 'processorBuilt',
    target: 1,
    reward: { coins: 80 },
  },
  {
    id: 'q11',
    title: 'Process 15 goods',
    blurb: 'Run your processor until fifteen refined goods have been made.',
    metric: 'processedUnits',
    target: 15,
    reward: { coins: 50, xp: 50 },
  },
  {
    id: 'q12',
    title: "Boost a neighbor's building",
    blurb: 'Lend a neighbour a hand by boosting one of their buildings.',
    metric: 'boostsGiven',
    target: 1,
    reward: { coins: 25 },
  },
  {
    id: 'q13',
    title: "Vote for tomorrow's festival",
    blurb: "Have your say at the ballot and shape tomorrow's festival.",
    metric: 'votesCast',
    target: 1,
    reward: { coins: 25 },
  },
  {
    id: 'q14',
    title: 'Strike a deal with the trader',
    blurb: 'Meet the wandering trader and strike a favourable deal.',
    metric: 'tradesDone',
    target: 1,
    reward: { coins: 40 },
  },
  {
    id: 'q15',
    title: 'Upgrade any building to tier 2',
    blurb: 'Invest in your village by upgrading a building to tier two.',
    metric: 'tier2Owned',
    target: 1,
    reward: { coins: 75 },
  },
  {
    id: 'q16',
    title: 'Contribute 20 planks or bricks to the Keep',
    blurb: 'Give twenty planks or bricks toward the rising Grand Keep.',
    metric: 'lifetimeContributed',
    target: 20,
    reward: { coins: 100 },
  },
  {
    id: 'q17',
    title: 'Earn 1,000 lifetime coins',
    blurb: 'Grow prosperous by earning a thousand coins from your buildings.',
    metric: 'lifetimeEarned',
    target: 1000,
    reward: { xp: 100 },
  },
  {
    id: 'q18',
    title: 'Reach level 4',
    blurb: 'Prove your mastery by reaching the fourth level of renown.',
    metric: 'level',
    target: 4,
    reward: { coins: 150 },
  },
];

/** Repeatable tiers rotate in this order once the chain is complete. Their
 * targets are measured as DELTAS from a baseline captured when they go active. */
export const REPEATABLE: Quest[] = [
  {
    id: 'r-earn',
    title: 'Earn another 2,500 coins',
    blurb: 'Earn another purse of coins from your ever-busier village.',
    metric: 'lifetimeEarned',
    target: 2500,
    reward: { coins: 200 },
  },
  {
    id: 'r-sell',
    title: 'Sell another 250 goods',
    blurb: 'Keep the market roaring by selling another wagonload of goods.',
    metric: 'soldUnits',
    target: 250,
    reward: { coins: 150 },
  },
  {
    id: 'r-contrib',
    title: 'Contribute another 100 to the Keep',
    blurb: 'Pour another hundred goods into the ever-rising Grand Keep.',
    metric: 'lifetimeContributed',
    target: 100,
    reward: { coins: 150, xp: 100 },
  },
];

/** Each repeatable lap multiplies the target (and reward) by this factor. */
export const SCALE_PER_LAP = 1.6;

/**
 * A grid-derived snapshot of the metrics that cannot be read off a player hash.
 * Built server-side (the grid is already loaded) and threaded into progress.
 */
export type QuestSnapshot = {
  owned: number;
  wheatfieldBuilt: boolean;
  processorBuilt: boolean;
  rawBuildings: number;
  tier2Owned: boolean;
};

/** Derive the grid snapshot for one player: their owned plots, whether they own
 * a wheat field / any processor / a tier-2+ building, and their raw-producer
 * count. Pure — the grid is passed in. */
export const questSnapshot = (
  grid: Record<string, TileState>,
  userId: string
): QuestSnapshot => {
  let owned = 0;
  let rawBuildings = 0;
  let wheatfieldBuilt = false;
  let processorBuilt = false;
  let tier2Owned = false;
  for (const tile of Object.values(grid)) {
    if (tile.owner !== userId) continue;
    owned += 1;
    const bid = tile.buildingId;
    if (!bid) continue;
    if (bid === 'wheatfield') wheatfieldBuilt = true;
    const role = CATALOG[bid].role;
    if (role === 'raw') rawBuildings += 1;
    if (role === 'processor') processorBuilt = true;
    if (tile.tier >= 2) tier2Owned = true;
  }
  return { owned, wheatfieldBuilt, processorBuilt, rawBuildings, tier2Owned };
};

/** The absolute value of a metric (grid snapshot booleans read as 1|0). Pure. */
export const questMetricValue = (
  metric: QuestMetric,
  player: PlayerState,
  snap: QuestSnapshot
): number => {
  switch (metric) {
    case 'owned':
      return snap.owned;
    case 'wheatfieldBuilt':
      return snap.wheatfieldBuilt ? 1 : 0;
    case 'processorBuilt':
      return snap.processorBuilt ? 1 : 0;
    case 'rawBuildings':
      return snap.rawBuildings;
    case 'tier2Owned':
      return snap.tier2Owned ? 1 : 0;
    case 'collects':
      return player.collects;
    case 'soldUnits':
      return player.soldUnits;
    case 'processedUnits':
      return player.processedUnits;
    case 'boostsGiven':
      return player.boostsGiven;
    case 'votesCast':
      return player.votesCast;
    case 'tradesDone':
      return player.tradesDone;
    case 'streak':
      return player.streak;
    case 'level':
      return player.level;
    case 'lifetimeContributed':
      return player.lifetimeContributed;
    case 'lifetimeEarned':
      return player.lifetimeEarned;
  }
};

/**
 * The active quest at ladder position `(index, lap)`. Indices 0..17 are the
 * fixed chain (lap ignored); index ≥18 selects a repeatable by rotation and
 * scales its target + reward by `SCALE_PER_LAP^lap` (rounded).
 */
export const questAt = (index: number, lap: number): Quest => {
  const chainQuest = QUEST_CHAIN[index];
  if (chainQuest) return chainQuest;

  const pos =
    (((index - QUEST_CHAIN.length) % REPEATABLE.length) + REPEATABLE.length) %
    REPEATABLE.length;
  const base = REPEATABLE[pos];
  if (!base) throw new Error(`No repeatable quest at position ${pos}`);

  const factor = SCALE_PER_LAP ** Math.max(0, lap);
  const reward: { coins?: number; xp?: number } = {};
  if (base.reward.coins !== undefined) {
    reward.coins = Math.round(base.reward.coins * factor);
  }
  if (base.reward.xp !== undefined) {
    reward.xp = Math.round(base.reward.xp * factor);
  }
  return { ...base, target: Math.round(base.target * factor), reward };
};

/**
 * Progress toward a quest. `baseline` is 0 for chain quests (so `have` reads the
 * metric directly) and the captured metric value for repeatables (so `have`
 * measures the DELTA since the quest went active). `have` is clamped to the
 * target; `done` once it reaches the target. Pure.
 */
export const questProgress = (
  quest: Quest,
  player: PlayerState,
  snap: QuestSnapshot,
  baseline: number
): { have: number; done: boolean } => {
  const raw = questMetricValue(quest.metric, player, snap) - baseline;
  const have = Math.max(0, Math.min(raw, quest.target));
  return { have, done: have >= quest.target };
};

/**
 * The next ladder position after claiming `(index, lap)`. The chain advances by
 * index alone; once in repeatable territory the lap increments each time a full
 * rotation of the three tiers completes. Pure.
 */
export const advanceQuest = (
  index: number,
  lap: number
): { index: number; lap: number } => {
  const nextIndex = index + 1;
  let nextLap = lap;
  if (nextIndex > QUEST_CHAIN.length) {
    const pos = (nextIndex - QUEST_CHAIN.length) % REPEATABLE.length;
    // Wrapping back to the first repeatable (past the chain boundary) is a new lap.
    if (pos === 0) nextLap = lap + 1;
  }
  return { index: nextIndex, lap: nextLap };
};

/** The baseline to store for the quest at `(index, lap)`: 0 for chain quests,
 * else the current metric value (so the repeatable measures a forward delta). */
export const questBaselineFor = (
  index: number,
  lap: number,
  player: PlayerState,
  snap: QuestSnapshot
): number => {
  if (index < QUEST_CHAIN.length) return 0;
  return questMetricValue(questAt(index, lap).metric, player, snap);
};

/** Validate a claim: null when the active quest is complete, else the
 * "Not there yet — have/target" rejection message. Pure. */
export const claimQuestError = (
  quest: Quest,
  player: PlayerState,
  snap: QuestSnapshot,
  baseline: number
): string | null => {
  const { have, done } = questProgress(quest, player, snap, baseline);
  if (done) return null;
  return `Not there yet — ${have}/${quest.target}`;
};
