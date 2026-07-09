import type { Game } from 'phaser';
import { showLoginPrompt, showToast } from '@devvit/web/client';
import { PAL } from '../../shared/palette';
import type {
  BuildingId,
  FestivalCategory,
  Good,
  PlayerState,
  QuestView,
  StateResponse,
  TileState,
  Weather,
} from '../../shared/types';
import { questAt, questProgress, questSnapshot } from '../../shared/quests';
import { hallPerks } from '../../shared/catalog';
import type { SpriteKey } from '../art/manifest';
import { BUILDING_ART, isIconKey, SPRITES } from '../art/manifest';
import { parseKey } from '../../shared/logic/grid';
import {
  accrue,
  adjacencyBonus,
  goodsTotal,
  utcDay,
} from '../../shared/logic/economy';
import { store } from '../state';

/**
 * DOM utility layer for the HUD (Task 6).
 *
 * Everything visual is built programmatically with `createElement` so the types
 * stay exact (no casts), styled through one injected `<style>` block whose
 * colours are interpolated straight from `PAL` — the single palette source. Also
 * houses the toast stack, the pending-action registry (so buttons stay disabled
 * across re-renders), small formatters and a couple of `store` derivations that
 * both the top bar and the sheets need.
 */

// ── Element builders ─────────────────────────────────────────────────────────

type Attrs = Record<string, string | number | boolean>;
type Handlers = Record<string, (e: Event) => void>;

export type ElOpts = {
  cls?: string;
  text?: string;
  attrs?: Attrs;
  on?: Handlers;
  children?: Node[];
};

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOpts = {}
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (opts.cls !== undefined) node.className = opts.cls;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, String(v));
  }
  if (opts.on) {
    for (const [k, fn] of Object.entries(opts.on)) node.addEventListener(k, fn);
  }
  if (opts.children) {
    for (const c of opts.children) node.appendChild(c);
  }
  return node;
};

export const clearNode = (node: HTMLElement): void => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

// ── Tooltips ─────────────────────────────────────────────────────────────────
// One shared, viewport-clamped bubble. Desktop: hover (300ms delay) shows it
// above the target. Touch: a long-press (450ms) shows it for 2.5s. Every tooltip
// also writes an `aria-label` so the meaning is available without a pointer.

let tipEl: HTMLElement | undefined;
let tipTimer: number | undefined;

const ensureTip = (): HTMLElement => {
  if (!tipEl) {
    tipEl = el('div', {
      cls: 'hv-tip',
      attrs: { role: 'tooltip', 'aria-hidden': 'true' },
    });
    (document.getElementById('hv-hud') ?? document.body).appendChild(tipEl);
  }
  return tipEl;
};

const positionTip = (target: HTMLElement, text: string): void => {
  const tip = ensureTip();
  tip.textContent = text;
  tip.classList.add('is-in');
  tip.setAttribute('aria-hidden', 'false');
  const r = target.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const left = Math.max(
    6,
    Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 6)
  );
  const above = r.top - th - 8;
  const top = above >= 6 ? above : r.bottom + 8; // flip below when clipped at top
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
};

/**
 * Hide the shared tooltip bubble and cancel any pending show. Exported so the
 * sheet manager can dismiss a bubble whose target is about to be re-rendered or
 * torn down (pointerleave never fires on a destroyed node, which would leave a
 * stale bubble floating).
 */
export const hideTip = (): void => {
  if (tipTimer !== undefined) {
    window.clearTimeout(tipTimer);
    tipTimer = undefined;
  }
  if (tipEl) {
    tipEl.classList.remove('is-in');
    tipEl.setAttribute('aria-hidden', 'true');
  }
};

/**
 * Attach a tooltip to `node`. `text` may be a getter so chips whose meaning
 * changes with state (weather/festival) always show the current line. A static
 * string also sets the `aria-label`; dynamic callers own their `aria-label`.
 */
export const withTip = <T extends HTMLElement>(
  node: T,
  text: string | (() => string)
): T => {
  const read = typeof text === 'function' ? text : (): string => text;
  if (typeof text === 'string') node.setAttribute('aria-label', text);
  node.removeAttribute('title');

  node.addEventListener('pointerenter', (e) => {
    if (e instanceof PointerEvent && e.pointerType !== 'mouse') return;
    if (tipTimer !== undefined) window.clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => positionTip(node, read()), 300);
  });
  node.addEventListener('pointerleave', hideTip);
  node.addEventListener('pointercancel', hideTip);
  node.addEventListener('pointerdown', (e) => {
    if (e instanceof PointerEvent && e.pointerType === 'mouse') {
      hideTip();
      return;
    }
    if (tipTimer !== undefined) window.clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => {
      positionTip(node, read());
      window.setTimeout(hideTip, 2500);
    }, 450);
  });
  node.addEventListener('pointerup', () => {
    // A tap shorter than the long-press threshold cancels the pending bubble.
    if (tipTimer !== undefined) {
      window.clearTimeout(tipTimer);
      tipTimer = undefined;
    }
  });
  return node;
};

// ── Building-icon data URLs (extracted from Phaser textures) ─────────────────

let gameRef: Game | undefined;
const iconCache = new Map<string, string>();

export const setGame = (g: Game): void => {
  gameRef = g;
};

/** A `data:` URL for a building's icon texture, or '' before art is ready. */
export const iconUrl = (id: BuildingId): string => {
  const cached = iconCache.get(id);
  if (cached !== undefined) return cached;
  const key = `icon_${id}`;
  if (!gameRef || !gameRef.textures.exists(key)) return '';
  const url = gameRef.textures.getBase64(key);
  iconCache.set(id, url);
  return url;
};

