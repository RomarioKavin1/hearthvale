/**
 * HiDPI render scale (H8). The game's drawing buffer is sized to CSS px × this
 * factor (see `applyHiDpiScale` in game.ts) so sprites render at native device
 * resolution instead of being upscaled by the browser — the source of the blurry
 * / pixelated ready bubbles on Retina phones. One game pixel therefore equals
 * `1 / renderScale()` CSS pixels: anything expressed in screen-feel units
 * (camera zoom clamps, tap slop, UI text sizes) multiplies by this.
 *
 * Capped at 3 so ultra-high-density screens don't quadruple the fill rate.
 */
export const renderScale = (): number => {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(Math.max(dpr, 1), 3);
};
