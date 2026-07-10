import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from '../../shared/catalog';
import { tileKey } from '../../shared/logic/grid';
import { RIVER_TILES } from '../../shared/logic/expansion';
import {
  backgroundIslets,
  backgroundStars,
  bandBlockFor,
  castleParts,
  decorAt,
  mulberry32,
  networkPathPiece,
  pathNetwork,
  rimPiece,
  riverPiece,
  riverPieceAt,
  terrainFor,
  treeClusters,
} from './render';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('produces values in [0,1) and differs across seeds', () => {
    const r = mulberry32(999);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('terrainFor', () => {
  it('is pure — same seed + coords yield identical terrain', () => {
    const seed = 1_700_000_000_000;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        expect(terrainFor(seed, x, y)).toEqual(terrainFor(seed, x, y));
      }
    }
  });

  it('quantizes height to 0, 1 or 2', () => {
    const seed = 42;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const { height } = terrainFor(seed, x, y);
        expect([0, 1, 2]).toContain(height);
      }
    }
  });

  it('varies the landscape between two different village seeds', () => {
    const sig = (seed: number): string => {
      let s = '';
      for (let y = 0; y < GRID_SIZE; y++)
        for (let x = 0; x < GRID_SIZE; x++) {
          const t = terrainFor(seed, x, y);
          s += `${t.height}${t.patch[0]}${t.decor ?? '-'}|`;
        }
      return s;
    };
    expect(sig(111)).not.toBe(sig(222));
  });

  it('only ever emits known ground/decor kinds', () => {
    const seed = 7;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const t = terrainFor(seed, x, y);
        expect(['grass', 'dirt']).toContain(t.patch);
        if (t.decor !== null) {
          expect(t.decor).toMatch(/^(tree-|rocks-)/);
        }
        // Dirt patches never carry a decor sprite (they are worn ground).
        if (t.patch === 'dirt') expect(t.decor).toBeNull();
      }
    }
  });
});

describe('bandBlockFor', () => {
  it('maps seeded height to a raised block sprite', () => {
    expect(bandBlockFor(0)).toBe('grass-center');
    expect(bandBlockFor(1)).toBe('grass-block');
    expect(bandBlockFor(2)).toBe('cliff-top');
  });
});

describe('void background layers', () => {
  it('are deterministic per seed and parked well outside the map bounds', () => {
    // The map's iso footprint is roughly sx ∈ [−1088,1088], sy ∈ [0,1088];
    // require every islet clear of a padded box around it.
    const seed = 1_700_000_000_000;
    const isletsA = backgroundIslets(seed);
    const isletsB = backgroundIslets(seed);
    expect(isletsA).toEqual(isletsB);
    expect(isletsA).toHaveLength(4);
    for (const isl of isletsA) {
      expect(isl.ground).toBe('grass-block');
      expect(isl.decor).toMatch(/^(tree-|rocks-)/);
      expect(isl.scale).toBeGreaterThanOrEqual(0.5);
      expect(isl.scale).toBeLessThanOrEqual(0.65);
      expect(isl.alpha).toBeCloseTo(0.85);
      // Outside the padded island box (|sx| or offset-sy beyond the footprint).
      const outside = Math.abs(isl.sx) > 1200 || Math.abs(isl.sy - 544) > 700;
      expect(outside).toBe(true);
    }

    const starsA = backgroundStars(seed);
    expect(starsA).toEqual(backgroundStars(seed));
    expect(starsA).toHaveLength(24);
    const twinkles = starsA.filter((s) => s.twinkle).length;
    expect(twinkles).toBe(8); // exactly a third
    for (const s of starsA) {
      expect(s.alpha).toBeGreaterThanOrEqual(0.25);
      expect(s.alpha).toBeLessThanOrEqual(0.5);
    }

    // A different village seed yields a different layout.
    expect(backgroundIslets(222)).not.toEqual(backgroundIslets(111));
  });
});

describe('pathNetwork', () => {
  const seeds = [1, 42, 1_700_000_000_000, 987654321];

  it('is deterministic per seed and varies across seeds', () => {
    for (const s of seeds) {
      expect([...pathNetwork(s)].sort()).toEqual([...pathNetwork(s)].sort());
    }
    expect([...pathNetwork(111)].sort()).not.toEqual(
      [...pathNetwork(222)].sort()
    );
  });

  it('never enters the plaza block and stays on the grid', () => {
    for (const s of seeds) {
      for (const key of pathNetwork(s)) {
        const [xs, ys] = key.split(',');
        const x = Number(xs);
        const y = Number(ys);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(GRID_SIZE);
        expect(y).toBeLessThan(GRID_SIZE);
        expect(x >= 7 && x <= 10 && y >= 7 && y <= 10).toBe(false);
      }
    }
  });

  it('always crosses the river down the west spoke (bridge guarantee)', () => {
    for (const s of seeds) {
      const net = pathNetwork(s);
      expect(net.has('1,8') || net.has('1,9')).toBe(true);
    }
  });

  it('routes every network tile to a connected piece', () => {
    for (const s of seeds) {
      const net = pathNetwork(s);
      for (const key of net) {
        const [xs, ys] = key.split(',');
        const p = networkPathPiece(net, Number(xs), Number(ys));
        expect(p.key).toMatch(/^grass-path/);
      }
    }
  });
});

