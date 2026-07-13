/** The six tradeable goods. Raw goods are produced directly; processed goods
 * come out of processors that consume raw goods from the village stockpile. */
export type Good = 'wheat' | 'logs' | 'stone' | 'flour' | 'planks' | 'bricks';

/** A player's private balance of each good. */
export type Wallet = Record<Good, number>;

/** The village-wide market inventory of each good (shared by all players). */
export type Stockpile = Record<Good, number>;

/** Current market price of each good, derived from the stockpile. */
export type Prices = Record<Good, number>;

/** Daily weather, rolled once per UTC day and applied to every producer. */
export type Weather = 'sunny' | 'rain' | 'clear' | 'harvestmoon';

/**
 * A single wandering-trader offer: give a quantity of one good, get either a
 * quantity of another good or a one-off cosmetic (the golden roof). The trader
 * is RETIRED player-facing (S1); the type remains for the deterministic offer
 * generator in shared/logic/trader.ts.
 */
export type TraderOffer = {
  give: { good: Good; qty: number };
  get: { good: Good; qty: number } | { cosmetic: 'golden-roof' };
};

/** What a building's role is, for accrual + festival matching. */
export type BuildingRole = 'coins' | 'raw' | 'processor' | 'decor';

/** Festival categories the daily auto-rotation cycles through. Note `processed`
 * (the festival) corresponds to the `processor` building role. */
export type FestivalCategory = 'coins' | 'raw' | 'processed' | 'decor';

export type BuildingId =
  | 'house'
  | 'wheatfield'
  | 'grove'
  | 'quarry'
  | 'windmill'
  | 'sawmill'
  | 'kiln'
  | 'bakery'
  | 'well'
  | 'trees'
  | 'fountain'
  | 'manor';

export type Tier = 1 | 2 | 3;

/** The four paintable roof colours a player can apply to a stacked building. */
export type RoofColor = 'brown' | 'green' | 'purple' | 'beige';

export type TileState = {
  owner: string;
  ownerName: string;
  buildingId?: BuildingId;
  tier: Tier;
  builtAt: number;
  readyAt: number;
  lastCollect: number;
  boostUntil: number;
  boostBy?: string;
  /** A cosmetic unlocked via the trader (currently only the golden roof). */
  cosmetic?: 'golden-roof';
  /** Player-chosen roof colour (stacked buildings only); overrides the tier
   * colour progression. The golden-roof cosmetic still overrides this visually. */
  roofColor?: RoofColor;
};

/** The mod-selectable village themes that reskin the diorama + splash. Meadow /
 * autumn / twilight / pale tint the grass world; desert swaps the whole terrain
 * family for the Sketch Desert sand biome. */
export type VillageTheme = 'meadow' | 'autumn' | 'twilight' | 'pale' | 'desert';

export type CityState = {
  foundedAt: number;
  /** Mod-set village name (empty string → display fallback "Hearthvale"). */
  villageName: string;
  /** Mod-set colour theme applied to the diorama + splash (default 'meadow'). */
  theme: VillageTheme;
  festival: FestivalCategory;
  festivalDate: string;
  /** Village Hall level 0..5. Levelling up needs BOTH the resource cost and a
   * population threshold; each level unlocks a land ring + cumulative perks. */
  hallLevel: number;
  /** Planks contributed toward the current Hall level's planks requirement. */
  stagePlanks: number;
  /** Bricks contributed toward the current Hall level's bricks requirement. */
  stageBricks: number;
  totalCollected: number;
  totalContributed: number;
  /** Today's rolled weather. */
  weather: Weather;
  /** UTC day (YYYY-MM-DD) the current weather belongs to. */
  weatherDate: string;
  /** House count — the villager population that gates Village Hall level-ups. */
  population: number;
  /** Naming-rights label chosen by each Hall level's top contributor. */
  stageNames: string[];
  /** Mod-set crest emblem index (0..5: star/trophy/scroll/home/hammer/coin). */
  crest: number;
  /** Mod-set crest banner colour index (0..3: red/green/blue/gold). */
  crestColor: number;
};

