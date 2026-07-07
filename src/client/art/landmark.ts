import type { Scene } from 'phaser';
import { PAL } from '../../shared/palette';
import { drawPixelTexture, Painter } from './pixels';
import type { Legend } from './pixels';

const LL: Legend = {
  W: PAL.wall,
  w: PAL.wallShade,
  T: PAL.stone,
  t: PAL.stoneDark,
  D: PAL.wood,
  d: PAL.woodDark,
  B: PAL.roofBlue,
  b: PAL.roofBlueDark,
  O: PAL.glow,
  C: PAL.cream,
  A: PAL.accent,
  K: PAL.ink,
};

const LW = 48;
const LH = 72;
const CX = 24;

function disc(p: Painter, cx: number, cy: number, r: number, main: string, dark: string): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) p.set(cx + x, cy + y, x > 0 ? dark : main);
    }
  }
}

// Cumulative construction layers of the Grand Clocktower.

function foundation(p: Painter): void {
  p.rect(CX - 15, 66, 30, 6, 't');
  p.rect(CX - 13, 62, 26, 6, 'T');
  // scattered foundation stones for texture
  for (let x = CX - 12; x < CX + 12; x += 4) {
    p.set(x, 64, 't');
    p.set(x + 2, 68, 't');
  }
}

function baseWalls(p: Painter): void {
  p.rect(CX - 10, 44, 20, 18, 'W');
  p.rect(CX + 4, 44, 6, 18, 'w'); // shaded right face
  // stone quoins
  p.vline(CX - 10, 44, 18, 'T');
  p.vline(CX + 9, 44, 18, 't');
  // grand arched door
  p.rect(CX - 3, 54, 6, 8, 'd');
  p.set(CX - 3, 54, 'D');
  p.set(CX + 2, 54, 'D');
  p.set(CX + 1, 58, 'O'); // handle
  // flanking windows
  p.rect(CX - 8, 48, 3, 4, 'C');
  p.rect(CX + 5, 48, 3, 4, 'C');
}

function towerWalls(p: Painter): void {
  p.rect(CX - 8, 26, 16, 18, 'W');
  p.rect(CX + 3, 26, 5, 18, 'w');
  p.vline(CX - 8, 26, 18, 'T');
  p.vline(CX + 7, 26, 18, 't');
  // tall lancet windows
  for (const wx of [CX - 6, CX + 3]) {
    p.rect(wx, 30, 3, 8, 'C');
    p.set(wx + 1, 30, 'W');
  }
  p.set(CX, 34, 'D'); // central pilaster
}

function clockRing(p: Painter): void {
  // belfry that overhangs the shaft
  p.rect(CX - 11, 14, 22, 14, 'T');
  p.rect(CX + 4, 14, 7, 14, 't');
  p.hline(CX - 11, 14, 22, 't');
  // corbel row
  for (let x = CX - 11; x < CX + 11; x += 2) p.set(x, 28, 't');
  // clock face (plain cream at this stage)
  disc(p, CX, 21, 5, 'C', 'C');
  p.set(CX, 21, 'K');
}

function roofSpire(p: Painter): void {
  // blue conical roof rising from the belfry
  for (let j = 0; j <= 12; j++) {
    const half = Math.round(11 - (11 / 12) * j);
    for (let x = CX - half; x <= CX + half; x++) {
      p.set(x, 2 + j, x > CX ? 'b' : 'B');
    }
  }
  // finial post
  p.vline(CX, 0, 3, 'D');
}

function finale(p: Painter): void {
  // golden clock ring + hands
  disc(p, CX, 21, 5, 'O', 'O');
  disc(p, CX, 21, 3, 'C', 'C');
  p.vline(CX, 18, 4, 'K'); // minute hand
  p.hline(CX, 21, 3, 'K'); // hour hand
  p.set(CX, 21, 'K');
  // lit windows glow
  for (const wx of [CX - 6, CX + 3]) p.rect(wx, 30, 3, 8, 'O');
  p.rect(CX - 8, 48, 3, 4, 'O');
  p.rect(CX + 5, 48, 3, 4, 'O');
  // golden spire tip + pennant
  p.set(CX, 1, 'O');
  p.set(CX + 1, 0, 'A');
  p.set(CX + 2, 1, 'O');
  // celebratory sparkles
  p.set(CX - 13, 10, 'O');
  p.set(CX + 13, 16, 'O');
  p.set(CX - 11, 34, 'O');
}

const STAGES: Array<(p: Painter) => void>[] = [
  [foundation],
  [foundation, baseWalls],
  [foundation, baseWalls, towerWalls],
  [foundation, baseWalls, towerWalls, clockRing],
  [foundation, baseWalls, towerWalls, clockRing, roofSpire],
  [foundation, baseWalls, towerWalls, clockRing, roofSpire, finale],
];

export function registerLandmark(scene: Scene): void {
  STAGES.forEach((layers, stage) => {
    const p = new Painter(LW, LH);
    for (const layer of layers) layer(p);
    drawPixelTexture(scene, `landmark_${stage}`, p.outline('K').rows(), LL);
  });
}
