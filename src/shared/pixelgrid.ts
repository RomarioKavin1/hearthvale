/**
 * Pure, Phaser-free pixel-grid model shared by the runtime art factory.
 *
 * A {@link PixelGrid} is an array of equal-length strings; each character is a
 * single logical pixel and maps to a hex colour through a {@link Legend}. The
 * character '.' is reserved for "transparent" and is always legal, even when it
 * is absent from the legend.
 */
export type PixelGrid = string[];

/** Maps a single-character grid key to a hex colour string. */
export type Legend = Record<string, string>;

export type GridSize = { w: number; h: number };

/** Transparent pixel — never drawn, always allowed. */
export const TRANSPARENT = '.';

/**
 * Validate a pixel grid against its legend.
 *
 * Throws when:
 *  - the grid is empty or any row has zero width,
 *  - rows are ragged (differing widths),
 *  - a non-'.' character is missing from the legend.
 *
 * @returns the grid dimensions `{ w, h }` on success.
 */
export function validateGrid(rows: PixelGrid, legend: Legend): GridSize {
  const h = rows.length;
  if (h === 0) {
    throw new Error('validateGrid: grid is empty');
  }

  const first = rows[0] ?? '';
  const w = first.length;
  if (w === 0) {
    throw new Error('validateGrid: rows have zero width');
  }

  for (let y = 0; y < h; y++) {
    const row = rows[y];
    if (row === undefined || row.length !== w) {
      throw new Error(
        `validateGrid: ragged rows — expected width ${w}, row ${y} has width ${row?.length ?? 0}`
      );
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === undefined || ch === TRANSPARENT) continue;
      if (!(ch in legend)) {
        throw new Error(
          `validateGrid: character '${ch}' at (${x},${y}) is missing from the legend`
        );
      }
    }
  }

  return { w, h };
}
