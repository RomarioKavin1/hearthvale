import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { context } from '@devvit/web/server';
import {
  OpError,
  doBoost,
  doBuild,
  doBuy,
  doCheckIn,
  doClaim,
  doClaimQuest,
  doCollect,
  doCollectAll,
  doContribute,
  doDemolish,
  doNameStage,
  doSell,
  doShare,
  doTrade,
  doUpgrade,
  doVote,
  isBuildingId,
  isCategory,
  isGood,
  isProcessedGood,
  isShareKind,
  loadLeaderboards,
  loadState,
  loadSummary,
} from '../core/village';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

const fail = (
  message: string,
  status: ContentfulStatusCode
): [ErrorResponse, ContentfulStatusCode] => [{ status: 'error', message }, status];

const requireUser = (): string => {
  const userId = context.userId;
  if (!userId) throw new OpError(403, 'You must be logged in to play.');
  return userId;
};

const asCoord = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value;
};

api.get('/state', async (c) => {
  try {
    const state = await loadState(context.userId);
    return c.json(state);
  } catch (error) {
    console.error('GET /api/state failed:', error);
    return c.json(...fail('Failed to load village state.', 500));
  }
});

api.get('/summary', async (c) => {
  try {
    const summary = await loadSummary(context.userId);
    return c.json(summary);
  } catch (error) {
    console.error('GET /api/summary failed:', error);
    return c.json(...fail('Failed to load village summary.', 500));
  }
});

api.post('/claim', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ x?: unknown; y?: unknown }>();
    const x = asCoord(body.x);
    const y = asCoord(body.y);
    if (x === null || y === null) return c.json(...fail('Invalid tile coordinates.', 400));
    const result = await doClaim(userId, x, y);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/claim failed:', error);
    return c.json(...fail('Failed to claim tile.', 500));
  }
});

api.post('/build', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ x?: unknown; y?: unknown; buildingId?: unknown }>();
    const x = asCoord(body.x);
    const y = asCoord(body.y);
    if (x === null || y === null) return c.json(...fail('Invalid tile coordinates.', 400));
    if (!isBuildingId(body.buildingId)) {
      return c.json(...fail('Unknown building.', 400));
    }
    const result = await doBuild(userId, x, y, body.buildingId);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/build failed:', error);
    return c.json(...fail('Failed to build.', 500));
  }
});

api.post('/upgrade', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ x?: unknown; y?: unknown }>();
    const x = asCoord(body.x);
    const y = asCoord(body.y);
    if (x === null || y === null) return c.json(...fail('Invalid tile coordinates.', 400));
    const result = await doUpgrade(userId, x, y);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/upgrade failed:', error);
    return c.json(...fail('Failed to upgrade.', 500));
  }
});

api.post('/demolish', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ x?: unknown; y?: unknown }>();
    const x = asCoord(body.x);
    const y = asCoord(body.y);
    if (x === null || y === null) return c.json(...fail('Invalid tile coordinates.', 400));
    const result = await doDemolish(userId, x, y);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/demolish failed:', error);
    return c.json(...fail('Failed to demolish.', 500));
  }
});

api.post('/collect', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ x?: unknown; y?: unknown }>();
    const x = asCoord(body.x);
    const y = asCoord(body.y);
    if (x === null || y === null) return c.json(...fail('Invalid tile coordinates.', 400));
    const result = await doCollect(userId, x, y);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/collect failed:', error);
    return c.json(...fail('Failed to collect.', 500));
  }
});

api.post('/collect-all', async (c) => {
  try {
    const userId = requireUser();
    const result = await doCollectAll(userId);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/collect-all failed:', error);
    return c.json(...fail('Failed to collect.', 500));
  }
});

api.post('/checkin', async (c) => {
  try {
    const userId = requireUser();
    const result = await doCheckIn(userId);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/checkin failed:', error);
    return c.json(...fail('Failed to check in.', 500));
  }
});

api.post('/claim-quest', async (c) => {
  try {
    const userId = requireUser();
    const result = await doClaimQuest(userId);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/claim-quest failed:', error);
    return c.json(...fail('Failed to claim quest.', 500));
  }
});

