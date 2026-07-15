// Per-building DISTINCT accents (Task E3 part 2 → H1 style pass).
//
// The Sketch Town pack ships only base+roof block variants, so H1 gives each
// special building a NON-HOUSE construction grammar (windmill = round stone
// tower, sawmill = open timber yard, kiln = oven dome, bakery = shop, manor =
// estate — see manifest BUILDING_ART) and this module hand-draws the small
// living/identifying accent on top: the windmill's turning sails, the sawmill's
// watercolour-textured CIRCULAR SAW BLADE rising half-buried from the log it cuts
// (H5) over a small timber yard, the kiln's chimney + ember, the bakery's
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
// SE face instead of a screen-plane circle. (H5: the sawmill's circular blade is
// likewise mounted in a foreshortened container so the toothed disc sits in the
// log's iso side-plane; see the sawmill case below.) The windmill sails read as
// part of the diorama rather than a sticker on the glass.
//
// All geometry is anchored to the tile's top-face centre (sx, sy) — the same
// point addBlock/addSurface place from — with vertical offsets tuned against the
// base (BASE_DY = −45) and roof (BASE_DY + ROOF_DY = −90) block steps. Everything
// draws exclusively from the shared PAL palette (no stray hex).

import type { GameObjects, Scene, Tweens } from 'phaser';
import { PAL } from '../../shared/palette';
import type { BuildingId, Tier } from '../../shared/types';
import { addBlock, addSurface, BASE_DY } from './render';

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

/** Shared texture key for the hand-drawn circular saw blade (built once). */
const SAW_TEX = 'hv-saw-blade';

/**
 * Build the sawmill's circular SAW BLADE as a ONE-OFF canvas texture (H5) that
 * matches the Kenney Sketch Town watercolour/ink look — instead of the flat 2D
 * disc and the drawn iso-ellipse that both clashed before. Painted with:
 *   • a soft warm-steel radial gradient body (upper-left glint → warm shadow), so
 *     it reads as watercolour volume, not a flat fill;
 *   • a ring of sketchy angled rip-saw TEETH around the rim;
 *   • a brown ink outline (~3px) on the whole tooth silhouette + inner ring +
 *     radial spokes + a hub, echoing the pack's hand-inked linework;
 *   • an off-white paper tint halo bleeding just past the teeth.
 * Generated at 128px for crisp downscaling; drawn ONCE (idempotent on the key),
 * then mounted as a normal image so it can be foreshortened + slowly spun.
 */
