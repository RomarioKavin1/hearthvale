// Per-building DISTINCT accents (Task E3, part 2).
//
// The Sketch Town pack only ships base+roof block variants, so every producer
// otherwise reads as a slightly different cottage ("the windmill looks like a
// house"). This module composes a hand-drawn, PALETTE-ONLY accent on top of each
// building's base+roof so its silhouette is unmistakable at map zoom: the
// windmill's turning sails, the kiln's ember + chimney, the sawmill's spinning
// saw blade + log pile, the bakery's striped awning, the manor's balcony + hedges,
// the quarry's dug pit, and per-tier house upgrades. Shared by the live Village
// scene AND the ?artdebug verification surface so both render identically.
//
// All geometry is anchored to the tile's top-face centre (sx, sy) — the same
// point addBlock/addSurface place from — with vertical offsets tuned against the
// base (BASE_DY = −45) and roof (BASE_DY + ROOF_DY = −90) block steps. Everything
// draws exclusively from the shared PAL palette (no stray hex).

import type { GameObjects, Scene, Tweens } from 'phaser';
import { PAL } from '../../shared/palette';
import type { BuildingId, Tier } from '../../shared/types';
import { addSurface } from './render';

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

/** Fill (and stroke) a quad given local points rotated by `rad` about (0,0). */
const quad = (
  g: GameObjects.Graphics,
  pts: ReadonlyArray<readonly [number, number]>,
  rad: number,
  fill: number,
  stroke?: number
): void => {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const r = pts.map(([px, py]) => [px * cos - py * sin, px * sin + py * cos] as const);
  g.fillStyle(fill, 1);
  g.beginPath();
  g.moveTo(r[0]![0], r[0]![1]);
  for (let i = 1; i < r.length; i += 1) g.lineTo(r[i]![0], r[i]![1]);
  g.closePath();
  g.fillPath();
  if (stroke !== undefined) {
    g.lineStyle(1.5, stroke, 1);
    g.strokePath();
  }
};

/**
 * Compose the distinctive accent for `id` at tier `tier`, anchored on the tile
 * top-face centre (sx, sy). `animate` runs the living motion (blade/saw spin,
 * ember pulse); when false (reduced motion, or the static ArtDebug rows) the
 * moving parts freeze in a legible pose.
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
      // Four-blade sail cross mounted high on the front face, slowly turning.
      const blades = scene.add.graphics({ x: sx, y: sy - 74 }).setDepth(sy + 3);
      const sail = [
        [-2.5, -6],
        [2.5, -6],
        [7, -30],
        [-7, -30],
      ] as const;
      for (const deg of [0, 90, 180, 270]) {
        quad(blades, sail, (deg * Math.PI) / 180, C.cream, C.wood);
      }
      blades.fillStyle(C.woodDark, 1);
      blades.fillCircle(0, 0, 4);
      objects.push(blades);
      if (animate) {
        tweens.push(
          scene.tweens.add({
            targets: blades,
            angle: 360,
            duration: 6000,
            repeat: -1,
            ease: 'Linear',
          })
        );
      } else {
        blades.setAngle(45);
      }
      break;
    }

    case 'kiln': {
      // A brick chimney stub venting from the dome top, plus a warm ember glow at
      // the oven mouth on the front face.
      const chimney = scene.add.graphics().setDepth(sy + 3);
      chimney.fillStyle(C.stoneDark, 1);
      chimney.fillRect(sx + 6, sy - 112, 8, 20);
      chimney.fillStyle(C.stone, 1);
      chimney.fillRect(sx + 6, sy - 114, 8, 4);
      objects.push(chimney);

      const ember = scene.add.graphics().setDepth(sy + 3);
      ember.fillStyle(C.accent, 0.9);
      ember.fillCircle(sx, sy - 30, 6);
      ember.fillStyle(C.glow, 1);
      ember.fillCircle(sx, sy - 30, 3);
      objects.push(ember);
      if (animate) {
        tweens.push(
          scene.tweens.add({
            targets: ember,
            alpha: 0.45,
            duration: 900,
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
      // A big teethed circular saw blade mounted on the mill's flank, spinning
      // slowly, over a small stacked log pile.
      const logs = scene.add.graphics().setDepth(sy + 2);
      for (let i = 0; i < 3; i += 1) {
        const lx = sx - 26 + (i % 2) * 6;
        const ly = sy + 12 - i * 7;
        logs.fillStyle(C.wood, 1);
        logs.fillRoundedRect(lx - 12, ly - 4, 24, 8, 3);
        logs.fillStyle(C.woodLight, 1);
        logs.fillCircle(lx + 11, ly, 4);
        logs.lineStyle(1, C.woodDark, 1);
        logs.strokeCircle(lx + 11, ly, 4);
      }
      objects.push(logs);

      const saw = scene.add.graphics({ x: sx + 20, y: sy - 40 }).setDepth(sy + 3);
      saw.fillStyle(C.stone, 1);
      saw.fillCircle(0, 0, 13);
      // Teeth: eight little triangles around the rim.
      for (let t = 0; t < 8; t += 1) {
        const a = (t / 8) * Math.PI * 2;
        quad(
          saw,
          [
            [-3, -13],
            [3, -13],
            [0, -18],
          ],
          a,
          C.cream
        );
      }
      saw.fillStyle(C.stoneDark, 1);
      saw.fillCircle(0, 0, 4);
      saw.lineStyle(1.5, C.stoneDark, 1);
      saw.strokeCircle(0, 0, 13);
      objects.push(saw);
      if (animate) {
        tweens.push(
          scene.tweens.add({
            targets: saw,
            angle: 360,
            duration: 4200,
            repeat: -1,
            ease: 'Linear',
          })
        );
      } else {
        saw.setAngle(22);
      }
      break;
    }

    case 'bakery': {
      // A striped shop awning slung over the front (chimney smoke is added by the
      // scene's ambient layer). Four alternating cream/red slats on a slanted band.
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
      // Scalloped lower lip.
      awning.fillStyle(C.woodDark, 1);
      awning.fillRect(x0, topY - 2, slat * 4, 3);
      objects.push(awning);
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
      // window at tier 2, plus a gold eave trim at tier 3.
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
