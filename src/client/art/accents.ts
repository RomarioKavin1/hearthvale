// Per-building DISTINCT accents (Task E3 part 2 → H1 style pass).
//
// The Sketch Town pack ships only base+roof block variants, so H1 gives each
// special building a NON-HOUSE construction grammar (windmill = round stone
// tower, sawmill = open timber yard, kiln = oven dome, bakery = shop, manor =
// estate — see manifest BUILDING_ART) and this module hand-draws the small
// living/identifying accent on top: the windmill's turning sails, the sawmill's
// static saw + log pile + canopy, the kiln's chimney + ember, the bakery's
// striped awning + hanging sign, the manor's balcony + hedges, the quarry's pit,
// and the per-tier house upgrades. Shared by the live Village scene AND the
// ?artdebug surface so both render identically.
//
// H1 animation style pass (fixing "the drawn accents look bad"): the sails are
// tapered blades with a 1px ink outline + two-tone shading (light face / dark
// edge) on a hub dot, turning slowly (~12s/rev); the ember glow is a small 2px
// core with a gentle pulse. Everything freezes legibly under reduced motion.
//
// H3 iso-projection pass (fixing "the accents feel detached from the isometric
// aesthetics — they're drawn in the flat screen plane"): the windmill sails now
// spin INSIDE a foreshortened, slightly-tilted container (scaleX ≈ 0.72 of
// scaleY + a small face rotation), so the sweep traces an ELLIPSE on the tower's
// SE face instead of a screen-plane circle; the sawmill's flat saw disc becomes
// a 2:1 iso ellipse half-buried lengthwise in the cut log. Both read as part of
// the diorama rather than stickers on the glass.
//
// All geometry is anchored to the tile's top-face centre (sx, sy) — the same
// point addBlock/addSurface place from — with vertical offsets tuned against the
// base (BASE_DY = −45) and roof (BASE_DY + ROOF_DY = −90) block steps. Everything
// draws exclusively from the shared PAL palette (no stray hex).

import type { GameObjects, Scene, Tweens } from 'phaser';
import { PAL } from '../../shared/palette';
import type { BuildingId, Tier } from '../../shared/types';
import { addBlock, addSurface, BASE_DY, ROOF_DY } from './render';

const hexNum = (hex: string): number => parseInt(hex.replace('#', ''), 16);

const C = {
  cream: hexNum(PAL.cream),
  wood: hexNum(PAL.wood),
  woodDark: hexNum(PAL.woodDark),
  woodLight: hexNum(PAL.woodLight),
  stone: hexNum(PAL.stone),
  stoneDark: hexNum(PAL.stoneDark),
  ink: hexNum(PAL.ink),
  soilDark: hexNum(PAL.soilDark),
  glow: hexNum(PAL.glow),
  accent: hexNum(PAL.accent),
  roofRed: hexNum(PAL.roofRed),
  leaf: hexNum(PAL.leaf),
  leafDark: hexNum(PAL.leafDark),
  grassLight: hexNum(PAL.grassLight),
  path: hexNum(PAL.path),
  pathDark: hexNum(PAL.pathDark),
};

/** The accent objects + tweens for one building, so the caller can destroy the
 * objects and kill the tweens together when the tile changes. */
export type Accents = {
  objects: GameObjects.GameObject[];
  tweens: Tweens.Tween[];
};

/** Rotate a local point about (0,0) by `rad`. */
const rot = (px: number, py: number, rad: number): [number, number] => {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [px * cos - py * sin, px * sin + py * cos];
};

/** Fill a polygon given local points rotated by `rad` about (0,0). */
const poly = (
  g: GameObjects.Graphics,
  pts: ReadonlyArray<readonly [number, number]>,
  rad: number,
  fill: number,
  alpha = 1
): void => {
  const r = pts.map(([px, py]) => rot(px, py, rad));
  g.fillStyle(fill, alpha);
  g.beginPath();
  g.moveTo(r[0]![0], r[0]![1]);
  for (let i = 1; i < r.length; i += 1) g.lineTo(r[i]![0], r[i]![1]);
  g.closePath();
  g.fillPath();
};

/** Stroke a polygon outline given local points rotated by `rad`. */
const outline = (
  g: GameObjects.Graphics,
  pts: ReadonlyArray<readonly [number, number]>,
  rad: number,
  color: number,
  width = 1
): void => {
  const r = pts.map(([px, py]) => rot(px, py, rad));
  g.lineStyle(width, color, 1);
  g.beginPath();
  g.moveTo(r[0]![0], r[0]![1]);
  for (let i = 1; i < r.length; i += 1) g.lineTo(r[i]![0], r[i]![1]);
  g.closePath();
  g.strokePath();
};