const ensureSawBladeTexture = (scene: Scene): void => {
  if (scene.textures.exists(SAW_TEX)) return;
  const S = 128;
  const tex = scene.textures.createCanvas(SAW_TEX, S, S);
  if (!tex) return;
  const ctx = tex.getContext();
  const cx = S / 2;
  const cy = S / 2;
  const tip = 52; // tooth-tip radius
  const gullet = 42; // valley between teeth
  const body = 44; // blade body radius (inner ring sits just inside)
  const n = 12; // teeth

  // Tooth silhouette: alternating tip / gullet points, teeth raked one way (a
  // rip-saw slant) so a slow spin reads as turning.
  const toothPath = (): void => {
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const aTip = ((i - 0.28) / n) * Math.PI * 2 - Math.PI / 2;
      const aGul = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
      const tx = cx + Math.cos(aTip) * tip;
      const ty = cy + Math.sin(aTip) * tip;
      const gx = cx + Math.cos(aGul) * gullet;
      const gy = cy + Math.sin(aGul) * gullet;
      if (i === 0) ctx.moveTo(tx, ty);
      else ctx.lineTo(tx, ty);
      ctx.lineTo(gx, gy);
    }
    ctx.closePath();
  };

  // Soft off-white paper halo just past the teeth (watercolour bleed).
  ctx.fillStyle = PAL.cream;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.arc(cx, cy, tip + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Body: warm-steel radial gradient (glint upper-left → warm shadow lower-right).
  const grd = ctx.createRadialGradient(cx - 15, cy - 17, 4, cx, cy, tip);
  grd.addColorStop(0, PAL.cream);
  grd.addColorStop(0.3, PAL.steel);
  grd.addColorStop(1, PAL.steelDark);
  toothPath();
  ctx.fillStyle = grd;
  ctx.fill();

  // Inner ring + radial spokes + hub, in brown ink.
  ctx.strokeStyle = PAL.woodDark;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, body - 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  for (let k = 0; k < 6; k += 1) {
    const a = (k / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9);
    ctx.lineTo(cx + Math.cos(a) * (body - 6), cy + Math.sin(a) * (body - 6));
    ctx.stroke();
  }
  // Hub (arbor): brown disc with a light centre bore.
  ctx.fillStyle = PAL.woodDark;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.steel;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Ink the whole tooth silhouette last so the outline sits over everything.
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = PAL.woodDark;
  toothPath();
  ctx.stroke();

  tex.refresh();
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
      // SAW MILL (H5) — the identifying element is now the CIRCULAR SAW BLADE the
      // user asked for, painted as a watercolour/ink TEXTURE (ensureSawBladeTexture)
      // that matches the pack instead of the flat disc / drawn ellipse that clashed
      // before. The blade rises out of the log the mill is cutting: the manifest
      // primary (balcony-wood = a bundle of round sawn timbers) is the woodpile
      // behind; a single "log being cut" (fence-wood) crosses the FRONT so the
      // blade's lower third is occluded — it reads as HALF-BURIED, sawing through
      // the log, not a sticker on the glass. A tidy finished-PLANK stack (bridge)
      // sits to the output side. Everything grounds on the tile (no floating cage).
      const t = tier;
      ensureSawBladeTexture(scene);

      // Yard-prop helper: a pack sprite resting ON the tile surface (addSurface's
      // one-block lift), nudged by (dx,dy) and scaled to clutter size.
      const yard = (
        key: Parameters<typeof addBlock>[1],
        dx: number,
        dy: number,
        scale: number,
        depth: number,
        flip = false
      ): GameObjects.Image => {
        const o = addBlock(scene, key, sx + dx, sy + dy, BASE_DY).setScale(scale).setDepth(depth);
        if (flip) o.setFlipX(true);
        objects.push(o);
        return o;
      };

      // A spare LOG in the woodpile behind the blade (flanks the manifest primary),
      // and a second course at tier >= 2 — a proper timber stack.
      yard('balcony-wood', -26, 12, 0.6, sy + 2.3, true);
      if (t >= 2) yard('balcony-wood', -30, 4, 0.5, sy + 2.35);

      // THE SAW BLADE — the hero. Mounted rising from the top log, inside a
      // FORESHORTENED container (scaleX < 1 + a slight lean) so the toothed disc
      // sits in the log's iso side-plane rather than flat-on to the camera, yet
      // stays round enough to read unmistakably as a saw. Drawn ABOVE the woodpile
      // but BELOW the front cutting-log so its base is buried in the cut.
      const face = scene.add.container(sx - 1, sy - 30);
      face.setScale(0.9, 1);
      face.setRotation(-0.14);
      face.setDepth(sy + 2.7);
      const blade = scene.add.image(0, 0, SAW_TEX).setDisplaySize(56, 56);
      face.add(blade);
      objects.push(face);
      if (animate) {
        // Extremely slow spin (~18s/rev) of the textured disc INSIDE the skewed
        // container, so the sweep stays a stable foreshortened ellipse.
        tweens.push(
          scene.tweens.add({
            targets: blade,
            angle: 360,
            duration: 18000,
            repeat: -1,
            ease: 'Linear',
          })
        );
      }

      // THE LOG BEING CUT (front-centre): a round log laid across the FRONT, drawn
      // over the blade's lower third so the blade emerges through it — the clearest
      // "this is a sawmill" cue. Grounds the blade so it never floats.
      yard('fence-wood', 3, 2, 0.56, sy + 3.4);

      // FINISHED-PLANK stack (front-right): sawn boards leaving the yard. Grows a
      // course at tier >= 2; a spare log joins at tier >= 3.
      const planks = yard('bridge', 28, 13, 0.58, sy + 3.5);
      if (t >= 2) yard('bridge', 31, 5, 0.5, sy + 3.55);
      if (t >= 3) yard('balcony-wood', 32, -3, 0.44, sy + 3.6, true);

      // Subtle "yard is working" alpha shimmer on the plank stack (~2.4s). Reduced
      // motion → static full alpha. The reusable tween is torn down with the tile.
      if (animate) {
        tweens.push(
          scene.tweens.add({
            targets: planks,
            alpha: 0.82,
            duration: 2400,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
          })
        );
      }
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