// ── Sprite-icon elements ─────────────────────────────────────────────────────
// The single way the HUD renders an icon. Game-icons (white PNGs) are drawn as a
// CSS mask tinted to `currentColor`, so they read correctly on both light chips
// (ink) and dark toasts (cream) with no per-call colour bookkeeping. Colourful
// diorama/goods sprites are drawn as plain <img> (image-rendering:auto), used
// as-is with no tint.
export const iconEl = (key: SpriteKey, size = 18): HTMLElement => {
  const path = SPRITES[key];
  if (isIconKey(key)) {
    return el('span', {
      cls: 'hv-icon hv-icon-mask',
      attrs: {
        role: 'presentation',
        style: `width:${size}px;height:${size}px;-webkit-mask-image:url(${path});mask-image:url(${path})`,
      },
    });
  }
  return el('img', {
    cls: 'hv-icon hv-icon-img',
    attrs: { src: path, width: size, height: size, alt: '', 'aria-hidden': 'true' },
  });
};

// ── Goods presentation ───────────────────────────────────────────────────────
// No dedicated good sprites ship in the pack, so each good borrows the closest
// diorama sprite (used as-is, no tint). Distinct silhouettes at a glance:
//   wheat → golden cropped field · logs → pine tree · stone → raw rock pile
//   flour → pale beige block (a flour sack) · planks → wooden fence (cut planks)
//   bricks → beige stone wall (finished masonry).
export const GOOD_SPRITE: Record<Good, SpriteKey> = {
  wheat: 'furrow-crop-wheat',
  logs: 'tree-pine',
  stone: 'rocks-dirt',
  flour: 'building-center-beige',
  planks: 'fence-wood',
  bricks: 'building-window-beige',
};

export const GOOD_LABEL: Record<Good, string> = {
  wheat: 'Wheat',
  logs: 'Logs',
  stone: 'Stone',
  flour: 'Flour',
  planks: 'Planks',
  bricks: 'Bricks',
};

export const goodIcon = (good: Good, size = 18): HTMLElement =>
  iconEl(GOOD_SPRITE[good], size);

/** The representative sprite for a building's card icon: a stacked building's
 * wall base (a recognisable house silhouette) or a flat piece's tier-1 sprite. */
export const buildingIconKey = (id: BuildingId): SpriteKey => {
  const art = BUILDING_ART[id];
  if (art.kind === 'stacked') return art.base;
  return art.byTier[1][0] ?? 'grass-center';
};

// ── Category presentation ────────────────────────────────────────────────────

export type CatMeta = { label: string; icon: SpriteKey; color: string };

/** Festival categories, with v2 display names (raw→Harvest, processed→Craft). */
export const CATEGORY_META: Record<FestivalCategory, CatMeta> = {
  coins: { label: 'Coins', icon: 'icon-coin', color: PAL.roofStraw },
  raw: { label: 'Harvest', icon: 'furrow-crop-wheat', color: PAL.leaf },
  processed: { label: 'Craft', icon: 'icon-hammer', color: PAL.wood },
  decor: { label: 'Decor', icon: 'icon-star', color: PAL.accent },
};

// ── Weather presentation ─────────────────────────────────────────────────────
// The game-icons pack has no literal weather art, so each weather borrows the
// closest-reading white icon (documented in the V4 report); the label carries
// the meaning.
export type WeatherMeta = { label: string; icon: SpriteKey };
export const WEATHER_META: Record<Weather, WeatherMeta> = {
  sunny: { label: 'Sunny', icon: 'icon-star' },
  rain: { label: 'Rain', icon: 'icon-arrow-down' },
  clear: { label: 'Clear', icon: 'icon-check' },
  harvestmoon: { label: 'Harvest Moon', icon: 'icon-trophy' },
};

/** Plain-language tooltip for the weather chip (what today's sky pays). */
export const WEATHER_TIP: Record<Weather, string> = {
  sunny: 'Sunny: every producer earns +10% today',
  rain: 'Rain: wheat and logs produce +30% today',
  clear: 'Clear skies — no weather bonus today',
  harvestmoon: 'Harvest Moon: every producer earns +50% today',
};

/** Plain-language tooltip for the festival chip (what today's festival favours). */
export const FESTIVAL_TIP: Record<FestivalCategory, string> = {
  coins: 'Coin Festival: coin buildings earn ×1.5 today',
  raw: 'Harvest Festival: raw goods produce ×1.5 today',
  processed: 'Craft Festival: workshops produce ×1.5 today',
  decor: 'Decor Festival: decorations boost ×1.5 today',
};

// ── Formatting ───────────────────────────────────────────────────────────────

export const fmtInt = (n: number): string =>
  Math.round(n).toLocaleString('en-US');

/** Milliseconds → `m:ss` (or `h:mm:ss` past an hour). */
export const fmtDur = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (v: number): string => (v < 10 ? `0${v}` : `${v}`);
  if (h > 0) return `${h}:${two(m)}:${two(s)}`;
  return `${m}:${two(s)}`;
};

/** Seconds → friendly build time, e.g. `45s`, `2m`, `1m 30s`. */
export const fmtBuildTime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
};

