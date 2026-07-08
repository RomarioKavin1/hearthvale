import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import { createPost } from '../core/post';
import { putCity, putStockpile } from '../core/store';
import { emptyStockpile } from '../../shared/logic/economy';
import { weatherForDay } from '../../shared/logic/trader';

export const triggers = new Hono();

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

triggers.post('/on-app-install', async (c) => {
  try {
    const input = await c.req.json<OnAppInstallRequest>();

    // App-install triggers are delivered at-least-once. Guard against creating
    // a second post (or re-seeding) on redelivery.
    const already = await redis.get('installed');
    if (already) {
      return c.json<TriggerResponse>(
        {
          status: 'success',
          message: `Already installed in ${context.subredditName} (trigger: ${input.type})`,
        },
        200
      );
    }

    await redis.set('installed', '1');
    const today = todayUtc();
    await putCity({
      foundedAt: Date.now(),
      festival: 'coins',
      festivalDate: today,
      hallLevel: 0,
      stagePlanks: 0,
      stageBricks: 0,
      totalCollected: 0,
      totalContributed: 0,
      weather: weatherForDay(today),
      weatherDate: today,
      population: 0,
      stageNames: [],
    });
    await putStockpile(emptyStockpile());
    const post = await createPost();

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Post created in subreddit ${context.subredditName} with id ${post.id} (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`Error during app install: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to bootstrap village',
      },
      400
    );
  }
});
