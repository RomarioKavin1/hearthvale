import { reddit } from '@devvit/web/server';
import type { FestivalCategory } from '../../shared/types';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: 'Hearthvale — build our village together 🏡',
  });
};

// TODO(V2): festival names for the v2 categories; V2 adds market report + weather.
const FESTIVAL_NAME: Record<FestivalCategory, string> = {
  coins: 'Coin',
  raw: 'Harvest',
  processed: 'Craft',
  decor: 'Decor',
};

/** The daily village post announcing which festival is active today. */
export const createDailyPost = async (
  festival: FestivalCategory,
  dayNumber: number
) => {
  const name = FESTIVAL_NAME[festival];
  return await reddit.submitCustomPost({
    title: `Hearthvale Day ${dayNumber} — 🎪 ${name} Festival! Come build.`,
  });
};