export type PlayerState = {
  id: string;
  name: string;
  coins: number;
  /** Per-good private balance. */
  wallet: Wallet;
  xp: number;
  level: number;
  plots: number;
  streak: number;
  lastCheckIn: string;
  boostsToday: number;
  /** UTC day (YYYY-MM-DD) the boostsToday counter belongs to. */
  boostsDate: string;
  /** Highest landmark stage index whose payout this player has collected. */
  paidStage: number;
  /** Lifetime coins spent on build + upgrade — the `lb:value` absolute score. */
  valueSpent: number;
  /** Lifetime coins gathered from collects — the `lb:earned` absolute score. */
  lifetimeEarned: number;
  /** Lifetime goods contributed — the `lb:contrib` absolute score. */
  lifetimeContributed: number;
  // --- Villager's Journal quest counters (all monotonic; legacy players = 0) ---
  /** Lifetime successful collects (collect + collect-all tiles that produced). */
  collects: number;
  /** Lifetime units sold at the Market (manual sales) — the "sell" quest counter. */
  soldUnits: number;
  /** Lifetime processed-output units produced by processors (incl. bakery runs). */
  processedUnits: number;
  /** Lifetime Perfect Harvests: single-tile collects landed inside a tile's
   * golden window (S2). Legacy players default to 0. */
  goldenHarvests: number;
  /** Lifetime boosts handed to neighbours. */
  boostsGiven: number;
  /** Lifetime festival ballots cast (RETIRED with the ballot; kept to avoid a
   * store migration — frozen at its pre-S1 value). */
  votesCast: number;
  /** Lifetime accepted trader deals (RETIRED with the trader; kept to avoid a
   * store migration — frozen at its pre-S1 value). */
  tradesDone: number;
  /** Mural pixels painted today (the daily budget counter). */
  muralToday: number;
  /** UTC day (YYYY-MM-DD) the muralToday counter belongs to. */
  muralDate: string;
  /** Lifetime mural pixels painted — the "Leave your mark" quest counter. */
  muralPixels: number;
  /** Chosen villager outfit index (0..7); default is a stable hash of the id. */
  outfit: number;
  /** Index into the quest ladder: the fixed chain, then repeatable tiers. */
  questIndex: number;
  /** Repeatable-tier lap; scales repeatable targets/rewards by 1.6^lap. */
  questLap: number;
  /** Metric value captured when a repeatable quest became active (delta base). */
  questBaseline: number;
};

export type LeaderRow = { name: string; score: number; me: boolean };

/**
 * Realtime messages broadcast on the 'village' channel.
 */
export type VillageMessage =
  | { t: 'tile'; key: string; tile: TileState }
  | { t: 'city'; city: CityState }
  | { t: 'festival'; festival: FestivalCategory }
  /** A Village Hall level-up: `stage` is the new Hall level (1..5). */
  | { t: 'stage'; stage: number }
  | { t: 'market'; prices: Prices; stockpile: Stockpile }
  | { t: 'ring'; bounds: { lo: number; hi: number } }
  /** A single mural pixel painted at (x, y) with colour index c (0..11). */
  | { t: 'mural'; x: number; y: number; c: number };

/** Land-expansion snapshot: the unlocked ring bounds (derived from the Village
 * Hall level), the population needed for the next Hall level (null once the Hall
 * is maxed), and the current villager count. */
export type RingState = {
  lo: number;
  hi: number;
  nextThreshold: number | null;
  population: number;
};

export type StateResponse = {
  grid: Record<string, TileState>;
  city: CityState;
  me: PlayerState | null;
  now: number;
  top: LeaderRow[];
  /** Village-wide stockpile of each good. */
  stockpile: Stockpile;
  /** Current market price of each good, derived from the stockpile. */
  prices: Prices;
  /** Today's rolled weather. */
  weather: Weather;
  /** Land-expansion ring state. */
  ring: RingState;
  /** The player's active Villager's Journal quest (progress + reward). */
  quest: QuestView;
  /** The Village Mural: `"x,y"` → colour index (0..11). Absent = parchment
   * blank. Tiny (≤384 entries), so it ships whole in every state response. */
  mural: Record<string, number>;
  /** Each house-owner's chosen outfit index (userId → 0..7), for dressing the
   * deterministic villager walkers. */
  outfits: Record<string, number>;
};

/** The active quest as surfaced to the client (StateResponse.quest). */
export type QuestView = {
  index: number;
  lap: number;
  title: string;
  blurb: string;
  have: number;
  target: number;
  reward: { coins?: number; xp?: number };
  done: boolean;
};

/** Result of POST /api/claim-quest: the claimed quest's slot + reward paid. */
export type ClaimQuestResponse = {
  me: PlayerState;
  quest: { index: number; lap: number };
  gained: { coins: number; xp: number };
};

/** Splash summary (GET /api/summary). */
export type Summary = {
  /** Mod-set village name (empty string → display fallback "Hearthvale"). */
  villageName: string;
  /** Mod-set colour theme (drives the splash sky variant). */
  theme: VillageTheme;
  buildings: number;
  players: number;
  /** Current Village Hall level (0..5). */
  hallLevel: number;
  /** Percent progress toward the next Hall level's resource requirement. */
  landmarkPct: number;
  festival: FestivalCategory;
  readyForMe: number;
  /** Today's weather. */
  weather: Weather;
  /** The good with the highest price-to-base ratio (what the village needs). */
  hotGood: Good;
  /** That good's current market price. */
  hotPrice: number;
  /** Mod-set crest emblem index (0..5) — shown as a chip on the splash. */
  crest: number;
  /** Mod-set crest banner colour index (0..3). */
  crestColor: number;
};

/** The result of a collect: coins + xp + any goods produced into the wallet.
 * Every produced good (raw harvests, flour, planks, bricks) lands in `goods`
 * (the owner's wallet) — nothing is auto-sold; coins come only from the bakery/
 * house/manor. */
export type Gained = {
  coins: number;
  xp: number;
  goods: Partial<Record<Good, number>>;
};
