import { reddit } from '@devvit/web/server';
import type { BuildingCategory } from '../../shared/types';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: 'Hearthvale — build our village together 🏡',
  });
};

const FESTIVAL_NAME: Record<BuildingCategory, string> = {
  coins: 'Coin',
  supplies: 'Supply',
  decor: 'Decor',
};

/** The daily village post announcing which festival is active today. */
export const createDailyPost = async (
  festival: BuildingCategory,
  dayNumber: number
) => {
  const name = FESTIVAL_NAME[festival];
  return await reddit.submitCustomPost({
    title: `Hearthvale Day ${dayNumber} — 🎪 ${name} Festival! Come build.`,
  });
};
