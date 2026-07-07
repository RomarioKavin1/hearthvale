export type BuildingCategory = 'coins' | 'supplies' | 'decor';

export type BuildingId =
  | 'cottage'
  | 'bakery'
  | 'garden'
  | 'market'
  | 'sawmill'
  | 'tavern'
  | 'lantern'
  | 'topiary'
  | 'mill'
  | 'forge'
  | 'manor'
  | 'fountain';

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
};

export type CityState = {
  foundedAt: number;
  festival: BuildingCategory;
  festivalDate: string;
  landmarkStage: number;
  landmarkProgress: number;
  totalCollected: number;
  totalContributed: number;
};

export type PlayerState = {
  id: string;
  name: string;
  coins: number;
  supplies: number;
  xp: number;
  level: number;
  plots: number;
  streak: number;
  lastCheckIn: string;
  boostsToday: number;
};

export type LeaderRow = { name: string; score: number; me: boolean };

export type StateResponse = {
  grid: Record<string, TileState>;
  city: CityState;
  me: PlayerState | null;
  now: number;
  top: LeaderRow[];
};

export type Gained = { coins: number; supplies: number; xp: number };
