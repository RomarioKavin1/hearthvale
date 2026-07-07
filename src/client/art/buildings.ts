import type { Scene } from 'phaser';
import { PAL } from '../../shared/palette';
import type { BuildingId, Tier } from '../../shared/types';
import { drawPixelTexture, Painter } from './pixels';
import type { Legend, PixelGrid } from './pixels';

/**
 * Master legend shared by every building, icon and the construction sprite.
 * Upper-case = lit facet, lower-case = shaded facet, keeping light top-left.
 */
const BL: Legend = {
  W: PAL.wall,
  w: PAL.wallShade,
  D: PAL.wood,
  d: PAL.woodDark,
  l: PAL.woodLight,
  R: PAL.roofRed,
  r: PAL.roofRedDark,
  B: PAL.roofBlue,
  b: PAL.roofBlueDark,
  S: PAL.roofStraw,
  s: PAL.roofStrawDark,
  T: PAL.stone,
  t: PAL.stoneDark,
  G: PAL.leaf,
  g: PAL.leafDark,
  U: PAL.water,
  O: PAL.glow,
  C: PAL.cream,
  A: PAL.accent,
  o: PAL.soil,
  K: PAL.ink,
};

const W = 24;
const H = 32;
const CX = 12;
const BASE = 30;

export const TIERS: Tier[] = [1, 2, 3];

const IDS: BuildingId[] = [
  'cottage',
  'bakery',
  'wheatfield',
  'quarry',
  'sawmill',
  'grove',
  'well',
  'trees',
  'windmill',
  'kiln',
  'manor',
  'fountain',
];

// ── Reusable composition helpers ──────────────────────────────────────────

/** Lit front wall with a shaded right band to suggest the turned corner. */
function facade(p: Painter, left: number, top: number, w: number, h: number, lit: string, shade: string): void {
  p.rect(left, top, w, h, lit);
  p.rect(left + w - 3, top, 3, h, shade);
  p.vline(left, top, h, lit === 'W' ? 'W' : lit);
}

/** A 3×3 window: cream frame with four glowing panes and a cream mullion. */
function win(p: Painter, x: number, y: number): void {
  p.rect(x, y, 3, 3, 'C');
  p.set(x, y, 'O');
  p.set(x + 2, y, 'O');
  p.set(x, y + 2, 'O');
  p.set(x + 2, y + 2, 'O');
}

/** Timber door with a glowing knob. */
function door(p: Painter, cx: number, baseY: number, tall: number): void {
  p.rect(cx - 1, baseY - tall, 3, tall, 'd');
  p.set(cx - 1, baseY - tall, 'D');
  p.set(cx + 1, baseY - tall, 'D');
  p.set(cx + 1, baseY - Math.ceil(tall / 2), 'O');
}

/** A window flower box for tier-2+ charm. */
function flowerBox(p: Painter, x: number, y: number): void {
  p.hline(x, y, 3, 'd');
  p.set(x, y - 1, 'A');
  p.set(x + 1, y - 1, 'O');
  p.set(x + 2, y - 1, 'G');
}

/** Dashed golden eave trim for the grandest tier. */
function goldTrim(p: Painter, x: number, y: number, len: number): void {
  for (let i = 0; i < len; i += 2) p.set(x + i, y, 'O');
}

/** Stone chimney with optional cream smoke puffs. */
function chimney(p: Painter, x: number, topY: number, baseY: number, smoke: boolean): void {
  p.rect(x, topY, 2, baseY - topY, 'T');
  p.hline(x, topY, 2, 't');
  if (smoke) {
    p.set(x, topY - 2, 'C');
    p.set(x + 1, topY - 4, 'C');
    p.set(x, topY - 6, 'C');
  }
}

/** A small triangular pennant flag flying from a roof peak. */
function flag(p: Painter, x: number, y: number): void {
  p.vline(x, y - 4, 4, 'D');
  p.set(x + 1, y - 4, 'O');
  p.set(x + 2, y - 4, 'A');
  p.set(x + 1, y - 3, 'A');
}

