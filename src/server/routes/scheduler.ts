import { Hono } from 'hono';
import type { BuildingCategory } from '../../shared/types';
import { createDailyPost } from '../core/post';
import { runFestivalRotation } from '../core/village';

export const scheduler = new Hono();

type CycleResponse = {
  status: 'ok' | 'partial';
  detail: string;
};

/**
 * The daily cycle: tally yesterday's ballot into today's festival, then spin
 * up the daily post. Each step is wrapped so a failure is logged and still
 * returns HTTP 200 with a status — the platform scheduler retries on non-200,
 * and we never want to retry-spam post creation.
 */
scheduler.post('/daily-cycle', async (c) => {
  const now = Date.now();

  let rotation: { festival: BuildingCategory; dayNumber: number };
  try {
    rotation = await runFestivalRotation(now);
  } catch (error) {
    console.error('daily-cycle: festival rotation failed:', error);
    return c.json<CycleResponse>(
      { status: 'partial', detail: 'festival rotation failed' },
      200
    );
  }

  const { festival, dayNumber } = rotation;
  try {
    await createDailyPost(festival, dayNumber);
  } catch (error) {
    console.error('daily-cycle: daily post creation failed:', error);
    return c.json<CycleResponse>(
      {
        status: 'partial',
        detail: `festival set to ${festival}; daily post failed`,
      },
      200
    );
  }

  return c.json<CycleResponse>(
    { status: 'ok', detail: `day ${dayNumber} ${festival} festival` },
    200
  );
});