export const pctStr = (frac: number): string =>
  `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;

// ── Store derivations ────────────────────────────────────────────────────────

export const meId = (data: StateResponse): string | null => data.me?.id ?? null;

export const ownedTiles = (
  data: StateResponse,
  id: string
): Array<{ key: string; tile: TileState }> => {
  const out: Array<{ key: string; tile: TileState }> = [];
  for (const [key, tile] of Object.entries(data.grid)) {
    if (tile.owner === id) out.push({ key, tile });
  }
  return out;
};

export const ownedCount = (data: StateResponse, id: string): number => {
  let n = 0;
  for (const tile of Object.values(data.grid)) {
    if (tile.owner === id) n += 1;
  }
  return n;
};

/** Count of the player's own tiles with something ready to collect. */
export const readyCount = (data: StateResponse, id: string, now: number): number => {
  const fest = data.city.festival;
  const stockpile = data.stockpile;
  let n = 0;
  for (const [key, tile] of Object.entries(data.grid)) {
    if (tile.owner !== id || tile.buildingId === undefined) continue;
    if (now < tile.readyAt) continue;
    const { x, y } = parseKey(key);
    const adj = adjacencyBonus(data.grid, x, y, fest, now);
    const { gained } = accrue(tile, now, fest, adj, data.city.weather, stockpile);
    if (gained.coins + goodsTotal(gained.goods) > 0) n += 1;
  }
  return n;
};

export const todayUtc = (): string => utcDay(store.serverNow());

/**
 * The player's active quest, computed client-side from the same pure functions
 * the server uses for `StateResponse.quest`. Every mutation response updates
 * `data.me` (including the quest counters) and emits `'change'`, so deriving the
 * view here keeps the Journal banner + sheet live between full state refreshes
 * (which alone would leave `data.quest` stale). Returns null when logged out.
 */
export const activeQuest = (data: StateResponse): QuestView | null => {
  const me = data.me;
  if (!me) return null;
  const quest = questAt(me.questIndex, me.questLap);
  const snap = questSnapshot(data.grid, me.id);
  const { have, done } = questProgress(quest, me, snap, me.questBaseline);
  return {
    index: me.questIndex,
    lap: me.questLap,
    title: quest.title,
    blurb: quest.blurb,
    have,
    target: quest.target,
    reward: quest.reward,
    done,
  };
};

/** Boosts a player still has today (accounting for the UTC date rollover). The
 * daily limit rises with the Village Hall's `boostLimit` perk (5 → 7 at L4),
 * matching the server-side check in doBoost. */
export const boostsLeft = (me: PlayerState, hallLevel: number): number => {
  const used = me.boostsDate === todayUtc() ? me.boostsToday : 0;
  return Math.max(0, hallPerks(hallLevel).boostLimit - used);
};

// ── Pending-action registry ──────────────────────────────────────────────────
// Keeps buttons disabled across the frequent re-renders driven by store changes
// and countdown ticks.

const pending = new Set<string>();
export const isPending = (key: string): boolean => pending.has(key);
export const markPending = (key: string): void => {
  pending.add(key);
};
export const clearPending = (key: string): void => {
  pending.delete(key);
};

// ── Login + native toast passthroughs ────────────────────────────────────────

export const promptLogin = (): void => showLoginPrompt();

/** Surface an API error through Reddit's native (system-level) toast. */
export const notifyError = (message: string): void => showToast(message);

// ── In-DOM toast stack (gain feedback) ───────────────────────────────────────

export type ToastKind = 'gain' | 'info' | 'celebrate';

let toastHost: HTMLElement | undefined;

export const mountToasts = (parent: HTMLElement): void => {
  toastHost = el('div', { cls: 'hv-toast-host' });
  parent.appendChild(toastHost);
};

export const toast = (text: string, kind: ToastKind = 'info'): void => {
  if (!toastHost) return;
  const t = el('div', { cls: `hv-toast hv-toast-${kind}`, text });
  toastHost.appendChild(t);
  // Force a reflow so the enter transition runs, then flag it visible.
  void t.offsetWidth;
  t.classList.add('is-in');
  window.setTimeout(() => {
    t.classList.remove('is-in');
    window.setTimeout(() => t.remove(), 260);
  }, 2500);
};

/**
 * A longer-lived toast carrying a single action button (e.g. "Share it?").
 * Auto-dismisses after `timeoutMs`; tapping the button runs `onAction` and
 * closes early. Used for the opt-in share prompt after a milestone.
 */
export const toastAction = (
  text: string,
  actionLabel: string,
  onAction: () => void,
  timeoutMs = 5000
): void => {
  if (!toastHost) return;
  const btn = el('button', {
    cls: 'hv-toast-btn',
    text: actionLabel,
    attrs: { type: 'button' },
  });
  const t = el('div', {
    cls: 'hv-toast hv-toast-action',
    children: [el('span', { text }), btn],
  });
  toastHost.appendChild(t);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    t.classList.remove('is-in');
    window.setTimeout(() => t.remove(), 260);
  };
  btn.addEventListener('click', () => {
    onAction();
    close();
  });

  void t.offsetWidth;
  t.classList.add('is-in');
  window.setTimeout(close, timeoutMs);
};

// ── Stylesheet (colours interpolated from PAL) ───────────────────────────────

let stylesInjected = false;

export const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'hv-hud-style';
  style.textContent = CSS;
  document.head.appendChild(style);
};

const CSS = `
@font-face {
  font-family: 'Fredoka';
  font-weight: 300 700;
  font-display: swap;
  src: url('/fonts/fredoka.woff2') format('woff2');
}

:root {
  --ink: ${PAL.ink};
  --cream: ${PAL.cream};
  --wall: ${PAL.wall};
  --wall-shade: ${PAL.wallShade};
  --wood: ${PAL.wood};
  --wood-dark: ${PAL.woodDark};
  --wood-light: ${PAL.woodLight};
  --glow: ${PAL.glow};
  --accent: ${PAL.accent};
  --leaf: ${PAL.leaf};
  --straw: ${PAL.roofStraw};
  --red: ${PAL.roofRed};
  --stone: ${PAL.stone};
  --night: ${PAL.night};
  --sat: env(safe-area-inset-top);
  --sab: env(safe-area-inset-bottom);
  --sal: env(safe-area-inset-left);
  --sar: env(safe-area-inset-right);
}

#hv-hud {
  position: fixed;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  font-family: 'Fredoka', ui-rounded, system-ui, sans-serif;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
#hv-hud * { box-sizing: border-box; }

.hv-pixel { image-rendering: pixelated; }

/* ── Sprite icons ────────────────────────────────────────── */
.hv-icon { flex: 0 0 auto; display: inline-block; vertical-align: middle; }
.hv-icon-img { image-rendering: auto; object-fit: contain; }
.hv-icon-mask {
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain;
}

