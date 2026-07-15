import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { BG } from './art/render';
import { renderScale } from './dpr';
import { ArtDebug } from './scenes/ArtDebug';
import { Boot } from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { Village } from './scenes/Village';
import { initHud } from './ui/hud';

// Dev-only art verification surface, opt-in via the `?artdebug` query string.
const ART_DEBUG =
  typeof location !== 'undefined' && location.search.includes('artdebug');

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: BG,
  // Sketch Town sprites are smooth (not pixel art); round placement to whole
  // pixels to avoid shimmer, but keep bilinear scaling (pixelArt stays off).
  render: { roundPixels: true },
  // Always register touch listeners (Phaser only auto-enables them when the
  // device reports touch support). Real phones are unaffected; this keeps the
  // touch path testable on desktop and covers touch-capable laptops.
  input: { touch: true },
  // NONE + a manual HiDPI resize (H8): the RESIZE mode sizes the canvas backing
  // store to CSS pixels only, so on a Retina phone (devicePixelRatio 2–3) the
  // browser upscaled a 1× canvas → every sprite, and the thin ready-collect
  // bubble especially, rendered blurry/pixelated. Here the drawing buffer is sized
  // to CSS×dpr while CSS layout stays 1×, so the game renders at native device
  // resolution. `applyHiDpiScale` keeps this in sync on every viewport change.
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: 1024,
    height: 768,
  },
  scene: ART_DEBUG
    ? [ArtDebug, Boot, Preloader, Village]
    : [Boot, Preloader, Village],
};

const StartGame = (parent: string): Game => {
  return new Game({ ...config, parent });
};

/**
 * Size the game to the host element at native device resolution. The backing
 * store becomes CSS×dpr (crisp on Retina); Phaser's `zoom = 1/dpr` scales the
 * canvas's CSS box back down to the layout size, so one game unit stays one CSS
 * pixel and all camera/input math is unchanged. dpr is capped at 3 so a very high
 * ratio can't blow up the fill-rate on low-power phones.
 */
const applyHiDpiScale = (game: Game): void => {
  const host = document.getElementById('game-container');
  const w = host?.clientWidth || window.innerWidth;
  const h = host?.clientHeight || window.innerHeight;
  const dpr = renderScale();
  game.scale.setZoom(1 / dpr);
  game.scale.resize(Math.round(w * dpr), Math.round(h * dpr));
};

document.addEventListener('DOMContentLoaded', () => {
  const game = StartGame('game-container');
  const resize = (): void => applyHiDpiScale(game);
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  // Debug/verification handle: lets the dev harness (and manual QA) inspect
  // camera zoom / input state without threading the instance through the DOM.
  Reflect.set(window, '__hvGame', game);
  initHud(game);
});