describe('treeClusters / decorAt', () => {
  it('yields 3 deterministic clusters clear of the plaza block', () => {
    const a = treeClusters(1234);
    expect(a).toEqual(treeClusters(1234));
    expect(a).toHaveLength(3);
    for (const c of a) {
      expect(c.cx >= 7 && c.cx <= 10 && c.cy >= 7 && c.cy <= 10).toBe(false);
      expect([1, 2]).toContain(c.r);
      expect(c.species).toMatch(/^tree-/);
    }
  });

  it('is pure and only emits tree/rock sprites, dense at cluster centres', () => {
    const seed = 777;
    const clusters = treeClusters(seed);
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const d = decorAt(seed, clusters, x, y);
        expect(d).toBe(decorAt(seed, clusters, x, y));
        if (d !== null) expect(d).toMatch(/^(tree-|rocks-)/);
      }
    }
    // Every cluster centre carries its lead species (or a rock variant).
    for (const c of clusters) {
      expect(decorAt(seed, clusters, c.cx, c.cy)).not.toBeNull();
    }
  });
});

describe('rimPiece', () => {
  const seed = 555;
  const lo = 5;
  const hi = 11;

  it('returns null outside the 2-tile band and never inside the ring', () => {
    expect(rimPiece(seed, lo, lo, lo, hi)).toBeNull(); // inside
    expect(rimPiece(seed, lo - 3, 8, lo, hi)).toBeNull(); // beyond band
  });

  it('slopes on the north/west lip, raised plateau behind, cliffs south/east', () => {
    // North lip straight edge → slope wedge at ground level.
    const north = rimPiece(seed, 8, lo - 1, lo, hi);
    expect(north?.key).toBe('grass-slope');
    expect(north?.dy).toBe(0);
    // North-west corner lip → convex wedge.
    expect(rimPiece(seed, lo - 1, lo - 1, lo, hi)?.key).toBe(
      'grass-slope-convex'
    );
    // Behind the lip: a raised grass plateau top.
    const top = rimPiece(seed, 8, lo - 2, lo, hi);
    expect(top?.key).toBe('grass-block');
    expect(top?.dy).toBe(-45);
    // South face: stepped rocky cliffs.
    expect(rimPiece(seed, 8, hi + 1, lo, hi)?.key).toBe('cliff-top');
    expect(rimPiece(seed, 8, hi + 2, lo, hi)?.dy).toBe(-45);
  });

  it('drops a seeded share of the outermost corners (island silhouette)', () => {
    let dropped = 0;
    let total = 0;
    for (let s = 0; s < 40; s++) {
      for (const [cx, cy] of [
        [lo - 2, lo - 2],
        [hi + 2, hi + 2],
        [lo - 2, hi + 2],
        [hi + 2, lo - 2],
      ] as const) {
        total++;
        if (rimPiece(s, cx, cy, lo, hi) === null) dropped++;
      }
    }
    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeLessThan(total);
  });
});

describe('riverPiece / riverPieceAt', () => {
  it('routes the L-shaped river with exact pieces', () => {
    // Northern terminus: the spring waterfall.
    expect(riverPiece(6, 1).key).toBe('water-fall');
    // Horizontal run: native x-run straights.
    expect(riverPiece(4, 1)).toEqual({ key: 'grass-river', flipX: false });
    // The single east+south elbow.
    expect(riverPiece(1, 1)).toEqual({
      key: 'grass-river-corner',
      flipX: false,
    });
    // Vertical run: flipped y-run straights.
    expect(riverPiece(1, 6)).toEqual({ key: 'grass-river', flipX: true });
    // Southern terminus: the widening pool.
    expect(riverPiece(1, 11).key).toBe('grass-river-end');
  });

  it('bridges wherever the path network crosses, oriented to the run', () => {
    const net = new Set([tileKey(1, 8), tileKey(4, 1)]);
    expect(riverPieceAt(net, 1, 8)).toEqual({
      key: 'grass-river-bridge',
      flipX: true, // vertical run under the bridge
    });
    expect(riverPieceAt(net, 4, 1)).toEqual({
      key: 'grass-river-bridge',
      flipX: false, // horizontal run under the bridge
    });
    expect(riverPieceAt(net, 1, 6).key).toBe('grass-river');
  });

  it('covers every river tile with a river-family sprite', () => {
    const net = pathNetwork(42);
    for (const t of RIVER_TILES) {
      const p = riverPieceAt(net, t.x, t.y);
      expect(p.key).toMatch(/^(grass-river|water-fall)/);
    }
  });
});

describe('castleParts', () => {
  it('is PRESENT from level 0 and grows monotonically in mass', () => {
    let prev = 0;
    for (let stage = 0; stage <= 5; stage++) {
      const parts = castleParts(stage);
      expect(parts.length).toBeGreaterThan(prev);
      prev = parts.length;
      // Every stage keeps the front gate anchoring the composition.
      expect(parts.some((p) => p.key === 'castle-gate')).toBe(true);
    }
  });

  it('level 0 reads as a town centre under construction', () => {
    const keys = castleParts(0).map((p) => p.key);
    expect(keys).toContain('castle-gate');
    expect(keys).toContain('structure-arch');
  });

  it('the full keep crowns an elevated centre with the purple spire', () => {
    const parts = castleParts(5);
    const spireBase = parts.find((p) => p.key === 'castle-tower-center');
    const spireCap = parts.find((p) => p.key === 'roof-point-purple');
    expect(spireBase?.lift).toBeGreaterThan(0);
    expect(spireCap?.lift).toBeGreaterThan(spireBase?.lift ?? 0);
    // Three capped towers plus the capped gatehouse ring the spire.
    expect(parts.filter((p) => p.key === 'castle-tower-top')).toHaveLength(4);
    expect(parts.filter((p) => p.key === 'castle-tower')).toHaveLength(3);
  });

  it('clamps above the max stage', () => {
    expect(castleParts(9)).toEqual(castleParts(5));
  });
});