/* ── Top bar (full-width ink bar) ────────────────────────── */
.hv-topbar {
  pointer-events: auto;
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: calc(var(--sat) + 8px) calc(var(--sar) + 12px) 8px calc(var(--sal) + 12px);
  background: rgba(59,51,71,0.92);
  border-bottom: 2px solid rgba(255,243,217,0.14);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
}
.hv-tb-left, .hv-tb-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.hv-tb-center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
}

.hv-chip {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 11px;
  background: var(--cream);
  border: 2px solid var(--ink);
  border-radius: 8px;
  box-shadow: 0 2px 0 rgba(0,0,0,0.28);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.3px;
  line-height: 1;
  color: var(--ink);
  font-family: inherit;
  cursor: pointer;
}
.hv-chip:active { transform: translateY(1px); }
.hv-chip-num { font-variant-numeric: tabular-nums; }
.hv-chip .hv-icon-mask { color: var(--wood-dark); }

.hv-caret {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px; height: 34px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--cream);
  cursor: pointer;
}
.hv-caret .hv-icon-mask { color: var(--cream); }
.hv-caret .hv-icon { transition: transform 180ms ease-out; }
.hv-caret.is-open .hv-icon { transform: rotate(180deg); }
.hv-caret:active { transform: translateY(1px); }

.hv-ring {
  pointer-events: auto;
  position: relative;
  flex: 0 0 auto;
  width: 40px; height: 40px;
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--cream);
  -webkit-appearance: none;
  appearance: none;
}
.hv-ring svg { display: block; width: 40px; height: 40px; }
.hv-ring .hv-ring-lvl {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--cream);
  pointer-events: none;
}
.hv-ring:active { transform: translateY(1px); }

/* Weather + festival: cream-on-ink chips that truncate gracefully. */
.hv-tb-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  background: rgba(255,243,217,0.09);
  border: 1px solid rgba(255,243,217,0.16);
  border-radius: 8px;
  font-weight: 700;
  font-size: 12.5px;
  letter-spacing: 0.3px;
  color: var(--cream);
}
.hv-tb-chip .hv-tb-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hv-tb-chip .hv-icon-mask { color: var(--glow); }
.hv-tb-chip.hv-tb-fest .hv-icon-mask { color: var(--accent); }

.hv-signin-pill {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  background: var(--glow);
  border: 2px solid var(--ink);
  border-radius: 8px;
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.3px;
  color: var(--ink);
  cursor: pointer;
  box-shadow: 0 3px 0 var(--wood-dark);
}
.hv-signin-pill .hv-icon-mask { color: var(--wood-dark); }
.hv-signin-pill:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--wood-dark); }

/* ── FAB rail ─────────────────────────────────────────────── */
.hv-fabs {
  position: absolute;
  right: calc(var(--sar) + 12px);
  bottom: calc(var(--sab) + 12px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-end;
}
.hv-fab {
  pointer-events: auto;
  position: relative;
  width: 56px; height: 56px;
  min-width: 44px; min-height: 44px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 14px;
  box-shadow: 0 4px 0 var(--wood-dark);
  cursor: pointer;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: 0.3px;
}
.hv-fab .hv-icon-mask { color: var(--wood-dark); }
.hv-fab .hv-fab-cap { font-size: 9px; letter-spacing: 0.2px; }
.hv-fab.hv-primary { background: var(--glow); }
.hv-fab:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--wood-dark); }
.hv-fab[disabled] { opacity: 0.45; cursor: not-allowed; box-shadow: 0 3px 0 var(--wood-dark); transform: none; }
.hv-fab.is-checked { background: var(--wall-shade); }
.hv-fab.is-checked .hv-icon-mask { color: var(--ink); opacity: 0.6; }
/* Below a short viewport, drop the labels for icon-only FABs. */
@media (max-height: 399px) {
  .hv-fab { width: 52px; height: 52px; }
  .hv-fab .hv-fab-cap { display: none; }
}
.hv-fab-badge {
  position: absolute;
  top: -6px; right: -6px;
  min-width: 22px; height: 22px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--red);
  color: var(--cream);
  border: 2px solid var(--ink);
  border-radius: 11px;
  font-size: 11px;
  font-weight: 800;
}
.hv-fab .hv-streak {
  position: absolute;
  top: -6px; right: -6px;
  min-width: 22px; height: 22px;
  padding: 0 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: var(--cream);
  border: 2px solid var(--ink);
  border-radius: 11px;
  font-size: 11px;
  font-weight: 800;
}
/* Market "prices are high" pulsing dot. */
.hv-fab-pulse {
  position: absolute;
  top: -5px; right: -5px;
  width: 14px; height: 14px;
  background: var(--red);
  border: 2px solid var(--ink);
  border-radius: 7px;
}
.hv-fab-pulse::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 9px;
  border: 2px solid var(--red);
  animation: hv-pulse-ring 1.6s ease-out infinite;
}
@keyframes hv-pulse-ring {
  0% { transform: scale(1); opacity: 0.7; }
  100% { transform: scale(2.1); opacity: 0; }
}

/* ── Modal (centred card over a blurred backdrop) ────────── */
/* Explicit z-order: the backdrop/modal (20) sits ABOVE the top-left objectives
 * column (2) and the wallet drawer (3), so an open modal always covers them. */
.hv-backdrop {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(var(--sat) + 12px) calc(var(--sar) + 12px)
           calc(var(--sab) + 12px) calc(var(--sal) + 12px);
  background: rgba(46,40,55,0.55);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease-out;
}
.hv-backdrop.is-open { opacity: 1; pointer-events: auto; }

.hv-modal {
  width: min(440px, 100%);
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 14px;
  box-shadow: 0 6px 0 rgba(59,51,71,0.3);
  opacity: 0;
  transform: scale(0.96);
  transition: opacity 160ms ease-out, transform 160ms ease-out;
}
.hv-backdrop.is-open .hv-modal { opacity: 1; transform: scale(1); }