/**
 * One tapered windmill blade rooted at the hub (0,0) pointing "up" then rotated
 * by `rad`: a light leading face + a darker trailing edge (two-tone), wrapped in
 * a 1px ink outline. Matches the flat, ink-lined Sketch Town look.
 */
const drawBlade = (g: GameObjects.Graphics, rad: number): void => {
  const A: readonly [number, number] = [-3, -7];
  const B: readonly [number, number] = [3, -7];
  const Tp: readonly [number, number] = [6, -32];
  const Tn: readonly [number, number] = [-6, -32];
  const midB: readonly [number, number] = [0, -7];
  const midT: readonly [number, number] = [0, -32];
  // Light leading half, then dark trailing half.
  poly(g, [A, midB, midT, Tn], rad, C.cream);
  poly(g, [midB, B, Tp, midT], rad, C.woodLight);
  outline(g, [A, B, Tp, Tn], rad, C.ink, 1);
};

/**
 * Compose the distinctive accent for `id` at tier `tier`, anchored on the tile
 * top-face centre (sx, sy). `animate` runs the living motion (sail turn, ember
 * pulse); when false (reduced motion, or the static ArtDebug rows) the moving
 * parts freeze in a legible pose.
 */
export const buildBuildingAccents = (
  scene: Scene,
  id: BuildingId,
  tier: Tier,
  sx: number,
  sy: number,
  animate: boolean
): Accents => {
  const objects: GameObjects.GameObject[] = [];
  const tweens: Tweens.Tween[] = [];

  switch (id) {
    case 'windmill': {
      // Four tapered sails mounted on the mill tower's upper SE face, turning
      // slowly (~12s/rev). The classic iso cheat: the spinning cross lives inside
      // a FORESHORTENED, slightly-tilted container (scaleX ≈ 0.72 of scaleY, plus
      // a small face-angle rotation), so a blade tip traces an ELLIPSE on the
      // tilted face rather than a flat screen-plane circle — the sails read as
      // bolted to the tower, not stuck on the glass. Static (reduced motion) →
      // a calm frozen pose, still foreshortened onto the face.
      const face = scene.add.container(sx + 1, sy - 66);
      face.setScale(0.72, 1);
      face.setRotation(-0.16); // tilt to the tower's SE face angle
      face.setDepth(sy + 3);
      const blades = scene.add.graphics();
      for (const deg of [0, 90, 180, 270]) {
        drawBlade(blades, (deg * Math.PI) / 180);
      }
      // Hub: an outlined wood dot on the face.
      blades.fillStyle(C.woodDark, 1);
      blades.fillCircle(0, 0, 3.5);
      blades.lineStyle(1, C.ink, 1);
      blades.strokeCircle(0, 0, 3.5);
      face.add(blades);
      objects.push(face);
      if (animate) {
        // Rotate the blades INSIDE the skewed container so the sweep is elliptical.
        tweens.push(
          scene.tweens.add({
            targets: blades,
            angle: 360,
            duration: 12000,
            repeat: -1,
            ease: 'Linear',
          })
        );
      } else {
        blades.setAngle(30);
      }
      break;
    }

    case 'kiln': {
      // The kiln body is an oven DOME (no house base). A short brick chimney stub
      // sits on the dome's back shoulder, and a small ember glows at the oven
      // mouth on the front face — a 2px core with a gentle 3s pulse. (An earlier
      // taller chimney floated detached above the small dome — per the task's
      // "remove an accent that clashes rather than ship it ugly", the stub was
      // lowered to sit ON the dome so it reads as attached, not a stray mark.)
      const chimney = scene.add.graphics().setDepth(sy + 2.9);
      chimney.fillStyle(C.stoneDark, 1);
      chimney.fillRect(sx + 8, sy - 34, 5, 9);
      chimney.fillStyle(C.stone, 1);
      chimney.fillRect(sx + 8, sy - 36, 5, 3);
      chimney.lineStyle(1, C.ink, 1);
      chimney.strokeRect(sx + 8, sy - 36, 5, 11);
      objects.push(chimney);

      // Ember at the oven mouth on the dome's lower front — a 2px glow core.
      const ember = scene.add.graphics().setDepth(sy + 3);
      ember.fillStyle(C.accent, 0.85);
      ember.fillCircle(sx - 1, sy - 15, 4);
      ember.fillStyle(C.glow, 1);
      ember.fillCircle(sx - 1, sy - 15, 2);
      objects.push(ember);
      if (animate) {
        tweens.push(
          scene.tweens.add({
            targets: ember,
            alpha: 0.5,
            duration: 3000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
          })
        );
      } else {
        ember.setAlpha(0.85);
      }
      break;
    }

    case 'sawmill': {
      // A DENSE LUMBER YARD (H2). The tall open frame (BUILDING_ART) provides the
      // canopy posts; here we cap it with a slant-roof canopy and fill the tile
      // with a working yard: a BIG stacked log pile, a saw table with the blade
      // half-buried mid-cut in a log (the storytelling detail), a plank lean-to
      // and a sawdust mound. Tier grows the stacks, adds a second canopy, and
      // turns the saw gold. Everything ink-lined + two-tone to match Sketch Town.
      const t = tier;

      // Slant-roof canopy over the posts. Tier 3 adds a second, smaller canopy so
      // the yard reads as a bigger operation.
      const canopy = addBlock(scene, 'roof-slant-brown', sx - 2, sy - 4, BASE_DY + ROOF_DY)
        .setScale(0.86)
        .setDepth(sy + 3.5);
      objects.push(canopy);
      if (t >= 3) {
        const canopy2 = addBlock(scene, 'roof-slant-brown', sx + 24, sy - 14, BASE_DY + ROOF_DY)
          .setScale(0.58)
          .setFlipX(true)
          .setDepth(sy + 3.4);
        objects.push(canopy2);
      }

      // Sawdust mound at the foot of the saw table (drawn first so it sits behind).
      const tx = sx + 4;
      const ty = sy + 12;
      const dust = scene.add.graphics().setDepth(sy + 2.5);
      dust.fillStyle(C.path, 0.95);
      dust.fillEllipse(tx, ty + 13, 32, 10);
      dust.fillStyle(C.pathDark, 0.9);
      dust.fillEllipse(tx - 5, ty + 14, 15, 5);
      dust.fillStyle(C.cream, 0.9);
      for (const [dx, dy] of [[-9, 10], [3, 12], [-2, 15], [8, 13]] as const) {
        dust.fillCircle(tx + dx, ty + dy, 1);
      }
      objects.push(dust);

      // BIG log stack: a pyramid of log ends (heartwood discs) on the left — grows
      // row by row with tier so a levelled yard is a visibly larger woodpile.
      const logR = 7;
      const rows = t >= 3 ? [3, 3, 2] : t >= 2 ? [3, 2, 1] : [2, 1];
      const baseLX = sx - 44;
      const baseLY = sy + 16;
      const logs = scene.add.graphics().setDepth(sy + 2.6);
      rows.forEach((count, row) => {
        const ry = baseLY - row * (logR * 2 - 2);
        const rowOff = row * logR;
        for (let i = 0; i < count; i += 1) {
          const cx = baseLX + rowOff + i * (logR * 2 + 1);
          logs.fillStyle(C.wood, 1);
          logs.fillCircle(cx, ry, logR);
          logs.lineStyle(1.5, C.ink, 1);
          logs.strokeCircle(cx, ry, logR);
          logs.fillStyle(C.woodLight, 1);
          logs.fillCircle(cx, ry, logR - 3);
          logs.lineStyle(1, C.woodDark, 1);
          logs.strokeCircle(cx, ry, logR - 3);
          logs.strokeCircle(cx, ry, logR - 5);
        }
      });
      objects.push(logs);

      // Plank lean-to: a stack of sawn boards on the right, staggered light/dark.
      const planks = scene.add.graphics().setDepth(sy + 2.6);
      const px0 = sx + 22;
      const py0 = sy + 18;
      const plankCount = t >= 3 ? 5 : t >= 2 ? 4 : 3;
      for (let i = 0; i < plankCount; i += 1) {
        const yy = py0 - i * 4;
        const xoff = (i % 2) * 3;
        planks.fillStyle(i % 2 === 0 ? C.woodLight : C.wood, 1);
        planks.fillRect(px0 + xoff, yy, 30, 4);
        planks.lineStyle(1, C.ink, 1);
        planks.strokeRect(px0 + xoff, yy, 30, 4);
      }
      objects.push(planks);

      // Saw table: a trestle carrying a log with a circular blade rising mid-cut.
      const table = scene.add.graphics().setDepth(sy + 2.7);
      table.lineStyle(3, C.woodDark, 1);
      table.lineBetween(tx - 20, ty + 12, tx - 12, ty);
      table.lineBetween(tx - 20, ty, tx - 12, ty + 12);
      table.lineBetween(tx + 12, ty + 12, tx + 20, ty);
      table.lineBetween(tx + 12, ty, tx + 20, ty + 12);
      objects.push(table);

      // The blade — an ISO ELLIPSE (a 2:1-squashed circle, the iso read of a
      // circular saw set into the cut) drawn UNDER the log (depth 2.75 < 2.8) so
      // its lower half is buried in the log and only the toothed upper arc rises
      // above the kerf. Static — a spinning disc read as a flat sticker (the old
      // clash); a squashed, half-sunk ellipse sits IN the timber.
      const gold = t >= 3;
      const bladeFace = gold ? C.glow : C.stone;
      const bladeEdge = gold ? C.accent : C.stoneDark;
      const clx = tx - 26;
      const cly = ty - 5;
      const clh = 12;
      const saw = scene.add.graphics({ x: tx, y: cly + 1 }).setDepth(sy + 2.75);
      const RX = 15;
      const RY = 7.5;
      saw.fillStyle(bladeFace, 1);
      saw.fillEllipse(0, 0, RX * 2, RY * 2);
      // Teeth around the rim, following the ellipse (outlined, two-tone tips).
      const teeth = 14;
      for (let k = 0; k < teeth; k += 1) {
        const t0 = ((k - 0.32) / teeth) * Math.PI * 2;
        const t1 = ((k + 0.32) / teeth) * Math.PI * 2;
        const tm = (k / teeth) * Math.PI * 2;
        const b0: readonly [number, number] = [RX * Math.cos(t0), RY * Math.sin(t0)];
        const b1: readonly [number, number] = [RX * Math.cos(t1), RY * Math.sin(t1)];
        const ap: readonly [number, number] = [(RX + 3) * Math.cos(tm), (RY + 3) * Math.sin(tm)];
        poly(saw, [b0, b1, ap], 0, k % 2 === 0 ? C.cream : bladeEdge);
        outline(saw, [b0, b1, ap], 0, C.ink, 1);
      }
      saw.lineStyle(1.5, C.ink, 1);
      saw.strokeEllipse(0, 0, RX * 2, RY * 2);
      // Arbor hub + a couple of concentric rings for the plate read.
      saw.lineStyle(1, bladeEdge, 0.9);
      saw.strokeEllipse(0, 0, RX * 1.2, RY * 1.2);
      saw.fillStyle(bladeEdge, 1);
      saw.fillEllipse(0, 0, 6, 3.5);
      saw.lineStyle(1, C.ink, 1);
      saw.strokeEllipse(0, 0, 6, 3.5);
      objects.push(saw);

      // The log being cut, on top of the blade's lower half (mid-cut read).
      const cutLog = scene.add.graphics().setDepth(sy + 2.8);
      cutLog.fillStyle(C.wood, 1);
      cutLog.fillRoundedRect(clx, cly, 52, clh, 5);
      cutLog.lineStyle(1.5, C.ink, 1);
      cutLog.strokeRoundedRect(clx, cly, 52, clh, 5);
      // Near end cap (heartwood rings).
      cutLog.fillStyle(C.woodLight, 1);
      cutLog.fillEllipse(clx + 52, cly + clh / 2, 7, clh);
      cutLog.lineStyle(1, C.woodDark, 1);
      cutLog.strokeEllipse(clx + 52, cly + clh / 2, 7, clh);
      // The kerf: a dark slit where the blade bites through the log.
      cutLog.fillStyle(C.ink, 0.85);
      cutLog.fillRect(tx - 1.5, cly - 1, 3, clh + 2);
      objects.push(cutLog);
      break;
    }

    case 'bakery': {
      // A striped shop awning slung over the front + a small hanging sign board —
      // the shopfront read. Four alternating cream/red slats on a slanted band.
      const awning = scene.add.graphics().setDepth(sy + 3);
      const topY = sy - 34;
      const botY = sy - 20;
      const x0 = sx - 24;
      const slat = 12;
      for (let i = 0; i < 4; i += 1) {
        const lx = x0 + i * slat;
        awning.fillStyle(i % 2 === 0 ? C.cream : C.roofRed, 1);
        awning.beginPath();
        awning.moveTo(lx, topY);
        awning.lineTo(lx + slat, topY);
        awning.lineTo(lx + slat, botY + 4);
        awning.lineTo(lx, botY);
        awning.closePath();
        awning.fillPath();
      }
      awning.fillStyle(C.woodDark, 1);
      awning.fillRect(x0, topY - 2, slat * 4, 3);
      awning.lineStyle(1, C.ink, 1);
      awning.strokeRect(x0, topY - 2, slat * 4, botY + 4 - (topY - 2));
      objects.push(awning);

      // Hanging sign board: a short hanger + an outlined wood plank + a bread dot.
      const sign = scene.add.graphics().setDepth(sy + 3.1);
      const signX = sx + 20;
      const signTop = botY + 4;
      sign.lineStyle(1.5, C.woodDark, 1);
      sign.lineBetween(signX, signTop, signX, signTop + 4);
      sign.fillStyle(C.woodLight, 1);
      sign.fillRoundedRect(signX - 9, signTop + 4, 18, 11, 2);
      sign.lineStyle(1, C.ink, 1);
      sign.strokeRoundedRect(signX - 9, signTop + 4, 18, 11, 2);
      sign.fillStyle(C.glow, 1);
      sign.fillCircle(signX, signTop + 9.5, 3);
      sign.lineStyle(1, C.accent, 1);
      sign.strokeCircle(signX, signTop + 9.5, 3);
      objects.push(sign);
      break;
    }

    case 'manor': {
      // A wooden balcony across the front + two clipped hedges flanking the door —
      // the "estate" read.
      const balcony = addSurface(scene, 'balcony-wood', sx, sy + 6)
        .setScale(0.8)
        .setDepth(sy + 3);
      objects.push(balcony);
      const hedges = scene.add.graphics().setDepth(sy + 3);
      for (const hx of [sx - 30, sx + 30]) {
        hedges.fillStyle(C.leafDark, 1);
        hedges.fillRoundedRect(hx - 9, sy + 2, 18, 12, 5);
        hedges.fillStyle(C.leaf, 1);
        hedges.fillRoundedRect(hx - 9, sy - 1, 18, 9, 5);
        hedges.fillStyle(C.grassLight, 0.7);
        hedges.fillRoundedRect(hx - 7, sy - 1, 6, 5, 3);
      }
      objects.push(hedges);
      break;
    }

    case 'quarry': {
      // A dug pit (dark diamond) with plank props across it — a working dig site.
      const pit = scene.add.graphics().setDepth(sy + 0.4);
      const hw = 22;
      const hh = 11;
      pit.fillStyle(C.ink, 0.85);
      pit.beginPath();
      pit.moveTo(sx, sy - hh + 6);
      pit.lineTo(sx + hw, sy + 6);
      pit.lineTo(sx, sy + hh + 6);
      pit.lineTo(sx - hw, sy + 6);
      pit.closePath();
      pit.fillPath();
      pit.fillStyle(C.soilDark, 0.9);
      pit.beginPath();
      pit.moveTo(sx, sy - hh * 0.5 + 6);
      pit.lineTo(sx + hw * 0.5, sy + 6);
      pit.lineTo(sx, sy + hh * 0.5 + 6);
      pit.lineTo(sx - hw * 0.5, sy + 6);
      pit.closePath();
      pit.fillPath();
      objects.push(pit);
      const planks = scene.add.graphics().setDepth(sy + 0.6);
      planks.fillStyle(C.wood, 1);
      planks.fillRect(sx - 20, sy + 2, 40, 4);
      planks.fillStyle(C.woodDark, 1);
      planks.fillRect(sx - 6, sy - 8, 4, 20);
      objects.push(planks);
      break;
    }

    case 'house': {
      // Visible per-tier upgrade so a levelled homestead reads as grander: a dormer
      // window at tier 2, plus a gold eave trim at tier 3. (The base+roof STYLE is
      // per-owner — see manifest houseStyle — so this is the only tier signal.)
      if (tier >= 2) {
        const dormer = scene.add.graphics().setDepth(sy + 3);
        dormer.fillStyle(C.cream, 1);
        dormer.fillRect(sx - 7, sy - 74, 14, 13);
        dormer.fillStyle(C.woodDark, 1);
        dormer.fillRect(sx - 1, sy - 74, 2, 13);
        dormer.fillRect(sx - 7, sy - 68, 14, 2);
        dormer.lineStyle(1.5, C.woodDark, 1);
        dormer.strokeRect(sx - 7, sy - 74, 14, 13);
        objects.push(dormer);
      }
      if (tier >= 3) {
        const trim = scene.add.graphics().setDepth(sy + 2.5);
        trim.fillStyle(C.glow, 1);
        trim.beginPath();
        trim.moveTo(sx - 22, sy - 44);
        trim.lineTo(sx + 22, sy - 44);
        trim.lineTo(sx + 20, sy - 41);
        trim.lineTo(sx - 20, sy - 41);
        trim.closePath();
        trim.fillPath();
        objects.push(trim);
      }
      break;
    }

    default:
      break;
  }

  return { objects, tweens };
};