/** Filled circle of radius r centred at (cx,cy) in `main`, right half `dark`. */
function disc(p: Painter, cx: number, cy: number, r: number, main: string, dark: string): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) p.set(cx + x, cy + y, x > 0 ? dark : main);
    }
  }
}

const finish = (p: Painter): PixelGrid => p.outline('K').rows();

// ── Gabled house archetype (cottage / bakery / grove / kiln / manor) ─────

type HouseOpts = { wide?: boolean; roof: [string, string] };

function gabledHouse(tier: Tier, opts: HouseOpts): Painter {
  const p = new Painter(W, H);
  const [rMain, rDark] = opts.roof;
  const halfW = (opts.wide ? 8 : 6) + (tier - 1);
  const wallH = 9 + (tier - 1) * 4;
  const wallTop = BASE - wallH;
  const left = CX - halfW;
  const wide = 2 * halfW;

  facade(p, left, wallTop, wide, wallH, 'W', 'w');

  const roofH = 6 + (tier - 1);
  const roofTop = wallTop - roofH;
  p.gable(CX, roofTop, wallTop, 0, halfW + 2, rMain, rDark);
  p.hline(left - 2, wallTop, wide + 4, rDark); // eave shadow line

  door(p, CX, BASE, 6);

  for (let f = 0; f < tier; f++) {
    const wy = wallTop + 2 + f * 4;
    win(p, left + 1, wy);
    win(p, left + wide - 4, wy);
    if (tier >= 2 && f === tier - 1) {
      flowerBox(p, left + 1, wy + 3);
      flowerBox(p, left + wide - 4, wy + 3);
    }
  }

  if (tier === 3) {
    goldTrim(p, left - 1, wallTop - 1, wide + 2);
    flag(p, CX, roofTop);
  }
  return p;
}

// ── Per-building builders ──────────────────────────────────────────────────

