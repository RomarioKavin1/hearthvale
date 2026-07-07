import type { Scene } from 'phaser';
import { PAL } from '../../shared/palette';
import { drawPixelTexture, Painter, SCALE } from './pixels';
import type { Legend } from './pixels';

/** Logical diamond size, and the final on-screen size after nearest-neighbour scale. */
const DIA_W = 32;
const DIA_H = 16;
export const TILE_W = DIA_W * SCALE; // 96
export const TILE_H = DIA_H * SCALE; // 48

const L: Legend = {
  g: PAL.grass,
  G: PAL.grassLight,
  d: PAL.grassDark,
  p: PAL.path,
  P: PAL.pathDark,
  s: PAL.stone,
  S: PAL.stoneDark,
  o: PAL.glow,
  c: PAL.cream,
  a: PAL.accent,
  f: PAL.leaf,
};

const inDiamond = (x: number, y: number): boolean =>
  Math.abs(x - (DIA_W - 1) / 2) / (DIA_W / 2) + Math.abs(y - (DIA_H - 1) / 2) / (DIA_H / 2) <= 1;

/**
 * Fill the iso diamond with `base`, then bevel it: top-left facet in `light`,
 * bottom-right facet in `dark`, so a field of tiles reads with depth.
 */
function diamond(base: string, light: string, dark: string): Painter {
  const p = new Painter(DIA_W, DIA_H);
  for (let y = 0; y < DIA_H; y++) {
    for (let x = 0; x < DIA_W; x++) {
      if (!inDiamond(x, y)) continue;
      const bottom = !inDiamond(x, y + 1) || !inDiamond(x + 1, y);
      const top = !inDiamond(x, y - 1) || !inDiamond(x - 1, y);
      p.set(x, y, bottom ? dark : top ? light : base);
    }
  }
  return p;
}

/** The 1px diamond border cells (used for highlight / claim outlines). */
function borderCells(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < DIA_H; y++) {
    for (let x = 0; x < DIA_W; x++) {
      if (!inDiamond(x, y)) continue;
      if (
        !inDiamond(x - 1, y) ||
        !inDiamond(x + 1, y) ||
        !inDiamond(x, y - 1) ||
        !inDiamond(x, y + 1)
      ) {
        out.push([x, y]);
      }
    }
  }
  return out;
}

function speck(p: Painter, x: number, y: number, petal: string, center: string): void {
  p.set(x, y - 1, petal);
  p.set(x - 1, y, petal);
  p.set(x + 1, y, petal);
  p.set(x, y + 1, petal);
  p.set(x, y, center);
}

export function registerTiles(scene: Scene): void {
  // Plain grass
  drawPixelTexture(scene, 'tile_grass', diamond('g', 'G', 'd').rows(), L);

  // Grass with a couple of flowers
  const g2 = diamond('g', 'G', 'd');
  speck(g2, 11, 6, 'c', 'o');
  speck(g2, 20, 9, 'a', 'o');
  g2.set(15, 4, 'f');
  drawPixelTexture(scene, 'tile_grass2', g2.rows(), L);

  // Grass with leafy tufts
  const g3 = diamond('g', 'G', 'd');
  g3.set(9, 8, 'f').set(10, 7, 'f').set(10, 8, 'd');
  g3.set(21, 6, 'f').set(22, 7, 'f').set(21, 7, 'd');
  g3.set(15, 10, 'f').set(16, 10, 'd');
  drawPixelTexture(scene, 'tile_grass3', g3.rows(), L);

  // Dirt path
  drawPixelTexture(scene, 'tile_path', diamond('p', 'p', 'P').rows(), L);

  // Paved plaza with stone seams following the iso grid
  const plaza = diamond('s', 's', 'S');
  for (let y = 0; y < DIA_H; y++) {
    for (let x = 0; x < DIA_W; x++) {
      if (!inDiamond(x, y) || plaza.get(x, y) === '.') continue;
      if ((x + 2 * y) % 8 === 0 || (x - 2 * y + 32) % 8 === 0) plaza.set(x, y, 'S');
    }
  }
  drawPixelTexture(scene, 'tile_plaza', plaza.rows(), L);

  // Selection highlight — glowing outline only
  const hi = new Painter(DIA_W, DIA_H);
  for (const [x, y] of borderCells()) hi.set(x, y, 'o');
  drawPixelTexture(scene, 'tile_highlight', hi.rows(), L);

  // Claimable — dashed accent outline
  const claim = new Painter(DIA_W, DIA_H);
  const border = borderCells();
  border.forEach(([x, y], i) => {
    if (i % 2 === 0) claim.set(x, y, 'a');
  });
  drawPixelTexture(scene, 'tile_claim', claim.rows(), L);
}
