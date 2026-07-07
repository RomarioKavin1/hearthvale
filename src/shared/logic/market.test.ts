import { describe, expect, it } from 'vitest';
import { buyValue, priceFor, pricesFor, sellValue } from './market';
import { emptyStockpile } from './economy';

describe('priceFor', () => {
  it('clamps the multiplier to 1.8 when the stockpile is empty', () => {
    // 1.9 - 0/120 = 1.9 -> clamped to 1.8; wheat base 3 -> 3 * 1.8 = 5.4 -> 5.
    expect(priceFor(0, 'wheat')).toBe(5);
    // planks base 12 -> 12 * 1.8 = 21.6 -> 22.
    expect(priceFor(0, 'planks')).toBe(22);
    // bricks base 15 -> 15 * 1.8 = 27.
    expect(priceFor(0, 'bricks')).toBe(27);
  });

  it('prices at 0.9x the base when stock sits exactly on target', () => {
    // wheat target 120: 1.9 - 1 = 0.9; 3 * 0.9 = 2.7 -> 3.
    expect(priceFor(120, 'wheat')).toBe(3);
    // planks target 60: 12 * 0.9 = 10.8 -> 11.
    expect(priceFor(60, 'planks')).toBe(11);
    // bricks target 60: 15 * 0.9 = 13.4999… (IEEE754) -> rounds to 13.
    expect(priceFor(60, 'bricks')).toBe(13);
  });

  it('clamps the multiplier to 0.6 at twice the target stock', () => {
    // 1.9 - 2 = -0.1 -> clamped to 0.6; wheat 3 * 0.6 = 1.8 -> 2.
    expect(priceFor(240, 'wheat')).toBe(2);
    // planks 12 * 0.6 = 7.2 -> 7.
    expect(priceFor(120, 'planks')).toBe(7);
  });

  it('interpolates between the clamps at partial stock', () => {
    // planks stock 30 of target 60: 1.9 - 0.5 = 1.4; 12 * 1.4 = 16.8 -> 17.
    expect(priceFor(30, 'planks')).toBe(17);
  });
});

describe('sellValue', () => {
  it('is qty x the pre-trade price (price fixed once per trade)', () => {
    // 10 wheat at empty stock (price 5) = 50.
    expect(sellValue(10, 0, 'wheat')).toBe(50);
    // 3 planks at stock 60 (price 11) = 33.
    expect(sellValue(3, 60, 'planks')).toBe(33);
  });
});

describe('buyValue', () => {
  it('is ceil(price x 1.25) x qty', () => {
    // wheat empty: price 5; ceil(6.25) = 7; x3 = 21.
    expect(buyValue(3, 0, 'wheat')).toBe(21);
    // planks stock 60: price 11; ceil(13.75) = 14; x2 = 28.
    expect(buyValue(2, 60, 'planks')).toBe(28);
  });
});

describe('pricesFor', () => {
  it('maps every good to its current price', () => {
    const prices = pricesFor(emptyStockpile());
    expect(prices.wheat).toBe(5);
    expect(prices.planks).toBe(22);
    expect(prices.bricks).toBe(27);
  });
});
