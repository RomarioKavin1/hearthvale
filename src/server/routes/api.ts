import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { context } from '@devvit/web/server';
import {
  OpError,
  doBuild,
  doClaim,
  doCollect,
  doCollectAll,
  doUpgrade,
  isBuildingId,
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