.hv-modal-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 12px;
  border-bottom: 2px solid var(--wall-shade);
}
.hv-modal-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-family: 'Fredoka', ui-rounded, system-ui, sans-serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.4px;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hv-modal-close {
  pointer-events: auto;
  flex: 0 0 auto;
  width: 34px; height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 8px;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  color: var(--ink);
}
.hv-modal-close:active { transform: translateY(2px); }
.hv-modal-body {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 16px;
}

/* ── Tooltip bubble ──────────────────────────────────────── */
.hv-tip {
  position: fixed;
  left: 0; top: 0;
  z-index: 60;
  max-width: 220px;
  padding: 6px 10px;
  background: var(--ink);
  color: var(--cream);
  border: 2px solid var(--glow);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: 0.2px;
  box-shadow: 0 3px 0 rgba(0,0,0,0.3);
  pointer-events: none;
  opacity: 0;
  transform: translateY(3px);
  transition: opacity 120ms ease-out, transform 120ms ease-out;
}
.hv-tip.is-in { opacity: 1; transform: none; }

/* ── Generic controls ────────────────────────────────────── */
.hv-btn {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 48px;
  padding: 0 16px;
  background: var(--glow);
  border: 3px solid var(--ink);
  border-bottom-width: 4px;
  border-radius: 10px;
  box-shadow: 0 4px 0 var(--wood-dark);
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.4px;
  color: var(--ink);
  cursor: pointer;
}
.hv-btn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--wood-dark); }
.hv-btn[disabled] { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: 0 4px 0 var(--wood-dark); }
.hv-btn.hv-btn-ghost { background: var(--wall); box-shadow: 0 4px 0 var(--wall-shade); }
.hv-btn.hv-btn-ghost:active { box-shadow: 0 1px 0 var(--wall-shade); }
.hv-btn.hv-btn-accent { background: var(--accent); color: var(--cream); }
.hv-btn.hv-btn-danger { color: var(--red); }
.hv-btn.hv-btn-danger.is-armed { background: var(--red); color: var(--cream); }

.hv-note { font-size: 12.5px; line-height: 1.5; color: var(--ink); opacity: 0.85; }
.hv-muted { opacity: 0.7; }
.hv-stack > * + * { margin-top: 12px; }
.hv-row-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13.5px; }
.hv-row-line b { font-variant-numeric: tabular-nums; }
.hv-stars { color: var(--straw); letter-spacing: 2px; font-size: 15px; }

.hv-swatches { display: flex; gap: 10px; }
.hv-swatch {
  flex: 1 1 0;
  height: 34px;
  border: 3px solid var(--ink);
  border-radius: 9px;
  box-shadow: 0 3px 0 var(--wood-dark);
  cursor: pointer;
  padding: 0;
}
.hv-swatch:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--wood-dark); }
.hv-swatch.is-selected { outline: 3px solid var(--glow); outline-offset: 2px; }
.hv-swatch[disabled] { cursor: default; }
.hv-swatch.is-selected[disabled] { opacity: 1; }
.hv-swatch[disabled]:not(.is-selected) { opacity: 0.55; }

.hv-fill {
  position: relative;
  height: 16px;
  background: var(--wall-shade);
  border: 3px solid var(--ink);
  border-radius: 8px;
  overflow: hidden;
}
.hv-fill > i {
  display: block;
  height: 100%;
  background: var(--leaf);
  transition: width 220ms ease-out;
}
.hv-fill.hv-fill-glow > i { background: var(--glow); }
.hv-fill-cap { font-size: 11px; font-weight: 700; opacity: 0.8; margin-top: 4px; text-align: right; }

/* ── Build grid ──────────────────────────────────────────── */
.hv-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}
.hv-card {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 4px 6px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 10px;
  cursor: pointer;
  text-align: center;
}
.hv-card:active { transform: translateY(2px); }
.hv-card[disabled], .hv-card.is-locked { opacity: 0.55; cursor: not-allowed; }
.hv-card img { width: 40px; height: 40px; }
.hv-card .hv-card-name { font-size: 11.5px; font-weight: 800; line-height: 1.1; }
.hv-card .hv-card-sub { font-size: 10px; opacity: 0.8; line-height: 1.2; }
.hv-card .hv-card-cost { font-size: 11px; font-weight: 800; }
.hv-card .hv-card-cost.is-broke { color: var(--red); }
.hv-card .hv-lock { font-size: 10px; font-weight: 800; color: var(--cream); background: var(--stone); border: 2px solid var(--ink); border-radius: 4px; padding: 0 4px; }

/* ── Category vote cards ─────────────────────────────────── */
.hv-cat-cards { display: flex; flex-direction: column; gap: 10px; }
.hv-cat {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 12px;
  cursor: pointer;
}
.hv-cat:active { transform: translateY(2px); }
.hv-cat.is-picked { box-shadow: 0 0 0 3px var(--glow); }
.hv-cat[disabled] { cursor: default; }
.hv-cat-emoji { font-size: 24px; }
.hv-cat-main { flex: 1 1 auto; }
.hv-cat-name { font-size: 15px; font-weight: 800; letter-spacing: 0.4px; }
.hv-cat-bar { position: relative; height: 12px; margin-top: 5px; background: var(--wall-shade); border: 2px solid var(--ink); border-radius: 6px; overflow: hidden; }
.hv-cat-bar > i { display: block; height: 100%; }
.hv-cat-count { font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }

/* ── Menu list ───────────────────────────────────────────── */
.hv-menu { display: flex; flex-direction: column; gap: 10px; }
.hv-menu-btn {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 0 14px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 12px;
  box-shadow: 0 4px 0 var(--wall-shade);
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.4px;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
}
.hv-menu-btn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--wall-shade); }
.hv-menu-btn .hv-menu-emoji { font-size: 22px; }
.hv-menu-btn .hv-menu-arrow { margin-left: auto; opacity: 0.6; }

