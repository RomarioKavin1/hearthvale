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
// rebuilt as 4 tapered blades with a 1px ink outline + two-tone shading (light
// face / dark edge) on a hub dot, turning slowly (~12s/rev); the saw blade is
// now STATIC (no spin), drawn with the same outline+shading; the ember glow is a
// small 2px core with a gentle pulse. Everything freezes legibly under reduced
// motion.
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
      // Four tapered sails on a hub, mounted on the mill tower's upper front,
      // turning slowly (~12s/rev). Static (reduced motion) → a calm X pose.
      const blades = scene.add.graphics({ x: sx, y: sy - 70 }).setDepth(sy + 3);
      for (const deg of [0, 90, 180, 270]) {
        drawBlade(blades, (deg * Math.PI) / 180);
      }
      // Hub: an outlined wood dot.
      blades.fillStyle(C.woodDark, 1);
      blades.fillCircle(0, 0, 3.5);
      blades.lineStyle(1, C.ink, 1);
      blades.strokeCircle(0, 0, 3.5);
      objects.push(blades);
      if (animate) {
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
      // An OPEN TIMBER YARD (no house base): the frame comes from BUILDING_ART;
      // here we add the slant canopy over it, a stacked log pile, and a big STATIC
      // circular saw (no spin) drawn with the same outline + two-tone shading.
      const canopy = addBlock(scene, 'roof-slant-brown', sx, sy - 4, BASE_DY + ROOF_DY)
        .setScale(0.82)
        .setDepth(sy + 1.5);
      objects.push(canopy);

      const logs = scene.add.graphics().setDepth(sy + 2);
      for (let i = 0; i < 3; i += 1) {
        const lx = sx - 26 + (i % 2) * 6;
        const ly = sy + 12 - i * 7;
        logs.fillStyle(C.wood, 1);
        logs.fillRoundedRect(lx - 12, ly - 4, 24, 8, 3);
        logs.lineStyle(1, C.ink, 1);
        logs.strokeRoundedRect(lx - 12, ly - 4, 24, 8, 3);
        logs.fillStyle(C.woodLight, 1);
        logs.fillCircle(lx + 11, ly, 4);
        logs.lineStyle(1, C.woodDark, 1);
        logs.strokeCircle(lx + 11, ly, 4);
      }
      objects.push(logs);

      // Static saw: an outlined stone disc, eight two-tone teeth, an outlined hub.
      const saw = scene.add.graphics({ x: sx + 20, y: sy - 34 }).setDepth(sy + 3);
      saw.fillStyle(C.stone, 1);
      saw.fillCircle(0, 0, 12);
      saw.lineStyle(1.5, C.ink, 1);
      saw.strokeCircle(0, 0, 12);
      for (let t = 0; t < 8; t += 1) {
        const a = (t / 8) * Math.PI * 2;
        // Two-tone tooth: cream leading, stone-dark trailing, ink outline.
        poly(saw, [[-3, -12], [0, -12], [0, -17]], a, C.cream);
        poly(saw, [[0, -12], [3, -12], [0, -17]], a, C.stoneDark);
        outline(saw, [[-3, -12], [3, -12], [0, -17]], a, C.ink, 1);
      }
      saw.fillStyle(C.stoneDark, 1);
      saw.fillCircle(0, 0, 3.5);
      saw.lineStyle(1, C.ink, 1);
      saw.strokeCircle(0, 0, 3.5);
      // Frozen at a pleasant angle — no rotation tween at all.
      saw.setAngle(22);
      objects.push(saw);
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
