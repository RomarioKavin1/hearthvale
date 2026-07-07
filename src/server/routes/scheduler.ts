import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type {
  FestivalCategory,
  Prices,
  Stockpile,
  TraderOffer,
  Weather,
} from '../../shared/types';
import { createDailyPost, marketReportText } from '../core/post';
import { runFestivalRotation } from '../core/village';

export const scheduler = new Hono();

type CycleResponse = {
  status: 'ok' | 'partial';
  detail: string;
};

/**
 * The daily cycle: tally yesterday's ballot into today's festival, roll today's
 * weather, spin up the daily post, then best-effort attach a market-report
 * comment. Each step is wrapped so a failure is logged and still returns HTTP
 * 200 with a status — the platform scheduler retries on non-200, and we never
 * want to retry-spam post creation.
 */
scheduler.post('/daily-cycle', async (c) => {
  const now = Date.now();

  let rotation: {
    festival: FestivalCategory;
    weather: Weather;
    dayNumber: number;
    stockpile: Stockpile;
    prices: Prices;
    offers: TraderOffer[];
  };
  try {
    rotation = await runFestivalRotation(now);
  } catch (error) {
    console.error('daily-cycle: festival rotation failed:', error);
    return c.json<CycleResponse>(
      { status: 'partial', detail: 'festival rotation failed' },
      200
    );
  }

  const { festival, weather, dayNumber, prices, offers } = rotation;
  let post: Awaited<ReturnType<typeof createDailyPost>>;
  try {
    post = await createDailyPost(festival, dayNumber, weather);
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

  // Best-effort market-report comment on the fresh post.
  try {
    await reddit.submitComment({
      id: post.id,
      text: marketReportText(prices, offers),
      runAs: 'APP',
    });
  } catch (error) {
    console.error('daily-cycle: market report comment failed:', error);
  }

  return c.json<CycleResponse>(
    {
      status: 'ok',
      detail: `day ${dayNumber} ${festival} festival, ${weather} weather`,
    },
    200
  );
});
