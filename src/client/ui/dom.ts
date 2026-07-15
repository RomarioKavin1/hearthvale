import type { Game } from 'phaser';
import { showLoginPrompt, showToast } from '@devvit/web/client';
import { PAL } from '../../shared/palette';
import type {
  BuildingId,
  FestivalCategory,
  Gained,
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
  GOODS,
  goodsTotal,
  utcDay,
} from '../../shared/logic/economy';
import { store } from '../state';
import type { ScreenPoint } from '../events';
import { HV_CLEAR_SELECTION } from '../events';

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

/** One compact line describing what a collect deposited into the wallet, e.g.
 * `+12 wheat · +8 logs` (goods now go to the wallet, not an auto-sale). Leads
 * with a coins entry when the collect also minted coins (bakery/house/manor).
 * Null when the collect produced nothing. */
export const gainedLine = (gained: Gained): string | null => {
  const parts: string[] = [];
  if (gained.coins > 0) parts.push(`+${fmtInt(gained.coins)} coins`);
  for (const g of GOODS) {
    const units = gained.goods[g];
    if (!units || units <= 0) continue;
    parts.push(`+${fmtInt(units)} ${GOOD_LABEL[g].toLowerCase()}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
};

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

/** Plain-language tooltip for the festival half of the Today chip. */
export const FESTIVAL_TIP: Record<FestivalCategory, string> = {
  coins: 'Coin Festival: coin buildings earn ×1.5 today',
  raw: 'Harvest Festival: raw goods produce ×1.5 today',
  processed: 'Craft Festival: workshops produce ×1.5 today',
  decor: 'Decor Festival: decorations boost ×1.5 today',
};

// ── The "Today" chip (weather + festival merged into one line) ───────────────

/** Compact top-bar label, e.g. `Today: Rain · Craft ×1.5`. */
export const todayLabel = (
  weather: Weather,
  festival: FestivalCategory
): string =>
  `Today: ${WEATHER_META[weather].label} · ${CATEGORY_META[festival].label} ×1.5`;

/** The Today chip's tooltip: both of the day's effects, spelled out. */
export const todayTip = (
  weather: Weather,
  festival: FestivalCategory
): string => `${WEATHER_TIP[weather]}. ${FESTIVAL_TIP[festival]}.`;

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
    // Wallet-first: the owner's own wallet can feed a processor, so count it too.
    const { gained } = accrue(tile, now, fest, adj, data.city.weather, stockpile, data.me?.wallet);
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

/**
 * Raise (or reset) the bottom of the toast stack by `px`. The walkthrough calls
 * this so a bottom-docked tip card never clips the gain toasts behind it; 0
 * restores the resting position. The `.hv-toast-host` transitions `bottom`, so
 * the shift is smooth.
 */
export const setToastLift = (px: number): void => {
  if (!toastHost) return;
  toastHost.style.bottom = px > 0 ? `calc(var(--sab) + ${px}px)` : '';
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

// ── Anchored popover (H3) ────────────────────────────────────────────────────
//
// A compact parchment card that points at a map tile with a small arrow notch,
// used for building interactions instead of a full-screen modal. Unlike the
// modal it has NO backdrop and does not block the map — only the small card
// catches pointer events. It TRACKS its tile: an rAF loop re-anchors the card to
// the tile's live screen point every frame (via the `anchor` callback the caller
// wires to the scene's tileToScreen bridge — the same bridge the walkthrough
// uses), auto-flipping above/below and clamping to the viewport, so it stays
// glued to the building as the camera pans/zooms. It closes on: an outside tap
// (anywhere that is not the card and not the map canvas — a map tap is left to
// the scene, which re-selects or, on the same tile, toggles this closed), the
// Escape key, a re-tap of the same tile, or the tile scrolling off-canvas.
//
// (Design note: the brief offered "track the tile" OR the simpler "close on pan
// start" — tracking was chosen as the more robust/premium behaviour; a pan that
// carries the tile off the canvas still closes it, since the anchor returns null.)

export type PopoverSpec = {
  /** The tile this popover is anchored to (`"x,y"`) — used for re-tap toggling. */
  tileKey: string;
  /** Live viewport point of the tile, or null when it is off-canvas (→ close). */
  anchor: () => ScreenPoint | null;
  /** Populate `body`; called on open, on each store change and on each tick. */
  render: (body: HTMLElement) => void;
  /** Optional re-render cadence in ms (for countdowns/storage bars). */
  tick?: number;
  /** Extra cleanup when this popover closes. */
  onClose?: () => void;
};

let popCard: HTMLElement | undefined;
let popBody: HTMLElement | undefined;
let popArrow: HTMLElement | undefined;
let popSpec: PopoverSpec | undefined;
let popOnStore: (() => void) | undefined;
let popTick: number | undefined;
let popRaf: number | undefined;

const clearPopSubs = (): void => {
  if (popOnStore) {
    store.off('change', popOnStore);
    popOnStore = undefined;
  }
  if (popTick !== undefined) {
    window.clearInterval(popTick);
    popTick = undefined;
  }
};

/** Re-anchor the card to its tile's live screen point (flip + clamp), or close
 * it when the tile has scrolled off the canvas. */
const positionPopover = (): void => {
  if (!popSpec || !popCard || !popArrow) return;
  const pt = popSpec.anchor();
  if (!pt) {
    closePopover();
    return;
  }
  const margin = 8;
  const gap = 18; // clearance for the building sprite + the arrow notch
  const rect = popCard.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Prefer above the tile (arrow points down at it); flip below if it won't fit.
  let below = false;
  let top = pt.y - gap - h;
  if (top < margin) {
    below = true;
    top = pt.y + gap;
  }
  if (below && top + h > vh - margin) {
    top = Math.max(margin, vh - margin - h);
  }
  let left = pt.x - w / 2;
  left = Math.min(Math.max(left, margin), Math.max(margin, vw - margin - w));
  popCard.style.left = `${Math.round(left)}px`;
  popCard.style.top = `${Math.round(top)}px`;
  // Keep the arrow pointing at the tile even when the card is clamped sideways.
  const arrowX = Math.min(Math.max(pt.x - left, 18), Math.max(18, w - 18));
  popArrow.style.left = `${Math.round(arrowX)}px`;
  popCard.classList.toggle('is-below', below);
};

const popLoop = (): void => {
  if (!popSpec) return;
  positionPopover();
  popRaf = requestAnimationFrame(popLoop);
};

const renderPopover = (): void => {
  if (!popSpec || !popBody) return;
  hideTip();
  clearNode(popBody);
  popSpec.render(popBody);
  // Content height may have changed (a countdown ending, a warning appearing) —
  // re-anchor immediately so the card never drifts off its tile.
  positionPopover();
};

const onPopPointerDown = (e: Event): void => {
  if (!popSpec || !popCard) return;
  const t = e.target;
  if (!(t instanceof Element)) return;
  // Taps inside the card (its buttons/swatches) never dismiss.
  if (popCard.contains(t)) return;
  // A tap on the map canvas is left to the scene: it either re-selects another
  // tile (swapping this popover) or, on the same tile, toggles it closed. Closing
  // here too would race that flow.
  if (t.closest('#game-container')) return;
  closePopover();
};

const onPopKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') closePopover();
};

/** Mount the single popover card into the HUD host (once, at boot). */
export const mountPopoverRoot = (parent: HTMLElement): void => {
  popArrow = el('div', { cls: 'hv-pop-arrow' });
  popBody = el('div', { cls: 'hv-pop-body' });
  const close = el('button', {
    cls: 'hv-pop-close',
    attrs: { type: 'button', 'aria-label': 'Close' },
    children: [iconEl('icon-cross', 12)],
    on: { click: () => closePopover() },
  });
  popCard = el('div', {
    cls: 'hv-pop',
    attrs: { role: 'dialog' },
    children: [close, popBody, popArrow],
  });
  parent.appendChild(popCard);
  document.addEventListener('pointerdown', onPopPointerDown, true);
  document.addEventListener('keydown', onPopKeydown);
};

export const isPopoverOpen = (): boolean => popSpec !== undefined;

/** The tile key (`"x,y"`) the popover is currently anchored to, or null when no
 * popover is open. Used by the world scene to hide that building's ready bubble
 * while its popover covers it (H4). */
export const openPopoverTileKey = (): string | null => popSpec?.tileKey ?? null;

/** Open (or, on a re-tap of the same tile, toggle-close) the tile popover. */
export const openPopover = (spec: PopoverSpec): void => {
  if (!popCard || !popBody) return;
  // Re-tapping the tile the popover already points at closes it.
  if (popSpec && popSpec.tileKey === spec.tileKey) {
    closePopover();
    return;
  }
  clearPopSubs();
  popSpec = spec;
  renderPopover();
  popOnStore = () => renderPopover();
  store.on('change', popOnStore);
  if (spec.tick !== undefined) {
    popTick = window.setInterval(renderPopover, spec.tick);
  }
  popCard.classList.add('is-open');
  positionPopover();
  if (popRaf === undefined) popRaf = requestAnimationFrame(popLoop);
};

/**
 * Close the popover. Dispatches HV_CLEAR_SELECTION so the scene drops its tile
 * highlight / occluder fade — UNLESS `silent` (used when a modal sheet takes over
 * the selection, so it isn't cleared out from under the new sheet).
 */
export const closePopover = (silent = false): void => {
  if (!popSpec) return;
  const spec = popSpec;
  popSpec = undefined;
  clearPopSubs();
  if (popRaf !== undefined) {
    cancelAnimationFrame(popRaf);
    popRaf = undefined;
  }
  popCard?.classList.remove('is-open');
  hideTip();
  spec.onClose?.();
  if (!silent) {
    window.dispatchEvent(new CustomEvent(HV_CLEAR_SELECTION));
  }
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
/* Hall-material chips (planks/bricks): slightly smaller, tappable → Hall sheet. */
.hv-chip-good {
  height: 30px;
  padding: 0 9px;
  font-size: 13px;
  font-family: inherit;
}

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

/* Always-visible info button (opens the "How Hearthvale works" reference). A
 * round parchment plate matching the coin/good chips; sits left of the level
 * ring in the top-right group. */
.hv-info-btn {
  pointer-events: auto;
  flex: 0 0 auto;
  width: 40px; height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  background: var(--cream);
  border: 2px solid var(--ink);
  border-radius: 50%;
  box-shadow: 0 2px 0 rgba(0,0,0,0.28);
  color: var(--wood-dark);
  cursor: pointer;
}
.hv-info-btn:active { transform: translateY(1px); box-shadow: none; }
.hv-info-glyph {
  font-family: 'Fredoka', ui-rounded, system-ui, sans-serif;
  font-weight: 800;
  font-style: italic;
  font-size: 19px;
  line-height: 1;
}

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
.hv-fab .hv-fab-cap {
  font-size: 9px;
  letter-spacing: 0;
  /* Labels must never escape the 56px plate: one line, clipped, tight leading
   * ("Check in" used to wrap and its second line spilled below the border). */
  white-space: nowrap;
  max-width: 48px;
  overflow: hidden;
  line-height: 1;
}
.hv-fab.hv-primary { background-color: var(--glow); }
.hv-fab:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--wood-dark); }
.hv-fab[disabled] { opacity: 0.45; cursor: not-allowed; box-shadow: 0 3px 0 var(--wood-dark); transform: none; }
.hv-fab.is-checked { background-color: var(--wall-shade); }
.hv-fab.is-checked .hv-icon-mask { color: var(--ink); opacity: 0.6; }
/* Peek FAB while ghost mode is active — a glowing "on" state. */
.hv-fab.is-peeking { background-color: var(--glow); box-shadow: 0 0 0 2px var(--glow), 0 3px 0 var(--wood-dark); }
.hv-fab.is-peeking .hv-icon-mask { color: var(--ink); }
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
/* ── Modal (centred card over a blurred backdrop) ────────── */
/* Explicit z-order: the backdrop/modal (20) sits ABOVE the top-left objectives
 * column (2), so an open modal always covers it. */
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
  /* min-height:0 lets this flex child shrink below its content height so its own
   * overflow-y engages — without it the body grows to content height and the
   * whole modal spills (unscrollable) on short/mobile viewports. */
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* Allow vertical touch-panning inside the sheet; nothing horizontal here. */
  touch-action: pan-y;
  padding: 16px;
}

/* ── Anchored tile popover (H3) ──────────────────────────────
 * A compact parchment card that points at a map tile. No backdrop — it sits over
 * the map (z above the modal layer) but only the card itself catches input. */
.hv-pop {
  position: fixed;
  left: 0; top: 0;
  z-index: 30;
  width: min(260px, 92vw);
  max-height: 74vh;
  display: none;
  flex-direction: column;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 12px;
  box-shadow: 0 5px 0 rgba(59,51,71,0.3), 0 8px 22px rgba(0,0,0,0.28);
  opacity: 0;
  transform: translateY(4px) scale(0.98);
  transform-origin: center bottom;
  transition: opacity 130ms ease-out, transform 130ms ease-out;
}
.hv-pop.is-open { display: flex; opacity: 1; transform: none; }
.hv-pop.is-below { transform-origin: center top; }
.hv-pop-body {
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  padding: 14px 14px 14px;
}
/* Tighter internals than the modal so the card stays compact. */
.hv-pop-body .hv-stack > * + * { margin-top: 9px; }
.hv-pop-body .hv-btn { min-height: 44px; font-size: 14px; }
.hv-pop-close {
  pointer-events: auto;
  position: absolute;
  top: 6px; right: 6px;
  width: 28px; height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--wall);
  border: 2px solid var(--ink);
  border-radius: 7px;
  cursor: pointer;
  color: var(--ink);
  z-index: 1;
}
.hv-pop-close:active { transform: translateY(1px); }
/* The arrow notch: a rotated parchment square poking out toward the tile. Default
 * (card above the tile) it sits on the bottom edge; flipped (is-below) it moves
 * to the top edge. Two borders are drawn so it reads as a continuation of the
 * card's ink outline. */
.hv-pop-arrow {
  position: absolute;
  width: 14px; height: 14px;
  background: var(--cream);
  transform: rotate(45deg);
  pointer-events: none;
}
.hv-pop:not(.is-below) .hv-pop-arrow {
  bottom: -8px;
  border-right: 3px solid var(--ink);
  border-bottom: 3px solid var(--ink);
}
.hv-pop.is-below .hv-pop-arrow {
  top: -8px;
  border-left: 3px solid var(--ink);
  border-top: 3px solid var(--ink);
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

/* ── Village Mural (E1) ──────────────────────────────────── */
.hv-mural-wrap {
  display: flex;
  justify-content: center;
  overflow: auto;
  padding: 4px;
  background: var(--wall-shade);
  border: 3px solid var(--ink);
  border-radius: 10px;
}
.hv-mural-canvas {
  image-rendering: pixelated;
  border-radius: 3px;
  cursor: crosshair;
  touch-action: manipulation;
}
.hv-mural-pal { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.hv-mural-swatch {
  width: 30px;
  height: 30px;
  border: 3px solid var(--ink);
  border-radius: 8px;
  box-shadow: 0 3px 0 var(--wood-dark);
  cursor: pointer;
  padding: 0;
}
.hv-mural-swatch:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--wood-dark); }
.hv-mural-swatch.is-selected { outline: 3px solid var(--glow); outline-offset: 2px; }
.hv-mural-count { text-align: center; font-size: 13.5px; }
.hv-mural-count b { color: var(--glow); font-variant-numeric: tabular-nums; }

/* ── My villager (outfit picker, E1) ─────────────────────── */
.hv-outfits { display: flex; gap: 8px; flex-wrap: wrap; }
.hv-outfit {
  width: 34px;
  height: 34px;
  border: 3px solid var(--ink);
  border-radius: 9px;
  box-shadow: 0 3px 0 var(--wood-dark);
  cursor: pointer;
  padding: 0;
}
.hv-outfit:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--wood-dark); }
.hv-outfit.is-selected { outline: 3px solid var(--glow); outline-offset: 2px; }

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

/* ── "How Hearthvale works" reference: a tap-to-expand accordion ── */
.hv-info { display: flex; flex-direction: column; gap: 8px; }
.hv-info-sec {
  background: var(--parch-face);
  border: 2px solid var(--parch-edge);
  border-radius: 10px;
  overflow: hidden;
}
.hv-info-sum {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  font-weight: 800;
  font-size: 14.5px;
  letter-spacing: 0.3px;
  color: var(--wood-dark);
  cursor: pointer;
  /* Hide the native disclosure triangle; the chevron below stands in for it. */
  list-style: none;
}
.hv-info-sum::-webkit-details-marker { display: none; }
.hv-info-ic {
  flex: 0 0 auto;
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
}
.hv-info-ic .hv-icon-mask { color: var(--wood-dark); }
.hv-info-ttl { flex: 1 1 auto; }
/* Chevron cue: points right when closed, rotates down when the section is open. */
.hv-info-sum::after {
  content: '';
  flex: 0 0 auto;
  width: 8px; height: 8px;
  border-right: 2px solid var(--wood-dark);
  border-bottom: 2px solid var(--wood-dark);
  transform: rotate(-45deg);
  transition: transform 140ms ease-out;
}
.hv-info-sec[open] .hv-info-sum::after { transform: rotate(45deg); }
.hv-info-body {
  padding: 0 13px 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hv-info-body p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  font-weight: 600;
  color: var(--ink);
}
@media (prefers-reduced-motion: reduce) {
  .hv-info-sum::after { transition: none; }
}

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
  /* No width transition: the column snaps to full width on expand so its hit-box
   * is never mid-animation narrower than the banner under the finger (a tap aimed
   * at the just-expanded banner must not land on the canvas behind it and collapse
   * the column). The children still fade in via hv-obj-in. */
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

/* ── Market info panel ───────────────────────────────────── */
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
  width: 100%;
  min-height: 52px;
  padding: 8px 12px;
  background: transparent;
  border: 0;
  text-align: left;
  font-family: inherit;
  color: inherit;
  cursor: pointer;
}
.hv-mkt-head:active { transform: translateY(1px); }
.hv-mkt-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.hv-mkt-name { font-size: 14.5px; font-weight: 800; letter-spacing: 0.3px; }
.hv-mkt-sub { font-size: 11px; opacity: 0.75; line-height: 1.3; }
.hv-mkt-right { margin-left: auto; text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.hv-mkt-price { display: inline-flex; align-items: center; gap: 3px; font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
.hv-mkt-hold { font-size: 10px; font-weight: 800; opacity: 0.7; letter-spacing: 0.2px; }
.hv-trend-up { color: var(--leaf); }
.hv-trend-down { opacity: 0.6; }
.hv-mkt-seg { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px; }
.hv-mkt-seg-label { font-size: 12px; font-weight: 800; letter-spacing: 0.3px; opacity: 0.85; }
.hv-mkt-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 800;
  padding: 6px 10px;
  background: var(--cream);
  border: 2px solid var(--wood-dark);
  border-radius: 9px;
}
.hv-mkt-preview .hv-icon-mask { color: var(--wood-dark); }

/* ── Keep sheet ──────────────────────────────────────────── */
.hv-keep-bars { display: flex; flex-direction: column; gap: 8px; }
/* Held Hall material (planks/bricks) chips beside the contribute steppers. */
.hv-held-row { display: flex; gap: 8px; }
.hv-held-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--wall);
  border: 3px solid var(--ink);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
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
  touch-action: pan-y;
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
  .hv-pop { transition: opacity 100ms linear; }
  .hv-pop:not(.is-open) { transform: none; }
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

/* ══════════════════════════════════════════════════════════════════════════
 * Adventure UI-pack skin — Kenney "UI Pack Adventure" (CC0).
 * Warm wood/parchment 9-slice plates layered over the existing palette CSS.
 * Source PNGs ship at 2× (public/ui/*); slice values are the 2× pixel insets
 * measured off each art: buttons 8, panels 16, banner 12 (top 23).
 * ────────────────────────────────────────────────────────────────────────── */

:root {
  --ui-brown: url('/ui/button_brown.png');
  --ui-red: url('/ui/button_red.png');
  --shadow-drop: 0 3px 0 rgba(46,40,55,0.32);
  --shadow-drop-lo: 0 1px 0 rgba(46,40,55,0.32);
  /* Warm parchment row/card: light cream face, thin warm-brown edge, brown ink.
   * Replaces the retired grey-blue button plates so every sheet reads warm. */
  --parch-face: #f3e4c4;
  --parch-edge: var(--wood-dark);
}

/* ── Wooden button plates (primary/secondary/danger/accent) ── */
.hv-btn {
  background: transparent;
  border: 9px solid transparent;
  border-image: var(--ui-brown) 8 fill stretch;
  border-radius: 0;
  box-shadow: var(--shadow-drop);
  color: var(--ink);
  /* A long label must never spill past the 9-slice plate. */
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hv-btn:active { transform: translateY(3px); box-shadow: var(--shadow-drop-lo); }
.hv-btn[disabled] { box-shadow: var(--shadow-drop); transform: none; }
/* Ghost/secondary: warm parchment face rather than a wood plate. */
.hv-btn.hv-btn-ghost {
  border: 3px solid var(--parch-edge);
  border-image: none;
  border-radius: 11px;
  background: var(--parch-face);
  box-shadow: var(--shadow-drop);
  color: var(--wood-dark);
}
.hv-btn.hv-btn-ghost:active { transform: translateY(3px); box-shadow: var(--shadow-drop-lo); }
.hv-btn.hv-btn-accent { border-image-source: var(--ui-brown); color: var(--ink); }
.hv-btn.hv-btn-danger { color: var(--red); }
.hv-btn.hv-btn-danger.is-armed {
  border: 3px solid var(--ink);
  border-image: var(--ui-red) 8 fill stretch;
  color: var(--cream);
}

/* ── Steppers / tabs / picker: warm parchment chips, gold when active ── */
.hv-step, .hv-tab, .hv-picker-opt {
  background: var(--parch-face);
  border: 2px solid var(--parch-edge);
  border-image: none;
  border-radius: 9px;
  color: var(--wood-dark);
}
.hv-step.is-picked, .hv-tab.is-active, .hv-picker-opt.is-picked {
  background: var(--glow);
  border-color: var(--wood-dark);
  color: var(--ink);
}
/* ── Menu rows: warm parchment cards, brown text + icon ── */
.hv-menu-btn {
  background: var(--parch-face);
  border: 2px solid var(--parch-edge);
  border-image: none;
  border-radius: 12px;
  box-shadow: var(--shadow-drop);
  color: var(--wood-dark);
}
.hv-menu-btn .hv-icon-mask { color: var(--wood-dark); }
.hv-menu-btn:active { transform: translateY(3px); box-shadow: var(--shadow-drop-lo); }

/* ── Build cards + list rows: warm parchment slots ── */
.hv-card, .hv-lb-row, .hv-mkt, .hv-held-chip, .hv-jrs-row, .hv-jrs-unlock,
.hv-plaque-row, .hv-picker-col {
  background: var(--parch-face);
  border: 2px solid var(--parch-edge);
  border-image: none;
  border-radius: 10px;
}
.hv-card .hv-icon-mask, .hv-mkt .hv-icon-mask, .hv-menu-emoji .hv-icon-mask,
.hv-jrs-unlock .hv-icon-mask { color: var(--wood-dark); }
.hv-lb-row.is-me { border-color: var(--wood-dark); background: var(--cream); box-shadow: 0 0 0 3px var(--glow); }
.hv-jrs-row.is-next { background: var(--parch-face); border-style: dashed; opacity: 0.7; }
.hv-jrs-active {
  background: transparent;
  border: 12px solid transparent;
  border-image: var(--ui-brown) 8 fill stretch;
  border-radius: 0;
  box-shadow: none;
}

/* ── Top-bar chips: cream wooden chips ── */
.hv-chip {
  background: transparent;
  border: 7px solid transparent;
  border-image: var(--ui-brown) 8 fill stretch;
  border-radius: 0;
  box-shadow: var(--shadow-drop);
}
.hv-chip:active { transform: translateY(1px); }
.hv-signin-pill {
  background: transparent;
  border: 8px solid transparent;
  border-image: var(--ui-brown) 8 fill stretch;
  border-radius: 0;
  box-shadow: var(--shadow-drop);
}
.hv-signin-pill:active { transform: translateY(2px); box-shadow: var(--shadow-drop-lo); }

/* ── Callout: golden parchment plate ── */
.hv-callout {
  background: transparent;
  border: 9px solid transparent;
  border-image: var(--ui-brown) 8 fill stretch;
  border-radius: 0;
  color: var(--ink);
}

/* ── FABs: rounded-square parchment cards (9-slice wood plate like the chips),
 *   icon centred with a tiny label below, badge top-right, pressed sinks. ── */
.hv-fab {
  background: transparent;
  /* Round the box to match the wood-plate art's corners and clip the tint to
   * the inner face. Without this, any state fill/ring (primary gold, checked
   * grey, peek glow) painted the SQUARE border-box and bled past the rounded
   * border-image as a "residue rectangle" at the corners. padding-box keeps the
   * tint inside the wood frame; the matching radius rounds the glow box-shadows. */
  border: 9px solid transparent;
  border-image: var(--ui-brown) 8 fill stretch;
  border-radius: 14px;
  background-clip: padding-box;
  box-shadow: var(--shadow-drop);
}
.hv-fab:active { transform: translateY(3px); box-shadow: var(--shadow-drop-lo); }
.hv-fab[disabled] { box-shadow: var(--shadow-drop); transform: none; }
/* Primary (Collect): a warm gold glow ring around the wood plate. */
.hv-fab.hv-primary { box-shadow: var(--shadow-drop), 0 0 0 3px var(--glow); }
.hv-fab.is-checked { filter: grayscale(0.4) brightness(0.94); }

/* ── Collapsed objective chips: small rounded-square parchment cards, a thin
 *   progress underline, gold glow when the goal is claimable. ── */
.hv-obj-chip {
  width: 44px; height: 44px;
  background: var(--parch-face);
  border: 2px solid var(--parch-edge);
  border-radius: 12px;
  box-shadow: var(--shadow-drop);
}
.hv-obj-chip .hv-icon-mask { color: var(--wood-dark); }
.hv-obj-chip.is-claimable { background: var(--glow); box-shadow: var(--shadow-drop), 0 0 0 3px var(--glow); }
.hv-obj-hall { background: var(--parch-face); color: var(--wood-dark); }
.hv-obj-hall .hv-icon-mask { color: var(--wood-dark); }
.hv-obj-hall .hv-obj-lvl { color: var(--wood-dark); }
/* Thin progress underline along the bottom of the journal chip. */
.hv-obj-underline {
  position: absolute;
  left: 6px; right: 6px; bottom: 4px;
  height: 3px;
  border-radius: 2px;
  background: rgba(46,40,55,0.22);
  overflow: hidden;
}
.hv-obj-underline > i {
  display: block; height: 100%; width: 0%;
  background: var(--leaf);
  transition: width 220ms ease-out;
}
.hv-obj-chip.is-claimable .hv-obj-underline > i { background: var(--wood-dark); }
.hv-ring { background: transparent; }

/* ── Journal banner + Hall pill: parchment / wood plates ── */
.hv-jr {
  background: transparent;
  border: 10px solid transparent;
  border-image: var(--ui-brown) 8 fill stretch;
  border-radius: 0;
  box-shadow: var(--shadow-drop);
}
.hv-jr:active { transform: translateY(2px); box-shadow: var(--shadow-drop-lo); }
.hv-jr.is-done { border-image-source: var(--ui-brown); box-shadow: var(--shadow-drop), 0 0 0 3px var(--glow); }
.hv-keep-pill {
  background: var(--parch-face);
  border: 2px solid var(--parch-edge);
  border-image: none;
  border-radius: 10px;
  box-shadow: var(--shadow-drop);
  color: var(--wood-dark);
}
.hv-keep-pill .hv-icon-mask { color: var(--wood-dark); }
.hv-keep-label { color: var(--wood-dark); }
.hv-keep-bar { background: rgba(46,40,55,0.22); }

/* ── Modal: a parchment scroll with a red banner title ── */
.hv-modal {
  background: transparent;
  border: 16px solid transparent;
  border-image: url('/ui/panel_brown.png') 16 fill stretch;
  border-radius: 0;
  box-shadow: 0 10px 26px rgba(46,40,55,0.45);
  overflow: visible;
}
.hv-modal-head {
  border-bottom: 0;
  padding: 2px 2px 10px;
  align-items: center;
}
.hv-modal-title {
  padding: 7px 14px;
  background: url('/ui/banner_hanging.png') center / 100% 100% no-repeat;
  color: var(--cream);
  text-shadow: 0 1px 0 rgba(46,40,55,0.5);
  text-align: center;
  line-height: 1.2;
}
.hv-modal-close {
  background: transparent;
  border: 8px solid transparent;
  border-image: var(--ui-red) 8 fill stretch;
  border-radius: 0;
  color: var(--cream);
}
.hv-modal-close .hv-icon-mask { color: var(--cream); }
.hv-modal-body { padding: 2px 4px 4px; overflow-y: auto; }

/* ── Toasts: parchment notes ── */
.hv-toast {
  background: transparent;
  border: 10px solid transparent;
  border-image: url('/ui/panel_brown.png') 16 fill stretch;
  border-radius: 0;
  color: var(--ink);
  box-shadow: 0 4px 10px rgba(46,40,55,0.35);
}
.hv-toast-celebrate { background: transparent; }
.hv-toast-celebrate, .hv-toast-gain { border-image-source: url('/ui/panel_brown.png'); }
.hv-toast-btn {
  background: transparent;
  border: 7px solid transparent;
  border-image: var(--ui-brown) 8 fill stretch;
  border-radius: 0;
  color: var(--ink);
}

/* ── Progress fills: sunken wood tracks, gold/green fills ── */
.hv-fill { background: rgba(46,40,55,0.28); border-color: var(--wood-dark); border-radius: 0; }
.hv-jr-bar, .hv-jrs-bar { background: rgba(46,40,55,0.28); border-color: var(--wood-dark); }

/* ── Cursor pack (Kenney "Cursor Pack", CC0) ──
 * hand pointer over every interactive HUD control; hotspot at the fingertip. */
#hv-hud button,
#hv-hud [role='button'],
.hv-chip, .hv-fab, .hv-card, .hv-tab, .hv-step, .hv-swatch, .hv-jr,
.hv-keep-pill, .hv-obj-chip, .hv-ring, .hv-signin-pill, .hv-menu-btn,
.hv-picker-opt, .hv-modal-close, .hv-toast-btn, .hv-backdrop {
  cursor: url('/cursors/hand_point.png') 12 4, pointer;
}
#hv-hud button[disabled], .hv-card.is-locked, .hv-card[disabled] {
  cursor: url('/cursors/pointer_a.png') 10 8, not-allowed;
}

/* ══ Guided walkthrough (coach marks) ══ */
.hv-wt-root {
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
  font-family: 'Fredoka', ui-rounded, system-ui, sans-serif;
}
.hv-wt-root.is-hidden { display: none; }
/* Spotlight: a purely visual OUTLINE ring around the target — no dim veil and no
 * translucent fill, so it can never obscure the text under it (e.g. the Market's
 * wheat row) nor act as an input gate. Recomputed every frame by position(). */
.hv-wt-spot {
  position: absolute;
  border-radius: 12px;
  box-shadow: 0 0 0 3px var(--glow), 0 0 0 6px rgba(46,40,55,0.35);
  transition: left 120ms ease-out, top 120ms ease-out,
    width 120ms ease-out, height 120ms ease-out, opacity 120ms ease-out;
  pointer-events: none;
}
.hv-wt-arrow {
  position: absolute;
  width: 40px; height: 40px;
  background: url('/ui/minimap_arrow_a.png') center / contain no-repeat;
  filter: drop-shadow(0 2px 3px rgba(30,26,38,0.55));
  pointer-events: none;
  transition: left 180ms ease-out, top 180ms ease-out;
  will-change: transform;
  animation: hv-wt-bounce 1.1s ease-in-out infinite;
}
@keyframes hv-wt-bounce {
  0%, 100% { transform: translate(-50%, -50%) rotate(var(--rot)) translateY(0); }
  50% { transform: translate(-50%, -50%) rotate(var(--rot)) translateY(9px); }
}
.hv-wt-card {
  position: absolute;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(280px, calc(100vw - 28px));
  padding: 14px 14px 12px;
  background: transparent;
  border: 16px solid transparent;
  border-image: url('/ui/panel_brown.png') 16 fill stretch;
  color: var(--ink);
  box-shadow: 0 8px 22px rgba(46,40,55,0.45);
  transition: left 180ms ease-out, top 180ms ease-out;
}
.hv-wt-main { display: flex; flex-direction: column; min-width: 0; }
/* Step glyph — shown only in the compact strip. */
.hv-wt-ico { display: none; flex: 0 0 auto; align-items: center; justify-content: center; color: var(--wood-dark); }
.hv-wt-step {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  opacity: 0.6;
  margin: 0 0 4px;
}
.hv-wt-title { font-size: 15px; font-weight: 800; line-height: 1.25; margin: 0 0 5px; letter-spacing: 0.2px; }
.hv-wt-body { font-size: 12.5px; line-height: 1.45; margin: 0 0 4px; }
.hv-wt-foot { display: flex; align-items: center; gap: 8px; }
.hv-wt-dots { display: inline-flex; gap: 5px; margin-right: auto; }
.hv-wt-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--wood-dark); opacity: 0.28; }
.hv-wt-dot.is-on { opacity: 1; background: var(--glow); }
.hv-wt-min {
  pointer-events: auto;
  flex: 0 0 auto;
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0 0 2px;
  background: transparent;
  border: 0;
  font-family: inherit;
  font-size: 20px; font-weight: 800; line-height: 1;
  color: var(--ink);
  opacity: 0.7;
  cursor: url('/cursors/hand_point.png') 12 4, pointer;
}
.hv-wt-min:hover { opacity: 1; }
.hv-wt-skip {
  pointer-events: auto;
  flex: 0 0 auto;
  padding: 5px 10px;
  background: transparent;
  border: 0;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink);
  opacity: 0.7;
  cursor: url('/cursors/hand_point.png') 12 4, pointer;
}
.hv-wt-skip:hover { opacity: 1; }

/* Compact strip (phones): a slim single line — icon + imperative title + dots +
 * minimize + Skip, no blurb. Tapping the strip reveals the blurb (is-expanded). */
.hv-wt-compact {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: min(460px, calc(100vw - 16px));
  max-height: 44px;
  border-width: 8px;
  padding: 2px 8px;
  cursor: url('/cursors/hand_point.png') 12 4, pointer;
}
.hv-wt-compact.is-expanded { max-height: none; }
.hv-wt-compact .hv-wt-ico { display: inline-flex; }
.hv-wt-compact .hv-wt-step { display: none; }
.hv-wt-compact .hv-wt-body { display: none; }
.hv-wt-compact .hv-wt-main { flex: 1 1 auto; }
.hv-wt-compact .hv-wt-title {
  font-size: 13px; margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hv-wt-compact .hv-wt-foot { flex: 0 0 auto; }
.hv-wt-compact.is-expanded { align-items: flex-start; }
.hv-wt-compact.is-expanded .hv-wt-main { padding-top: 2px; }
.hv-wt-compact.is-expanded .hv-wt-title { white-space: normal; }
.hv-wt-compact.is-expanded .hv-wt-body { display: block; margin: 4px 0 0; }

/* Minimized: the card collapses to a small scroll chip at its docked edge. */
.hv-wt-card.is-hidden, .hv-wt-chip.is-hidden { display: none; }
.hv-wt-chip {
  position: absolute;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px; height: 46px;
  padding: 0;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 12px;
  box-shadow: 0 3px 0 var(--wood-dark);
  color: var(--wood-dark);
  cursor: url('/cursors/hand_point.png') 12 4, pointer;
  transition: left 180ms ease-out, top 180ms ease-out;
}
.hv-wt-chip:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--wood-dark); }
.hv-wt-chip .hv-icon-mask { color: var(--wood-dark); }

@media (prefers-reduced-motion: reduce) {
  .hv-wt-arrow { animation: none; }
  .hv-wt-spot, .hv-wt-arrow, .hv-wt-card, .hv-wt-chip { transition: none; }
}
`;