const BUILDERS: Record<BuildingId, (tier: Tier) => Painter> = {
  cottage(tier) {
    const p = gabledHouse(tier, { roof: ['R', 'r'] });
    if (tier >= 2) chimney(p, 17 + tier, BASE - (9 + (tier - 1) * 4) - 3, BASE - (9 + (tier - 1) * 4) + 4, tier === 3);
    return p;
  },

  bakery(tier) {
    const p = gabledHouse(tier, { roof: ['S', 's'] });
    // A bakery always has a smoking chimney and a bread-sign.
    const wallTop = BASE - (9 + (tier - 1) * 4);
    chimney(p, 16 + tier, wallTop - 4, wallTop + 3, tier >= 2);
    p.set(CX - 4, BASE - 8, 'A');
    p.set(CX - 4, BASE - 9, 'O'); // hanging loaf sign glint
    return p;
  },

  wheatfield(tier) {
    const p = new Painter(W, H);
    const beds = tier; // 1..3 raised beds
    for (let b = 0; b < beds; b++) {
      const by = BASE - 3 - b * 5;
      const bw = 16 - b * 2;
      const bx = CX - bw / 2;
      p.rect(bx, by, bw, 3, 'o'); // soil
      p.hline(bx, by, bw, 'd'); // front board
      p.vline(bx, by, 3, 'd');
      p.vline(bx + bw - 1, by, 3, 'd');
      for (let i = 1; i < bw - 1; i += 2) {
        p.set(bx + i, by - 1, 'G');
        p.set(bx + i, by - 2, 'g');
      }
    }
    if (tier >= 2) {
      // little picket fence flowers
      p.set(CX - 8, BASE - 4, 'A');
      p.set(CX + 7, BASE - 4, 'A');
    }
    if (tier === 3) {
      // trellis arch with blossoms
      const topY = BASE - 3 - beds * 5;
      p.vline(CX - 7, topY - 6, 6, 'D');
      p.vline(CX + 6, topY - 6, 6, 'D');
      p.hline(CX - 7, topY - 6, 14, 'D');
      p.set(CX - 5, topY - 5, 'A');
      p.set(CX, topY - 7, 'O');
      p.set(CX + 4, topY - 5, 'A');
      p.set(CX - 2, topY - 5, 'G');
    }
    return p;
  },

  quarry(tier) {
    const p = new Painter(W, H);
    const halfW = 7 + (tier - 1);
    const left = CX - halfW;
    const wide = 2 * halfW;
    const counterY = BASE - 6;
    // posts
    p.vline(left, counterY - 6, 12, 'D');
    p.vline(left + wide - 1, counterY - 6, 12, 'D');
    // counter
    p.rect(left, counterY, wide, 4, 'D');
    p.hline(left, counterY, wide, 'l');
    p.rect(left + 1, counterY + 4, wide - 2, 2, 'd');
    // striped awning (blue + cream)
    const awnY = counterY - 8;
    for (let i = 0; i < wide; i++) {
      p.set(left + i, awnY, i % 2 === 0 ? 'B' : 'C');
      p.set(left + i, awnY + 1, i % 2 === 0 ? 'b' : 'C');
    }
    // scalloped fringe
    for (let i = 0; i < wide; i += 2) p.set(left + i, awnY + 2, 'B');
    // goods on the counter
    p.set(CX - 3, counterY - 1, 'A');
    p.set(CX - 1, counterY - 1, 'O');
    p.set(CX + 1, counterY - 1, 'G');
    p.set(CX + 3, counterY - 1, 'R');
    if (tier >= 2) {
      p.set(CX - 4, counterY - 2, 'C');
      p.set(CX + 4, counterY - 2, 'S');
    }
    if (tier === 3) {
      // hanging banner
      p.rect(CX - 2, awnY - 4, 5, 3, 'A');
      p.set(CX, awnY - 3, 'O');
      goldTrim(p, left, awnY - 1, wide);
    }
    return p;
  },

  sawmill(tier) {
    // Wider canvas than the other buildings so the saw blade (which hangs off
    // the shed's right side) always fits fully, teeth and outline included.
    const p = new Painter(30, H);
    const cx = 14;
    const halfW = 6 + (tier - 1);
    const left = cx - halfW;
    const wide = 2 * halfW;
    const wallH = 10 + (tier - 1) * 3;
    const wallTop = BASE - wallH;
    // wooden shed
    facade(p, left, wallTop, wide, wallH, 'D', 'd');
    // plank lines
    for (let y = wallTop + 2; y < BASE; y += 3) p.hline(left, y, wide - 3, 'd');
    // slanted wood roof
    p.gable(cx, wallTop - 5, wallTop, 1, halfW + 2, 'd', 'd');
    p.hline(left - 2, wallTop, wide + 4, 'd');
    // circular saw blade on the right
    const bladeX = left + wide + 1;
    const bladeR = 3 + (tier === 3 ? 1 : 0);
    disc(p, bladeX, BASE - 6, bladeR, 'T', 't');
    p.set(bladeX, BASE - 6, tier === 3 ? 'O' : 't'); // hub
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      p.set(
        Math.round(bladeX + Math.cos(ang) * (bladeR + 1)),
        Math.round(BASE - 6 + Math.sin(ang) * (bladeR + 1)),
        'T'
      );
    }
    // log pile
    p.set(left - 2, BASE - 1, 'D');
    p.set(left - 1, BASE - 1, 'd');
    p.set(left - 2, BASE - 2, 'D');
    if (tier >= 2) win(p, cx - 1, wallTop + 3);
    if (tier === 3) goldTrim(p, left - 1, wallTop - 1, wide + 2);
    return p;
  },

  grove(tier) {
    // Force a chunky two-storey feel and hang a sign board.
    const p = gabledHouse(tier === 1 ? 2 : tier, { roof: ['R', 'r'] });
    const wallTop = BASE - (9 + ((tier === 1 ? 2 : tier) - 1) * 4);
    // hanging sign on a bracket
    const bx = CX - (7 + (tier - 1));
    p.hline(bx, wallTop + 4, 3, 'D');
    p.vline(bx + 2, wallTop + 4, 3, 'D');
    p.rect(bx + 1, wallTop + 7, 3, 3, 'A');
    p.set(bx + 2, wallTop + 8, 'O');
    if (tier === 3) chimney(p, 18, wallTop - 4, wallTop + 3, true);
    return p;
  },

  well(tier) {
    const p = new Painter(W, H);
    const postH = 12 + (tier - 1) * 4;
    const topY = BASE - postH;
    // stone base
    p.rect(CX - 2, BASE - 2, 4, 2, 'T');
    p.hline(CX - 2, BASE - 2, 4, 't');
    // post
    p.vline(CX, topY, postH, 'D');
    p.vline(CX - 1, topY, postH, 'd');
    // lamp housing
    p.rect(CX - 2, topY - 4, 4, 4, 'D');
    p.rect(CX - 1, topY - 3, 2, 2, 'O');
    p.set(CX - 2, topY - 4, 'l');
    p.set(CX + 1, topY - 4, 'l');
    // glow halo
    p.set(CX - 3, topY - 2, 'O');
    p.set(CX + 2, topY - 2, 'O');
    if (tier >= 2) {
      // side arms with little glows
      p.set(CX - 3, topY - 3, 'D');
      p.set(CX + 2, topY - 3, 'D');
      p.set(CX - 4, topY - 3, 'O');
      p.set(CX + 3, topY - 3, 'O');
    }
    if (tier === 3) {
      // ornate cap + pennant
      p.set(CX - 2, topY - 5, 'A');
      p.set(CX + 1, topY - 5, 'A');
      p.set(CX, topY - 6, 'O');
      flag(p, CX, topY - 4);
    }
    return p;
  },

  trees(tier) {
    const p = new Painter(W, H);
    // pot
    p.rect(CX - 3, BASE - 4, 6, 4, 'D');
    p.hline(CX - 4, BASE - 4, 8, 'l');
    p.rect(CX - 3, BASE - 1, 6, 1, 'd');
    if (tier === 3) p.hline(CX - 4, BASE - 5, 8, 'O'); // gold rim
    // stacked leafy spheres
    const tiers = tier + 1;
    let cy = BASE - 6;
    for (let i = 0; i < tiers; i++) {
      const r = 3 - (i > 1 ? 1 : 0);
      disc(p, CX, cy, r, 'G', 'g');
      cy -= r + 2;
    }
    // blossom glints
    p.set(CX - 2, BASE - 8, 'A');
    p.set(CX + 2, BASE - 9, 'C');
    if (tier >= 2) p.set(CX, cy + 1, 'O');
    if (tier === 3) {
      p.set(CX - 3, BASE - 11, 'O');
      p.set(CX + 3, BASE - 12, 'A');
    }
    return p;
  },

  windmill(tier) {
    const p = new Painter(W, H);
    const halfW = 4 + (tier - 1);
    const towerH = 16 + (tier - 1) * 4;
    const top = BASE - towerH;
    // tapered tower
    for (let y = 0; y < towerH; y++) {
      const t = y / towerH;
      const hw = Math.round(halfW - (halfW - 2) * (1 - t));
      p.hline(CX - hw, top + y, hw * 2, 'W');
      p.rect(CX + hw - 2, top + y, 2, 1, 'w');
    }
    // blue cap
    p.gable(CX, top - 4, top, 0, halfW + 1, 'B', 'b');
    // door + window
    door(p, CX, BASE, 5);
    win(p, CX - 1, top + 5);
    // cross blades (sails)
    const hubY = top + 2;
    const armR = 6 + (tier - 1);
    for (const [dx, dy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      for (let i = 1; i <= armR; i++) {
        p.set(CX + dx * i, hubY + dy * i, i % 2 === 0 ? 'C' : 'D');
      }
    }
    disc(p, CX, hubY, 1, 'D', 'd');
    if (tier === 3) {
      goldTrim(p, CX - halfW, top - 1, halfW * 2);
      p.set(CX, top - 5, 'O');
    }
    return p;
  },

  kiln(tier) {
    const p = new Painter(W, H);
    const halfW = 6 + (tier - 1);
    const left = CX - halfW;
    const wide = 2 * halfW;
    const wallH = 10 + (tier - 1) * 3;
    const wallTop = BASE - wallH;
    // stone lower + plaster upper
    p.rect(left, wallTop, wide, wallH, 'T');
    p.rect(left + wide - 3, wallTop, 3, wallH, 't');
    for (let y = wallTop + 1; y < BASE; y += 3) p.hline(left, y, wide, 't'); // stone courses
    // dark red roof
    p.gable(CX, wallTop - 5, wallTop, 0, halfW + 2, 'r', 'r');
    p.hline(left - 2, wallTop, wide + 4, 'r');
    // glowing furnace mouth
    p.rect(CX - 2, BASE - 6, 5, 5, 'K');
    p.rect(CX - 1, BASE - 5, 3, 3, 'A');
    p.set(CX, BASE - 4, 'O');
    // chimney belching heat
    chimney(p, left + 2, wallTop - 6, wallTop + 2, tier >= 2);
    if (tier >= 2) {
      p.set(CX + 4, BASE - 5, 'O'); // stray ember
      win(p, left + 1, wallTop + 2);
    }
    if (tier === 3) {
      goldTrim(p, left - 1, wallTop - 1, wide + 2);
      p.set(CX - 4, BASE - 4, 'A');
    }
    return p;
  },

  manor(tier) {
    const p = gabledHouse(tier, { wide: true, roof: ['B', 'b'] });
    const halfW = 8 + (tier - 1);
    const left = CX - halfW;
    const wide = 2 * halfW;
    const wallTop = BASE - (9 + (tier - 1) * 4);
    // grand double doors + steps
    p.rect(CX - 2, BASE - 6, 4, 6, 'd');
    p.set(CX, BASE - 3, 'O');
    p.hline(CX - 3, BASE - 1, 6, 'T');
    // symmetric twin chimneys
    if (tier >= 2) {
      chimney(p, left + 1, wallTop - 3, wallTop + 3, tier === 3);
      chimney(p, left + wide - 3, wallTop - 3, wallTop + 3, tier === 3);
    }
    return p;
  },

  fountain(tier) {
    const p = new Painter(W, H);
    const halfW = 7 + (tier - 1);
    const left = CX - halfW;
    const wide = 2 * halfW;
    // stone basin
    p.rect(left, BASE - 4, wide, 4, 'T');
    p.hline(left, BASE - 4, wide, 't');
    p.rect(left + 2, BASE - 3, wide - 4, 2, 'U'); // water
    for (let i = 3; i < wide - 3; i += 3) p.set(left + i, BASE - 3, 'C'); // ripples
    // central pillar & tiers
    const tiers = tier;
    let cy = BASE - 5;
    for (let i = 0; i < tiers; i++) {
      const r = 3 - i;
      p.rect(CX - 1, cy - 3, 2, 3, 'T'); // stem
      disc(p, CX, cy - 3, Math.max(1, r), 'T', 't');
      p.set(CX, cy - 3, 'U'); // water dish
      cy -= 4;
    }
    // spout + droplets
    p.set(CX, cy, 'U');
    p.set(CX - 2, cy + 2, 'O');
    p.set(CX + 2, cy + 2, 'O');
    if (tier === 3) {
      p.set(CX, cy - 1, 'O'); // golden finial
      p.hline(left, BASE - 4, wide, 'O');
    }
    return p;
  },
};

