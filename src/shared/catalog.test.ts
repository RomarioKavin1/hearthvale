import { describe, expect, it } from 'vitest';
import { MAX_VILLAGE_NAME, isValidVillageName } from './catalog';

describe('isValidVillageName', () => {
  it('accepts an ordinary name', () => {
    expect(isValidVillageName('Hearthvale')).toBe(true);
  });

  it('accepts the empty string (clears the name → fallback)', () => {
    expect(isValidVillageName('')).toBe(true);
  });

  it('accepts numbers, spaces, apostrophes and hyphens', () => {
    expect(isValidVillageName("King's-Landing 2")).toBe(true);
  });

  it('accepts unicode letters', () => {
    expect(isValidVillageName('Zürich')).toBe(true);
    expect(isValidVillageName('Élan Café')).toBe(true);
    expect(isValidVillageName('東京')).toBe(true);
  });

  it('accepts a name at exactly the length limit', () => {
    expect(isValidVillageName('a'.repeat(MAX_VILLAGE_NAME))).toBe(true);
  });

  it('rejects a name longer than the length limit', () => {
    expect(isValidVillageName('a'.repeat(MAX_VILLAGE_NAME + 1))).toBe(false);
  });

  it('rejects disallowed characters', () => {
    expect(isValidVillageName('<script>')).toBe(false);
    expect(isValidVillageName('bad@name')).toBe(false);
    expect(isValidVillageName('semi;colon')).toBe(false);
  });
});
