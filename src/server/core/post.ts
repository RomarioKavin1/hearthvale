import { reddit } from '@devvit/web/server';
import type {
  FestivalCategory,
  Prices,
  TraderOffer,
  Weather,
} from '../../shared/types';
import { GOODS } from '../../shared/logic/economy';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: 'Hearthvale — build our village together',
  });
};

const FESTIVAL_NAME: Record<FestivalCategory, string> = {
  coins: 'Coin',
  raw: 'Harvest',
  processed: 'Craft',
  decor: 'Decor',
};

const WEATHER_NAME: Record<Weather, string> = {
  sunny: 'Sunny',
  rain: 'Rain',
  clear: 'Clear',
  harvestmoon: 'Harvest Moon',
};

/** Human label for a festival category. */
export const festivalName = (festival: FestivalCategory): string =>
  FESTIVAL_NAME[festival];

/** Human label for a weather kind. */
export const weatherName = (weather: Weather): string => WEATHER_NAME[weather];

/**
 * The daily village post. Title carries the day number, the day's festival, and
 * today's weather — e.g. `Hearthvale Day 4 — Harvest Festival · Rain`.
 */
export const createDailyPost = async (
  festival: FestivalCategory,
  dayNumber: number,
  weather: Weather
) => {
  return await reddit.submitCustomPost({
    title: `Hearthvale Day ${dayNumber} — ${festivalName(festival)} Festival · ${weatherName(weather)}`,
  });
};

/** A one-line market report: current price of every good, then trader offers. */
export const marketReportText = (
  prices: Prices,
  offers: TraderOffer[]
): string => {
  const priceLine = GOODS.map((g) => `${g} ${prices[g]}`).join(' · ');
  const offerLine = offers
    .map((o) =>
      'cosmetic' in o.get
        ? `${o.give.qty} ${o.give.good} for a golden roof`
        : `${o.give.qty} ${o.give.good} for ${o.get.qty} ${o.get.good}`
    )
    .join(' | ');
  return `Market report: ${priceLine} | Trader offers: ${offerLine}`;
};