// ── 8×8 UI icons (readable silhouettes) ────────────────────────────────────

const ICONS: Record<BuildingId, PixelGrid> = {
  cottage: ['...RR...', '..RRRR..', '.RRRRRR.', '.WWWWWW.', '.WWddWW.', '.WWddWW.', '.WWddWW.', '........'],
  bakery: ['..C..C..', '..SSSS..', '.SSSSSS.', '.WWWWWW.', '.WOWWOW.', '.WWddWW.', '.WWddWW.', '........'],
  wheatfield: ['........', '..G..G..', '.GgGGgG.', '.GGGGGG.', '.dooood.', '.dooood.', '.dddddd.', '........'],
  quarry: ['.BCBCBC.', '.BCBCBC.', '..d..d..', '.DDDDDD.', '.DAOGAD.', '.dddddd.', '..d..d..', '........'],
  sawmill: ['..dddd..', '.dDDDDd.', '.DDDD.T.', '.DDDTTT.', '.DDDTOT.', '.DDDTTT.', '.dd..T..', '........'],
  grove: ['..RRRR..', '.RRRRRR.', 'RRRRRRRR', '.WWWWWW.', '.WOAOWW.', '.WWWWWW.', '.WWddWW.', '.WWddWW.'],
  well: ['...DD...', '..DOOD..', '..DOOD..', '.O.DD.O.', '...DD...', '...DD...', '..TTTT..', '........'],
  trees: ['...GG...', '..GGGG..', '..GGGG..', '...GG...', '..GGGG..', '...DD...', '..DDDD..', '..dddd..'],
  windmill: ['C..D..C.', '.C.D.C..', '..CDC...', '.BBWBB..', '..WWW...', '..WdW...', '..WWW...', '........'],
  kiln: ['..rrrr..', '.rrrrrr.', '.TTTTTT.', '.TTTTTT.', '.TKAKT..', '.TKOKT..', '.TTTTTT.', '........'],
  manor: ['.BBBBBB.', 'BBBBBBBB', '.WWWWWW.', '.WOWWOW.', '.WWddWW.', '.WWddWW.', '.WWddWW.', 'T......T'],
  fountain: ['........', '...U....', '..OUO...', '..TTT...', '.UUUUU..', 'TTTTTTTT', '.TUUUT..', 'TTTTTTTT'],
};