/* ── Tabs + leaderboard rows ─────────────────────────────── */
.hv-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.hv-tab {
  pointer-events: auto;
  flex: 1 1 0;
  min-height: 44px;
  padding: 0 6px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.3px;
  color: var(--ink);
  cursor: pointer;
}
.hv-tab.is-active { background: var(--glow); }
.hv-lb-rows { display: flex; flex-direction: column; gap: 6px; }
.hv-lb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 8px;
  font-size: 14px;
}
.hv-lb-row.is-me { box-shadow: 0 0 0 3px var(--glow); background: var(--cream); }
.hv-lb-rank { width: 22px; font-weight: 800; opacity: 0.7; text-align: right; }
.hv-lb-name { flex: 1 1 auto; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hv-lb-score { font-weight: 800; font-variant-numeric: tabular-nums; }
.hv-empty { text-align: center; padding: 24px 0; opacity: 0.7; font-size: 13px; }

/* ── Stepper ─────────────────────────────────────────────── */
.hv-steps { display: flex; gap: 8px; }
.hv-step {
  pointer-events: auto;
  flex: 1 1 0;
  min-height: 44px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 8px;
  font-size: 15px;
  font-weight: 800;
  color: var(--ink);
  cursor: pointer;
}
.hv-step.is-picked { background: var(--glow); }
.hv-step[disabled] { opacity: 0.5; cursor: not-allowed; }

/* ── How-to steps ────────────────────────────────────────── */
.hv-how { display: flex; flex-direction: column; gap: 12px; }
.hv-how-step { display: flex; gap: 12px; align-items: flex-start; }
.hv-how-emoji {
  flex: 0 0 auto;
  width: 40px; height: 40px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 22px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 10px;
}
.hv-how-txt { font-size: 13.5px; line-height: 1.4; }
.hv-how-txt b { display: block; font-size: 14.5px; letter-spacing: 0.3px; }

/* ── Top-left column: Journal banner + Keep pill ─────────── */
.hv-topleft {
  position: absolute;
  top: calc(var(--sat) + 62px);
  left: calc(var(--sal) + 10px);
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(260px, calc(100vw - 20px));
  pointer-events: none;
  transition: width 180ms ease-out;
}
/* Collapsed: the banner + pill give way to two compact chips. */
.hv-topleft.is-collapsed { width: 44px; }
.hv-topleft.is-collapsed .hv-jr,
.hv-topleft.is-collapsed .hv-keep-pill { display: none; }
.hv-topleft:not(.is-collapsed) .hv-jr,
.hv-topleft:not(.is-collapsed) .hv-keep-pill {
  animation: hv-obj-in 180ms ease-out;
}
@keyframes hv-obj-in {
  from { opacity: 0; transform: scale(0.94); }
  to { opacity: 1; transform: none; }
}

/* Compact objective chips (shown only while collapsed). */
.hv-obj-chip {
  pointer-events: auto;
  position: relative;
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px; height: 40px;
  padding: 0;
  background: var(--cream);
  border: 2px solid var(--ink);
  border-radius: 50%;
  box-shadow: 0 2px 0 rgba(0,0,0,0.28);
  color: var(--ink);
  font-family: inherit;
  cursor: pointer;
}
.hv-topleft.is-collapsed .hv-obj-chip {
  display: inline-flex;
  animation: hv-obj-in 180ms ease-out;
}
.hv-obj-chip:active { transform: translateY(1px); }
.hv-obj-chip svg { position: absolute; inset: -2px; width: 40px; height: 40px; }
.hv-obj-chip .hv-icon-mask { color: var(--wood-dark); }
/* Claimable quest: the journal chip turns gold with a gentle pulse. */
.hv-obj-chip.is-claimable { background: var(--glow); }
.hv-topleft.is-collapsed .hv-obj-chip.is-claimable {
  animation: hv-obj-in 180ms ease-out, hv-obj-pulse 1.8s ease-in-out infinite;
}
@keyframes hv-obj-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
.hv-obj-hall {
  gap: 3px;
  background: rgba(59,51,71,0.92);
  border-color: rgba(255,243,217,0.18);
  color: var(--cream);
}
.hv-obj-hall .hv-icon-mask { color: var(--straw); }
.hv-obj-lvl {
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* Journal banner — the always-visible active quest. */
.hv-jr {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 12px;
  box-shadow: 0 3px 0 var(--wood-dark);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: var(--ink);
  position: relative;
}
.hv-jr:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--wood-dark); }
.hv-jr.is-claiming { opacity: 0.7; pointer-events: none; }
.hv-jr.is-done {
  background: var(--straw);
  border-color: var(--ink);
  box-shadow: 0 3px 0 var(--wood-dark), 0 0 0 3px var(--glow);
}
.hv-jr.is-done .hv-jr-icon .hv-icon-mask { color: var(--wood-dark); }
.hv-jr.is-pulse { animation: hv-jr-pulse 640ms ease-in-out; }
@keyframes hv-jr-pulse {
  0% { transform: scale(1); }
  40% { transform: scale(1.06); }
  100% { transform: scale(1); }
}
.hv-jr-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px; height: 30px;
  background: var(--wall);
  border: 2px solid var(--ink);
  border-radius: 8px;
}
.hv-jr-icon .hv-icon-mask { color: var(--wood-dark); }
.hv-jr-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.hv-jr-top { display: flex; align-items: flex-start; gap: 6px; }
.hv-jr-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 800;
  letter-spacing: 0.2px;
  line-height: 1.2;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.hv-jr-reward { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; }
.hv-jr-reward-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  background: var(--glow);
  border: 2px solid var(--ink);
  border-radius: 7px;
  font-size: 11px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.hv-jr-reward-chip .hv-icon-mask { color: var(--wood-dark); }
