import type {
  FestivalCategory,
  BuildingId,
  CityState,
  Gained,
  Good,
  LeaderRow,
  PlayerState,
  Prices,
  StateResponse,
  Stockpile,
  Summary,
  TileState,
} from '../shared/types';

/**
 * Thin typed fetch wrappers around every server endpoint. Each parses the JSON
 * body and throws `Error(message)` when the response is not ok or the body is
 * an `{ status: 'error', message }` envelope, so callers can `try/catch` a
 * human-readable message. Success shapes are declared to mirror the server's
 * return types in `src/server/core/village.ts`; no type casts are used —
 * `res.json()`'s value flows through unannotated and error bodies are inspected
 * with `in`-narrowing.
 */

export type TileResult = { tile: TileState; me: PlayerState };
export type CollectResult = { tile: TileState; me: PlayerState; gained: Gained };
export type CollectAllResult = {
  tiles: Record<string, TileState>;
  me: PlayerState;
  gained: Gained;
};
export type CheckInResult = {
  me: PlayerState;
  gained: { coins: number; xp: number };
};
export type ContributeResult = { city: CityState; me: PlayerState };
export type VoteResult = { counts: Record<FestivalCategory, number> };
export type LeaderboardsResult = {
  value: LeaderRow[];
  earned: LeaderRow[];
  contrib: LeaderRow[];
};
export type ShareKind = 'levelup' | 'stage';
export type ShareResult = { ok: true };
export type SummaryResult = Summary;
export type MarketResult = {
  me: PlayerState;
  stockpile: Stockpile;
  prices: Prices;
};
export type TradeResult = {
  me: PlayerState;
  tile?: { key: string; tile: TileState };
};
export type NameStageResult = { city: CityState };

/** True when a parsed body is the server's `{ status: 'error', … }` envelope. */
const isErrorBody = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  'status' in body &&
  body.status === 'error';

/** Pull a `message` string out of a parsed body, else the given fallback. */
const messageOf = (body: unknown, fallback: string): string => {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof body.message === 'string'
  ) {
    return body.message;
  }
  return fallback;
};

/** Parse a response body as JSON, tolerating an empty/invalid body. */
async function parseBody(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  fallback = 'Something went wrong.'
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('Network error — check your connection and try again.');
  }

  const body = await parseBody(res);
  if (!res.ok || isErrorBody(body)) {
    throw new Error(messageOf(body, fallback));
  }
  return body;
}

const post = <T>(path: string, payload?: unknown): Promise<T> =>
  request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });

export const api = {
  state: (): Promise<StateResponse> =>
    request('/api/state', undefined, 'Failed to load the village.'),

  claim: (x: number, y: number): Promise<TileResult> =>
    post('/api/claim', { x, y }),

  build: (x: number, y: number, buildingId: BuildingId): Promise<TileResult> =>
    post('/api/build', { x, y, buildingId }),

  upgrade: (x: number, y: number): Promise<TileResult> =>
    post('/api/upgrade', { x, y }),

  demolish: (x: number, y: number): Promise<TileResult> =>
    post('/api/demolish', { x, y }),

  collect: (x: number, y: number): Promise<CollectResult> =>
    post('/api/collect', { x, y }),

  collectAll: (): Promise<CollectAllResult> => post('/api/collect-all'),

  checkin: (): Promise<CheckInResult> => post('/api/checkin'),

  boost: (x: number, y: number): Promise<TileResult> =>
    post('/api/boost', { x, y }),

  contribute: (
    good: 'planks' | 'bricks',
    qty: number
  ): Promise<ContributeResult> => post('/api/contribute', { good, qty }),

  sell: (good: Good, qty: number): Promise<MarketResult> =>
    post('/api/sell', { good, qty }),

  buy: (good: Good, qty: number): Promise<MarketResult> =>
    post('/api/buy', { good, qty }),

  trade: (offerIndex: number): Promise<TradeResult> =>
    post('/api/trade', { offerIndex }),

  nameStage: (first: number, second: number): Promise<NameStageResult> =>
    post('/api/name-stage', { first, second }),

  vote: (category: FestivalCategory): Promise<VoteResult> =>
    post('/api/vote', { category }),

  share: (kind: ShareKind, value: number): Promise<ShareResult> =>
    post('/api/share', { kind, value }),

  leaderboards: (): Promise<LeaderboardsResult> =>
    request('/api/leaderboards', undefined, 'Failed to load leaderboards.'),

  summary: (): Promise<SummaryResult> =>
    request('/api/summary', undefined, 'Failed to load the village summary.'),
};