// ── Construction site (scaffold + crane) ───────────────────────────────────

function constructionGrid(): PixelGrid {
  const p = new Painter(W, H);
  // partially built wall
  p.rect(CX - 5, BASE - 8, 10, 8, 'W');
  p.rect(CX + 2, BASE - 8, 3, 8, 'w');
  p.hline(CX - 5, BASE - 4, 10, 'w');
  // scaffold poles
  p.vline(CX - 7, BASE - 16, 16, 'D');
  p.vline(CX + 6, BASE - 16, 16, 'D');
  // crossbeams
  p.hline(CX - 7, BASE - 16, 14, 'l');
  p.hline(CX - 7, BASE - 9, 14, 'l');
  // diagonal brace
  for (let i = 0; i < 7; i++) p.set(CX - 7 + i, BASE - 16 + i, 'd');
  // crane arm + hook
  p.hline(CX - 7, BASE - 20, 12, 'D');
  p.vline(CX - 7, BASE - 22, 3, 'D');
  p.vline(CX + 4, BASE - 20, 3, 'd');
  p.set(CX + 4, BASE - 17, 'O'); // hook glow
  p.set(CX + 4, BASE - 16, 'A');
  // caution flag
  p.set(CX - 8, BASE - 22, 'A');
  p.set(CX - 8, BASE - 21, 'O');
  return p.outline('K').rows();
}

/**
 * Apply the 1px ink outline cohesion rule to an icon literal, in place within
 * its 8×8 canvas (transparent neighbours of opaque pixels become ink).
 */
function outlinedIcon(rows: PixelGrid): PixelGrid {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const p = new Painter(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch !== undefined && ch !== '.') p.set(x, y, ch);
    }
  });
  return p.outline('K').rows();
}

export function registerBuildings(scene: Scene): void {
  for (const id of IDS) {
    for (const tier of TIERS) {
      drawPixelTexture(scene, `bld_${id}_${tier}`, finish(BUILDERS[id](tier)), BL);
    }
    drawPixelTexture(scene, `icon_${id}`, outlinedIcon(ICONS[id]), BL);
  }
  drawPixelTexture(scene, 'bld_construction', constructionGrid(), BL);
}