api.post('/boost', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ x?: unknown; y?: unknown }>();
    const x = asCoord(body.x);
    const y = asCoord(body.y);
    if (x === null || y === null) return c.json(...fail('Invalid tile coordinates.', 400));
    const result = await doBoost(userId, x, y);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/boost failed:', error);
    return c.json(...fail('Failed to boost.', 500));
  }
});

/** Market trades are priced marginally in an O(qty) loop — bound them. */
const MAX_TRADE_QTY = 500;
/** Sanity bound for non-market quantities (keep contributions). */
const MAX_QTY = 1_000_000;

const asQty = (value: unknown, max: number): number | null => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > max
  ) {
    return null;
  }
  return value;
};

api.post('/contribute', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ good?: unknown; qty?: unknown }>();
    if (!isProcessedGood(body.good)) {
      return c.json(...fail('You can only contribute planks or bricks.', 400));
    }
    const qty = asQty(body.qty, MAX_QTY);
    if (qty === null) {
      return c.json(...fail('Contribution must be a whole number of at least 1.', 400));
    }
    const result = await doContribute(userId, body.good, qty);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/contribute failed:', error);
    return c.json(...fail('Failed to contribute.', 500));
  }
});

api.post('/sell', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ good?: unknown; qty?: unknown }>();
    if (!isGood(body.good)) return c.json(...fail('Unknown good.', 400));
    const qty = asQty(body.qty, MAX_TRADE_QTY);
    if (qty === null) {
      return c.json(
        ...fail(`Quantity must be a whole number between 1 and ${MAX_TRADE_QTY}.`, 400)
      );
    }
    const result = await doSell(userId, body.good, qty);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/sell failed:', error);
    return c.json(...fail('Failed to sell.', 500));
  }
});

api.post('/buy', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ good?: unknown; qty?: unknown }>();
    if (!isGood(body.good)) return c.json(...fail('Unknown good.', 400));
    const qty = asQty(body.qty, MAX_TRADE_QTY);
    if (qty === null) {
      return c.json(
        ...fail(`Quantity must be a whole number between 1 and ${MAX_TRADE_QTY}.`, 400)
      );
    }
    const result = await doBuy(userId, body.good, qty);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/buy failed:', error);
    return c.json(...fail('Failed to buy.', 500));
  }
});

api.post('/trade', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ offerIndex?: unknown }>();
    if (
      typeof body.offerIndex !== 'number' ||
      !Number.isInteger(body.offerIndex) ||
      body.offerIndex < 0 ||
      body.offerIndex > 2
    ) {
      return c.json(...fail('Invalid trade offer.', 400));
    }
    const result = await doTrade(userId, body.offerIndex);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/trade failed:', error);
    return c.json(...fail('Failed to trade.', 500));
  }
});

api.post('/name-stage', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ first?: unknown; second?: unknown }>();
    if (
      typeof body.first !== 'number' ||
      !Number.isInteger(body.first) ||
      typeof body.second !== 'number' ||
      !Number.isInteger(body.second)
    ) {
      return c.json(...fail('Invalid stage-name selection.', 400));
    }
    const result = await doNameStage(userId, body.first, body.second);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/name-stage failed:', error);
    return c.json(...fail('Failed to name stage.', 500));
  }
});

api.post('/vote', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ category?: unknown }>();
    if (!isCategory(body.category)) {
      return c.json(...fail('Unknown festival category.', 400));
    }
    const result = await doVote(userId, body.category);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/vote failed:', error);
    return c.json(...fail('Failed to record vote.', 500));
  }
});

api.post('/share', async (c) => {
  try {
    const userId = requireUser();
    const body = await c.req.json<{ kind?: unknown; value?: unknown }>();
    if (!isShareKind(body.kind)) {
      return c.json(...fail('Unknown share kind.', 400));
    }
    const value = asCoord(body.value);
    if (value === null) return c.json(...fail('Invalid milestone value.', 400));
    const result = await doShare(userId, body.kind, value);
    return c.json(result);
  } catch (error) {
    if (error instanceof OpError) return c.json(...fail(error.message, error.status));
    console.error('POST /api/share failed:', error);
    return c.json(...fail('Failed to share.', 500));
  }
});

api.get('/leaderboards', async (c) => {
  try {
    const result = await loadLeaderboards(context.userId);
    return c.json(result);
  } catch (error) {
    console.error('GET /api/leaderboards failed:', error);
    return c.json(...fail('Failed to load leaderboards.', 500));
  }
});
