import type { Good, Prices, Stockpile } from '../types';
import { MARKET } from '../catalog';
import { GOODS } from './economy';

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

/**
 * Current market price of a good given the village stockpile level:
 * `round(base × clamp(1.9 − stock/target, 0.6, 1.8))`. Scarcity (low stock)
 * pushes the price up to 1.8× base; a glut (2× target) drops it to 0.6×.
 */
export const priceFor = (stock: number, good: Good): number => {
  const m = MARKET[good];
  return Math.round(m.base * clamp(1.9 - stock / m.target, 0.6, 1.8));
};

/**
 * Coins earned selling `qty` of a good into the stockpile.
 *
 * SIMPLIFICATION: the price is computed ONCE per trade at the pre-trade stock
 * level (`stockBefore`), not re-derived after each marginal unit. The design
 * doc's "recompute on trade" is honoured at the granularity of a whole trade —
 * the next trade sees the moved price. This keeps the maths legible and the
 * client/server in exact agreement.
 */
export const sellValue = (
  qty: number,
  stockBefore: number,
  good: Good
): number => priceFor(stockBefore, good) * qty;

/**
 * Coins it costs to buy `qty` of a good from the stockpile — a 25% markup over
 * the sell price, rounded up per unit. Price is fixed at the pre-trade stock
 * (same simplification as `sellValue`).
 */
export const buyValue = (
  qty: number,
  stockBefore: number,
  good: Good
): number => Math.ceil(priceFor(stockBefore, good) * 1.25) * qty;

/** The full current price list derived from a stockpile. */
export const pricesFor = (stockpile: Stockpile): Prices => {
  const prices: Prices = {
    wheat: 0,
    logs: 0,
    stone: 0,
    flour: 0,
    planks: 0,
    bricks: 0,
  };
  for (const g of GOODS) prices[g] = priceFor(stockpile[g], g);
  return prices;
};
