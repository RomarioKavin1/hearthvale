import { describe, expect, it } from 'vitest';
import type { Weather } from '../types';
import { offersForDay, weatherForDay } from './trader';

const dayOf = (i: number): string =>
  new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

describe('weatherForDay', () => {
  it('is deterministic for the same date string', () => {
    expect(weatherForDay('2026-07-07')).toBe(weatherForDay('2026-07-07'));
    expect(weatherForDay('2026-01-15')).toBe(weatherForDay('2026-01-15'));
  });

  it('always returns one of the four weathers', () => {
    const kinds: Weather[] = ['sunny', 'rain', 'clear', 'harvestmoon'];
    for (let i = 0; i < 40; i += 1) {
      expect(kinds).toContain(weatherForDay(dayOf(i)));
    }
  });

  it('has a roughly 45% sunny distribution over 1000 days', () => {
    let sunny = 0;
    let harvest = 0;
    for (let i = 0; i < 1000; i += 1) {
      const w = weatherForDay(dayOf(i));
      if (w === 'sunny') sunny += 1;
      if (w === 'harvestmoon') harvest += 1;
    }
    expect(sunny).toBeGreaterThanOrEqual(350);
    expect(sunny).toBeLessThanOrEqual(550);
    // Harvest moon is the rare (5%) bucket.
    expect(harvest).toBeGreaterThanOrEqual(20);
    expect(harvest).toBeLessThanOrEqual(100);
  });
});

describe('offersForDay', () => {
  it('is deterministic for the same date string', () => {
    expect(offersForDay('2026-07-07')).toEqual(offersForDay('2026-07-07'));
  });

  it('differs across days (not a constant)', () => {
    const a = JSON.stringify(offersForDay('2026-07-07'));
    let differs = false;
    for (let i = 0; i < 20; i += 1) {
      if (JSON.stringify(offersForDay(dayOf(i))) !== a) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('always yields exactly 3 well-formed offers', () => {
    for (let i = 0; i < 40; i += 1) {
      const offers = offersForDay(dayOf(i));
      expect(offers).toHaveLength(3);
      for (const o of offers) {
        expect(typeof o.give.good).toBe('string');
        expect(o.give.qty).toBeGreaterThan(0);
      }
    }
  });

  it('offers a golden-roof cosmetic roughly 15% of days in slot 3', () => {
    let golden = 0;
    for (let i = 0; i < 1000; i += 1) {
      const third = offersForDay(dayOf(i))[2]!;
      if ('cosmetic' in third.get) golden += 1;
    }
    expect(golden).toBeGreaterThanOrEqual(90);
    expect(golden).toBeLessThanOrEqual(220);
  });
});