.hv-jr-barline { display: flex; align-items: center; gap: 7px; }
.hv-jr-bar {
  flex: 1 1 auto;
  height: 8px;
  background: var(--wall-shade);
  border: 2px solid var(--ink);
  border-radius: 5px;
  overflow: hidden;
}
.hv-jr-bar > i {
  display: block;
  height: 100%;
  width: 0%;
  background: var(--leaf);
  transition: width 260ms ease-out;
}
.hv-jr.is-done .hv-jr-bar > i { background: var(--glow); }
.hv-jr-progress { flex: 0 0 auto; font-size: 10.5px; font-weight: 800; opacity: 0.85; font-variant-numeric: tabular-nums; }

/* DOM confetti burst over the banner on claim. */
.hv-jr-confetti {
  position: absolute;
  left: 22px; top: 50%;
  width: 0; height: 0;
  pointer-events: none;
  overflow: visible;
}
.hv-jr-confetti > i {
  position: absolute;
  left: 0; top: 0;
  width: 7px; height: 7px;
  border-radius: 2px;
  opacity: 0;
  animation: hv-jr-confetti 800ms ease-out forwards;
}
@keyframes hv-jr-confetti {
  0% { transform: translate(0, 0) scale(0.6); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 0; }
}

/* Keep pill — the collective goal, permanently in view. */
.hv-keep-pill {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: rgba(59,51,71,0.92);
  border: 2px solid rgba(255,243,217,0.18);
  border-radius: 10px;
  box-shadow: 0 2px 0 rgba(0,0,0,0.28);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: var(--cream);
}
.hv-keep-pill:active { transform: translateY(1px); }
.hv-keep-pill .hv-icon-mask { color: var(--straw); }
.hv-keep-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.hv-keep-label {
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hv-keep-bar {
  height: 6px;
  background: rgba(255,243,217,0.16);
  border-radius: 4px;
  overflow: hidden;
}
.hv-keep-bar > i {
  display: block;
  height: 100%;
  width: 0%;
  background: var(--glow);
  transition: width 260ms ease-out;
}

/* ── Journal sheet ───────────────────────────────────────── */
.hv-jrs-list { display: flex; flex-direction: column; gap: 6px; }
.hv-jrs-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 10px;
}
.hv-jrs-row.is-done { opacity: 0.75; }
.hv-jrs-tick {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px; height: 22px;
  background: var(--leaf);
  border: 2px solid var(--ink);
  border-radius: 6px;
}
.hv-jrs-tick .hv-icon-mask { color: var(--cream); }
.hv-jrs-name { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 700; letter-spacing: 0.2px; }
.hv-jrs-row.is-next { opacity: 0.7; border-style: dashed; }
.hv-jrs-tag {
  flex: 0 0 auto;
  padding: 2px 7px;
  background: var(--wall-shade);
  border: 2px solid var(--ink);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.hv-jrs-nextmain { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.hv-jrs-reward { font-size: 11px; font-weight: 800; opacity: 0.85; font-variant-numeric: tabular-nums; }
.hv-jrs-active {
  padding: 12px;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 14px;
  box-shadow: 0 4px 0 var(--wood-dark), 0 0 0 3px var(--glow);
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.hv-jrs-active.is-done { background: var(--straw); }
.hv-jrs-active-head { display: flex; align-items: center; gap: 10px; }
.hv-jrs-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px; height: 36px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 10px;
}
.hv-jrs-icon .hv-icon-mask { color: var(--wood-dark); }
.hv-jrs-active-title { flex: 1 1 auto; font-size: 16px; font-weight: 800; letter-spacing: 0.3px; line-height: 1.15; }
.hv-jrs-blurb { font-size: 12.5px; line-height: 1.45; opacity: 0.85; margin: 0; }
.hv-jrs-active-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hv-jrs-count { font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
.hv-jrs-reward-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  background: var(--glow);
  border: 2px solid var(--ink);
  border-radius: 7px;
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.hv-jrs-reward-chip + .hv-jrs-reward-chip { margin-left: 5px; }
.hv-jrs-reward-chip .hv-icon-mask { color: var(--wood-dark); }
.hv-jrs-unlock {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 10px;
}
.hv-jrs-lvl {
  flex: 0 0 auto;
  padding: 3px 8px;
  background: var(--glow);
  border: 2px solid var(--ink);
  border-radius: 7px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.3px;
}

/* ── Toasts ──────────────────────────────────────────────── */
.hv-toast-host {
  position: absolute;
  left: 50%;
  bottom: calc(var(--sab) + 20px);
  transform: translateX(-50%);
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  width: max-content;
  max-width: 90vw;
  transition: bottom 200ms ease-out;
}
.hv-toast {
  padding: 9px 16px;
  background: var(--ink);
  color: var(--cream);
  border: 3px solid var(--glow);
  border-radius: 10px;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.3px;
  box-shadow: 0 3px 0 rgba(0,0,0,0.3);
  opacity: 0;
  transform: translateY(12px) scale(0.96);
  transition: opacity 240ms ease-out, transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.hv-toast.is-in { opacity: 1; transform: translateY(0) scale(1); }
.hv-toast-gain { border-color: var(--glow); }
.hv-toast-celebrate { border-color: var(--accent); background: var(--wood-dark); }
.hv-toast-action {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.hv-toast-btn {
  pointer-events: auto;
  padding: 5px 12px;
  background: var(--glow);
  color: var(--ink);
  border: 2px solid var(--ink);
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.3px;
  cursor: pointer;
}
.hv-toast-btn:active { transform: translateY(1px); }

/* ── Wallet drawer ───────────────────────────────────────── */
.hv-wallet {
  position: absolute;
  left: calc(var(--sal) + 8px);
  right: calc(var(--sar) + 8px);
  top: calc(var(--sat) + 64px);
  z-index: 3;
  pointer-events: none;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 8px;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 12px;
  box-shadow: 0 4px 0 rgba(59,51,71,0.35);
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
  transition: opacity 180ms ease-out, transform 180ms cubic-bezier(0.22,1,0.36,1);
}
.hv-wallet.is-open { opacity: 1; transform: none; pointer-events: auto; }
.hv-wallet-row {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  padding: 4px 8px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
}
.hv-wallet-row:active { transform: translateY(2px); }
.hv-wallet-name { font-size: 11px; font-weight: 800; opacity: 0.75; letter-spacing: 0.2px; }
.hv-wallet-count { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
.hv-wallet-main { display: flex; flex-direction: column; line-height: 1.05; }

/* ── Market sheet ────────────────────────────────────────── */
.hv-callout {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--glow);
  border: 3px solid var(--ink);
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.2px;
}
.hv-plots { gap: 12px; }
.hv-plots-count { display: flex; flex-direction: column; line-height: 1.1; }
.hv-plots-count b { font-size: 22px; font-variant-numeric: tabular-nums; }
.hv-plots-label { font-size: 11px; font-weight: 700; opacity: 0.8; letter-spacing: 0.3px; }

.hv-mkt-rows { display: flex; flex-direction: column; gap: 8px; }
.hv-mkt {
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 12px;
  overflow: hidden;
}
.hv-mkt-head {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 8px 12px;
  cursor: pointer;
}
.hv-mkt-head:active { transform: translateY(1px); }
.hv-mkt-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.hv-mkt-name { font-size: 14.5px; font-weight: 800; letter-spacing: 0.3px; }
.hv-mkt-sub { font-size: 11px; opacity: 0.75; line-height: 1.3; }
.hv-mkt-right { margin-left: auto; text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.hv-mkt-price { display: inline-flex; align-items: center; gap: 3px; font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
.hv-trend-up { color: var(--leaf); }
.hv-trend-down { opacity: 0.6; }
.hv-mkt-hold { font-size: 11px; font-weight: 700; opacity: 0.8; }
.hv-mkt-body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.hv-mkt-seg { display: flex; flex-direction: column; gap: 6px; }
.hv-mkt-seg-label { font-size: 12px; font-weight: 800; letter-spacing: 0.3px; opacity: 0.85; }
.hv-preview { font-size: 12.5px; font-weight: 700; opacity: 0.9; text-align: right; font-variant-numeric: tabular-nums; }

/* ── Trader sheet ────────────────────────────────────────── */
.hv-trade-cards { display: flex; flex-direction: column; gap: 12px; }
.hv-trade {
  padding: 12px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 14px;
}
.hv-trade.is-golden {
  background: var(--straw);
  box-shadow: 0 0 0 3px var(--glow), 0 4px 0 var(--wood-dark);
}
.hv-trade-deal { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 10px; }
.hv-trade-side { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 66px; }
.hv-trade-qty { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
.hv-trade-cap { font-size: 10.5px; font-weight: 700; opacity: 0.8; }
.hv-trade-arrow { display: inline-flex; opacity: 0.7; }
.hv-badge-dot {
  position: absolute;
  top: -4px; right: -4px;
  width: 14px; height: 14px;
  background: var(--red);
  border: 2px solid var(--ink);
  border-radius: 7px;
}
.hv-menu-btn { position: relative; }

/* ── Keep sheet ──────────────────────────────────────────── */
.hv-keep-bars { display: flex; flex-direction: column; gap: 8px; }
.hv-plaque { display: flex; flex-direction: column; gap: 8px; }
.hv-plaque-row {
  padding: 8px 10px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 10px;
}
.hv-plaque-name { font-size: 13.5px; font-weight: 800; letter-spacing: 0.3px; }
.hv-plaque-name.is-unnamed { opacity: 0.6; font-style: italic; font-weight: 700; }
.hv-plaque-top { font-size: 11.5px; opacity: 0.8; margin-top: 2px; line-height: 1.4; }
.hv-picker { display: flex; gap: 8px; }
.hv-picker-col {
  flex: 1 1 0;
  max-height: 168px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 10px;
}
.hv-picker-opt {
  pointer-events: auto;
  min-height: 40px;
  padding: 0 8px;
  background: var(--cream);
  border: 2px solid var(--ink);
  border-radius: 7px;
  font-size: 13px;
  font-weight: 800;
  color: var(--ink);
  cursor: pointer;
}
.hv-picker-opt.is-picked { background: var(--glow); }
.hv-picker-preview { text-align: center; font-size: 17px; font-weight: 800; letter-spacing: 0.5px; }

/* ── Chain / tile info ───────────────────────────────────── */
.hv-chain {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 13px;
  font-weight: 700;
}
.hv-chain .hv-icon { }
.hv-warn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--red);
  color: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.35;
}

/* ── Focus visibility ────────────────────────────────────── */
#hv-hud :focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

@media (max-width: 380px) {
  .hv-chip { height: 32px; font-size: 13px; padding: 0 9px; }
  .hv-tb-chip .hv-tb-label { display: none; }
  .hv-tb-chip { padding: 0 8px; }
  .hv-modal-title { font-size: 18px; }
}

/* ── Reduced motion: keep opacity fades, drop scale/transforms ──── */
@media (prefers-reduced-motion: reduce) {
  .hv-toast { transition: opacity 120ms linear; transform: none; }
  .hv-toast.is-in { transform: none; }
  .hv-modal { transition: opacity 120ms linear; transform: none; }
  .hv-backdrop.is-open .hv-modal { transform: none; }
  .hv-tip { transition: opacity 100ms linear; transform: none; }
  .hv-tip.is-in { transform: none; }
  .hv-fill > i { transition: none; }
  .hv-fab-pulse::after { animation: none; }
  .hv-jr-bar > i, .hv-keep-bar > i { transition: none; }
  .hv-jr.is-pulse { animation: none; }
  .hv-jr-confetti > i { animation: none; display: none; }
  .hv-topleft { transition: none; }
  .hv-topleft.is-collapsed .hv-obj-chip,
  .hv-topleft.is-collapsed .hv-obj-chip.is-claimable { animation: none; }
  .hv-topleft:not(.is-collapsed) .hv-jr,
  .hv-topleft:not(.is-collapsed) .hv-keep-pill { animation: none; }
}
`;
