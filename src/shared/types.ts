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
 * quantity of another good or a one-off cosmetic (the golden roof).
 */
export type TraderOffer = {
  give: { good: Good; qty: number };
  get: { good: Good; qty: number } | { cosmetic: 'golden-roof' };
};

/** What a building's role is, for accrual + festival matching. */
export type BuildingRole = 'coins' | 'raw' | 'processor' | 'decor';

/** Festival categories the daily ballot rotates through. Note `processed`
 * (the festival) corresponds to the `processor` building role. */
export type FestivalCategory = 'coins' | 'raw' | 'processed' | 'decor';

export type BuildingId =
  | 'cottage'
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
};

export type CityState = {
  foundedAt: number;
  festival: FestivalCategory;
  festivalDate: string;
  landmarkStage: number;
  landmarkProgress: number;
  totalCollected: number;
  totalContributed: number;
  /** Today's rolled weather. */
  weather: Weather;
  /** UTC day (YYYY-MM-DD) the current weather belongs to. */
  weatherDate: string;
  /** Distinct-owner count — gates land expansion rings. */
  population: number;
  /** Naming-rights label chosen by each completed stage's top contributor. */
  stageNames: string[];
};

export type PlayerState = {
  id: string;
  name: string;
  coins: number;
  /**
   * @deprecated TODO(V2): remove — superseded by `wallet` (per-good balances).
   * Retained this task so the v1 server/client keep compiling and behaving.
   */
  supplies: number;
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
};

export type LeaderRow = { name: string; score: number; me: boolean };

/**
 * Realtime messages broadcast on the 'village' channel.
 */
export type VillageMessage =
  | { t: 'tile'; key: string; tile: TileState }
  | { t: 'city'; city: CityState }
  | { t: 'festival'; festival: FestivalCategory }
  | { t: 'stage'; stage: number };

export type StateResponse = {
  grid: Record<string, TileState>;
  city: CityState;
  me: PlayerState | null;
  now: number;
  top: LeaderRow[];
};

/** The result of a collect: coins + xp + any goods produced into the wallet. */
export type Gained = {
  coins: number;
  xp: number;
  goods: Partial<Record<Good, number>>;
};
