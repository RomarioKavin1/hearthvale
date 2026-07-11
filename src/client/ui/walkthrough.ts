import { CATALOG, GRID_SIZE } from '../../shared/catalog';
import type { StateResponse } from '../../shared/types';
import { questSnapshot } from '../../shared/quests';
import { isClaimable, isPlaza, neighbors, tileKey } from '../../shared/logic/grid';
import { isRiver } from '../../shared/logic/expansion';
import { highlightTiles, tileToScreen } from '../events';
import type { SpriteKey } from '../art/manifest';
import { store } from '../state';
import { clearNode, el, iconEl, setToastLift, todayUtc } from './dom';

/**
 * The guided walkthrough (U1) — an active coach-mark overlay that points new
 * players at the exact thing to do next. It complements the always-on Journal
 * banner: the banner says WHAT the current goal is; the walkthrough points WHERE
 * to tap, with a dimmed spotlight cut-out, a bouncing arrow and a small
 * parchment tip card (Kenney UI-pack art via CSS in dom.ts).
 *
 * Steps are derived from the same signals the Journal reads (owned plots, whether
 * a wheat field exists, collects, check-in, plus two "sheet seen" flags), so the
 * tour auto-advances the instant the player performs each action — nothing here
 * tracks progress independently. Targets resolve to either a DOM element (FABs,
 * the wheat-field build card, the Hall pill) or a scene tile (via the
 * `tileToScreen` bridge the Village scene registers); scene targets are tracked
 * live so the mark follows the map as it pans or zooms.
 *
 * The tour is one-shot per browser session (`sessionStorage`) and never shown to
 * veterans (anyone who has already earned/collected/levelled). It is skippable at
 * every step and degrades to a static arrow under `prefers-reduced-motion`.
 */

const DONE_KEY = 'hv-walkthrough-done';
const WHEATFIELD_COST = CATALOG.wheatfield.cost;

// One flag for the Hall step, which has no player-state signal of its own: set
// when the Village Hall sheet first opens (see sheets.ts). Session-scoped.
let hallSeen = false;

/** Called by sheets.ts when the Market sheet opens: re-evaluate so the sell
 * step's coach mark can move from the Market FAB onto the wheat row/Sell button. */
export const noteMarketOpened = (): void => {
  evaluate();
};
/** Called by sheets.ts when the Village Hall sheet opens (completes the Hall step). */
export const noteHallOpened = (): void => {
  hallSeen = true;
  evaluate();
};

// ── Step model ───────────────────────────────────────────────────────────────

type Target =
  | { kind: 'dom'; selector: string }
  | { kind: 'tile'; at: (data: StateResponse) => { x: number; y: number } | null };

type Step = {
  id: string;
  /** Imperative, self-sufficient title — carries the instruction on its own so
   * the compact mobile strip can drop the blurb entirely. */
  title: string;
  body: string;
  /** Step glyph shown in the compact strip. */
  icon: SpriteKey;
  /** True once the player has performed this step's action. */
  done: (data: StateResponse, snap: ReturnType<typeof questSnapshot>) => boolean;
  target: (data: StateResponse) => Target | null;
  /** Optional candidate tiles to pulse ("tap any of these — your choice"). When
   * present and non-empty, the scene highlights these instead of a single arrow. */
  highlights?: (data: StateResponse) => string[];
};

/** Owned tiles of the player, with coords. */
const ownedTiles = (
  data: StateResponse,
  id: string
): Array<{ x: number; y: number; buildingId: string | undefined }> => {
  const out: Array<{ x: number; y: number; buildingId: string | undefined }> = [];
  for (const [key, tile] of Object.entries(data.grid)) {
    if (tile.owner !== id) continue;
    const [xs, ys] = key.split(',');
    out.push({ x: Number(xs), y: Number(ys), buildingId: tile.buildingId });
  }
  return out;
};

const isOpenTile = (data: StateResponse, x: number, y: number): boolean =>
  isClaimable(x, y) &&
  !isPlaza(x, y) &&
  !isRiver(x, y) &&
  data.grid[tileKey(x, y)] === undefined;

/** Up to `n` claimable, open tiles nearest the village centre, as `"x,y"` keys —
 * the candidate homestead spots the "found" step highlights. */
const nearestClaimableKeys = (data: StateResponse, n: number): string[] => {
  const cx = (GRID_SIZE - 1) / 2;
  const cy = (GRID_SIZE - 1) / 2;
  const cands: Array<{ key: string; d: number }> = [];
  for (let x = 0; x < GRID_SIZE; x += 1) {
    for (let y = 0; y < GRID_SIZE; y += 1) {
      if (!isOpenTile(data, x, y)) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      cands.push({ key: tileKey(x, y), d });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  return cands.slice(0, n).map((c) => c.key);
};

/** The tiles the "build a field" step highlights: the player's already-claimed
 * empty plots if any (build here), else the open tiles beside their house. */
const fieldHighlightKeys = (data: StateResponse, id: string, n: number): string[] => {
  const owned = ownedTiles(data, id);
  const empties = owned
    .filter((t) => t.buildingId === undefined)
    .map((t) => tileKey(t.x, t.y));
  if (empties.length > 0) return empties.slice(0, n);
  const house = owned.find((t) => t.buildingId === 'house') ?? owned[0];
  if (!house) return [];
  const keys: string[] = [];
  for (const nb of neighbors(house.x, house.y)) {
    if (isOpenTile(data, nb.x, nb.y)) keys.push(tileKey(nb.x, nb.y));
    if (keys.length >= n) break;
  }
  return keys;
};

const firstBuildingTile = (
  data: StateResponse,
  id: string,
  buildingId: string
): { x: number; y: number } | null => {
  const t = ownedTiles(data, id).find((o) => o.buildingId === buildingId);
  return t ? { x: t.x, y: t.y } : null;
};

const checkedInToday = (data: StateResponse): boolean =>
  data.me?.lastCheckIn === todayUtc();

const STEPS: Step[] = [
  {
    id: 'found',
    title: 'Tap any open grass to settle',
    icon: 'icon-home',
    body: 'Tap any open grass tile to found your homestead — your choice! Your House rises where you settle first.',
    done: (_d, snap) => snap.owned >= 1,
    // No single arrow — the scene pulses a few candidate tiles instead.
    target: () => null,
    highlights: (data) => nearestClaimableKeys(data, 3),
  },
  {
    id: 'field',
    title: 'Settle a plot, then build a Wheat Field',
    icon: 'icon-hammer',
    body: `Pick a spot beside your house, settle it, then build a Wheat Field (${WHEATFIELD_COST} coins). Wheat feeds the whole village.`,
    done: (_d, snap) => snap.wheatfieldBuilt,
    target: () => {
      // If the build sheet is open, point straight at the Wheat Field card.
      const card = document.querySelector('[data-build-id="wheatfield"]');
      if (card instanceof HTMLElement) return { kind: 'dom', selector: '[data-build-id="wheatfield"]' };
      return null;
    },
    highlights: (data) => {
      // Once the build sheet is open, the arrow points at the card — drop the
      // tile highlights so we don't split attention.
      if (document.querySelector('[data-build-id="wheatfield"]')) return [];
      return fieldHighlightKeys(data, data.me?.id ?? '', 3);
    },
  },
  {
    id: 'collect',
    title: 'Tap your field to collect the harvest',
    icon: 'icon-coin',
    body: 'Your field grows in real time. When a coin pops above it, tap the field to collect — the goods go into your wallet.',
    done: (data) => (data.me?.collects ?? 0) >= 1,
    target: () => ({
      kind: 'tile',
      at: (d) => firstBuildingTile(d, d.me?.id ?? '', 'wheatfield'),
    }),
  },
  {
    id: 'sell',
    title: 'Open the Market and sell your wheat',
    icon: 'icon-cart',
    body: 'Open the Market and sell your wheat — coins arrive the moment you sell, and prices rise when the village runs short.',
    done: (data) => (data.me?.soldUnits ?? 0) >= 1,
    target: () => {
      // Deepest-available target: the wheat Sell button (row expanded), else the
      // wheat market row, else the Market FAB that opens the sheet.
      if (document.querySelector('[data-sell-btn="wheat"]')) {
        return { kind: 'dom', selector: '[data-sell-btn="wheat"]' };
      }
      if (document.querySelector('[data-mkt-good="wheat"]')) {
        return { kind: 'dom', selector: '[data-mkt-good="wheat"]' };
      }
      return { kind: 'dom', selector: '[data-fab="market"]' };
    },
  },
  {
    id: 'checkin',
    title: 'Tap the Hearth to check in',
    icon: 'icon-streak',
    body: 'Warm yourself at the Hearth each day for coins, XP and a growing streak.',
    done: (data) => checkedInToday(data),
    target: () => ({ kind: 'dom', selector: '[data-fab="checkin"]' }),
  },
  {
    id: 'hall',
    title: 'Open the Village Hall to contribute',
    icon: 'icon-trophy',
    body: "The Village Hall is everyone's goal — contribute planks and bricks to level the whole village up together.",
    done: () => hallSeen,
    target: () => {
      const pill = document.querySelector('.hv-keep-pill');
      if (pill instanceof HTMLElement && pill.offsetParent !== null) {
        return { kind: 'dom', selector: '.hv-keep-pill' };
      }
      return { kind: 'dom', selector: '.hv-obj-hall' };
    },
  },
];

// ── Overlay DOM ──────────────────────────────────────────────────────────────

let root: HTMLElement | undefined;
let spot: HTMLElement | undefined;
let arrow: HTMLElement | undefined;
let card: HTMLElement | undefined;
let icoWrap: HTMLElement | undefined;
let stepLabel: HTMLElement | undefined;
let titleEl: HTMLElement | undefined;
let bodyEl: HTMLElement | undefined;
let dotsEl: HTMLElement | undefined;
/** The minimized scroll chip that stands in for the whole card. */
let chip: HTMLElement | undefined;

let activeIndex = -1;
let rafId = 0;
let decided = false;
/** Compact strip: blurb revealed by tapping the strip; auto-collapses on step
 * change. Ignored on desktop (the full card always shows its body). */
let expanded = false;
/** Card collapsed to the scroll chip; auto-restores on step change. */
let minimized = false;

/** The narrow-screen strip mode: a slim single-line card with no blurb. */
const isCompact = (): boolean => window.innerWidth <= 520 || window.innerHeight <= 600;
/** The candidate-tile keys last handed to the scene, so we only redraw the
 * pulsing highlights when the set actually changes (not every store tick). */
let lastHighlightSig: string | null = null;

const isDone = (): boolean => {
  try {
    return sessionStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
};

const markDone = (): void => {
  try {
    sessionStorage.setItem(DONE_KEY, '1');
  } catch {
    // sessionStorage unavailable (private mode) — the in-memory guard still holds.
  }
};

/** A returning/experienced player who should never see the tour. */
const isVeteran = (data: StateResponse): boolean => {
  const me = data.me;
  if (!me) return false;
  const snap = questSnapshot(data.grid, me.id);
  return (
    me.level > 1 ||
    (me.collects ?? 0) > 0 ||
    (me.lifetimeEarned ?? 0) > 0 ||
    snap.owned > 1
  );
};

const build = (mount: HTMLElement): void => {
  spot = el('div', { cls: 'hv-wt-spot' });
  arrow = el('div', { cls: 'hv-wt-arrow', attrs: { role: 'presentation' } });

  icoWrap = el('span', { cls: 'hv-wt-ico', attrs: { role: 'presentation' } });
  stepLabel = el('p', { cls: 'hv-wt-step', text: '' });
  titleEl = el('p', { cls: 'hv-wt-title', text: '' });
  bodyEl = el('p', { cls: 'hv-wt-body', text: '' });
  dotsEl = el('div', { cls: 'hv-wt-dots' });
  const main = el('div', { cls: 'hv-wt-main', children: [stepLabel, titleEl, bodyEl] });

  const minBtn = el('button', {
    cls: 'hv-wt-min',
    text: '–',
    attrs: { type: 'button', 'aria-label': 'Minimize tip', title: 'Minimize' },
    on: {
      click: (e: Event) => {
        e.stopPropagation();
        minimize();
      },
    },
  });
  const skip = el('button', {
    cls: 'hv-wt-skip',
    text: 'Skip',
    attrs: { type: 'button' },
    on: {
      click: (e: Event) => {
        e.stopPropagation();
        complete();
      },
    },
  });
  const foot = el('div', { cls: 'hv-wt-foot', children: [dotsEl, minBtn, skip] });
  card = el('div', {
    cls: 'hv-wt-card',
    attrs: { role: 'dialog', 'aria-label': 'Getting started' },
    children: [icoWrap, main, foot],
    // Tapping the strip (anywhere but a button) toggles the blurb — compact only.
    on: { click: () => toggleExpanded() },
  });

  // Minimized stand-in: a small scroll chip that restores the card on tap.
  chip = el('button', {
    cls: 'hv-wt-chip is-hidden',
    attrs: { type: 'button', 'aria-label': 'Show getting-started tip', title: 'Getting started' },
    children: [iconEl('icon-scroll', 20)],
    on: { click: () => restore() },
  });

  root = el('div', {
    cls: 'hv-wt-root is-hidden',
    children: [spot, arrow, card, chip],
  });
  mount.appendChild(root);

  for (let i = 0; i < STEPS.length; i += 1) {
    dotsEl.appendChild(el('span', { cls: 'hv-wt-dot' }));
  }

  window.addEventListener('resize', () => {
    if (activeIndex >= 0) position();
  });
};

/** Toggle the compact strip's blurb. No-op on desktop or while minimized. */
const toggleExpanded = (): void => {
  if (!isCompact() || minimized) return;
  expanded = !expanded;
  position();
};

const minimize = (): void => {
  minimized = true;
  expanded = false;
  position();
};

const restore = (): void => {
  minimized = false;
  position();
};

const hide = (): void => {
  if (root) root.classList.add('is-hidden');
  activeIndex = -1;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (lastHighlightSig !== null && lastHighlightSig !== '') {
    highlightTiles(null);
  }
  lastHighlightSig = '';
  setToastLift(0);
};

const complete = (): void => {
  markDone();
  hide();
};

/** The first step whose action the player hasn't performed yet (or null when the
 * whole tour is finished). */
const activeStep = (data: StateResponse): { step: Step; index: number } | null => {
  const me = data.me;
  if (!me) return null;
  const snap = questSnapshot(data.grid, me.id);
  for (let i = 0; i < STEPS.length; i += 1) {
    const step = STEPS[i];
    if (!step) continue;
    if (!step.done(data, snap)) return { step, index: i };
  }
  return null;
};

const setStepContent = (step: Step, index: number): void => {
  if (!stepLabel || !titleEl || !bodyEl || !dotsEl || !icoWrap) return;
  stepLabel.textContent = `Step ${index + 1} of ${STEPS.length}`;
  titleEl.textContent = step.title;
  bodyEl.textContent = step.body;
  clearNode(icoWrap);
  icoWrap.appendChild(iconEl(step.icon, 20));
  const dots = dotsEl.children;
  for (let i = 0; i < dots.length; i += 1) {
    dots[i]?.classList.toggle('is-on', i === index);
  }
};

/** Resolve the active target to a viewport-space rectangle, or null when it can't
 * be placed right now (e.g. a scene tile scrolled off-canvas). */
const targetRect = (
  target: Target,
  data: StateResponse
): { x: number; y: number; w: number; h: number } | null => {
  if (target.kind === 'dom') {
    const node = document.querySelector(target.selector);
    if (!(node instanceof HTMLElement) || node.offsetParent === null) return null;
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  const tile = target.at(data);
  if (!tile) return null;
  const pt = tileToScreen(tile.x, tile.y);
  if (!pt) return null;
  const w = 76;
  const h = 54;
  return { x: pt.x - w / 2, y: pt.y - h / 2, w, h };
};

/** Keep a bottom-docked tip card clear of the bottom-right FAB rail (≈2 FABs wide
 * plus margins) so it never overlaps — nor blocks — a FAB it points at. */
const FAB_RAIL_CLEARANCE = 84;
/** The minimized scroll-chip's box (a touch target ~like the journal chip). */
const CHIP_SIZE = 46;

/** Bottom edge (viewport px) of the top HUD chrome — the ink top bar plus the
 * objective/journal column — so a TOP-docked card parks just beneath it and never
 * lands over the objective chips. */
const topChromeBottom = (): number => {
  let bottom = 52;
  for (const sel of ['.hv-topbar', '.hv-topleft']) {
    const node = document.querySelector(sel);
    if (node instanceof HTMLElement && node.offsetParent !== null) {
      const b = node.getBoundingClientRect().bottom;
      if (b > bottom) bottom = b;
    }
  }
  return bottom;
};

/**
 * Place the spotlight ring, arrow and tip card (or its minimized chip) each frame.
 *
 * The ring is a purely visual OUTLINE (no dim veil, no fill — see dom.ts): it is
 * never an input gate, and it re-anchors or hides every frame as its target moves
 * or disappears (a collapsed pill leaves no hollow box).
 *
 * The card is target-aware: it docks in the vertical half OPPOSITE the current
 * target so it never sits over the thing it points at. A target in the bottom half
 * (or none — the "found" step highlights tiles with no single rect) parks the card
 * at TOP, just below the HUD chrome and centered; a target in the top half parks it
 * at BOTTOM, left-aligned and width-capped so the bottom-right FAB rail stays fully
 * tappable. On a phone (`isCompact`) the card renders as a slim single-line strip;
 * minimized, it collapses to a small scroll chip docked at the card's own edge.
 */
const position = (): void => {
  const data = store.data;
  if (!root || !spot || !arrow || !card || !chip || activeIndex < 0 || !data) return;
  const step = STEPS[activeIndex];
  if (!step) return;
  const target = step.target(data);
  const rect = target ? targetRect(target, data) : null;

  const modalNode = document.querySelector('.hv-backdrop.is-open .hv-modal');
  const modal = modalNode instanceof HTMLElement ? modalNode : null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const compact = isCompact();

  // View-mode classes: strip vs comfortable card, blurb reveal, minimized chip.
  card.classList.toggle('hv-wt-compact', compact);
  card.classList.toggle('is-expanded', compact && expanded);
  card.classList.toggle('is-hidden', minimized);
  chip.classList.toggle('is-hidden', !minimized);

  // ── Spotlight ring + arrow ──────────────────────────────────────────────
  // A scene tile whose sheet is now open is hidden behind the modal — drop the
  // ring. DOM targets (the Wheat Field card, the Sell button) live inside the
  // modal and stay outlined. A null rect (target collapsed / off-canvas) hides
  // the ring outright, so no hollow outline is ever left around nothing.
  const hideMark = !target || !rect || (target.kind === 'tile' && modal !== null);
  spot.style.opacity = hideMark ? '0' : '1';
  arrow.style.opacity = hideMark ? '0' : '1';
  if (!hideMark && rect && target) {
    const pad = target.kind === 'dom' ? 8 : 4;
    spot.style.left = `${rect.x - pad}px`;
    spot.style.top = `${rect.y - pad}px`;
    spot.style.width = `${rect.w + pad * 2}px`;
    spot.style.height = `${rect.h + pad * 2}px`;
    const cx = rect.x + rect.w / 2;
    const above = rect.y > 96;
    arrow.style.setProperty('--rot', above ? '180deg' : '0deg');
    arrow.style.left = `${cx}px`;
    arrow.style.top = `${above ? rect.y - 26 : rect.y + rect.h + 26}px`;
  }

  // ── Card / chip slot ─────────────────────────────────────────────────────
  let atBottom = false;
  if (modal !== null) {
    // Docked to the modal's top — a fixed slot above the header banner, never
    // over the modal body (so it can't land on the sell steppers after a row
    // expands). Clamped below the top bar so it can't clip off-screen.
    card.style.maxWidth = '';
    const cw = card.offsetWidth || 280;
    const ch = card.offsetHeight || 150;
    const mr = modal.getBoundingClientRect();
    const left = Math.max(12, Math.min(mr.left + (mr.width - cw) / 2, vw - cw - 12));
    const top = Math.max(56, mr.top - ch - 8);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    chip.style.left = `${Math.max(12, Math.min(mr.right - CHIP_SIZE - 4, vw - CHIP_SIZE - 12))}px`;
    chip.style.top = `${Math.max(56, mr.top - CHIP_SIZE - 8)}px`;
  } else {
    // Dock opposite the target's half. A target centered in the TOP half ⇒ card
    // at BOTTOM; a target in the BOTTOM half (or no rect) ⇒ card at TOP.
    atBottom = rect !== null && rect.y + rect.h / 2 < vh * 0.5;
    card.style.maxWidth = atBottom
      ? `${Math.max(160, vw - 12 - FAB_RAIL_CLEARANCE)}px`
      : '';
    if (atBottom) {
      const ch = card.offsetHeight || 150;
      card.style.left = '12px';
      card.style.top = `${vh - ch - 24}px`;
      chip.style.left = '12px';
      chip.style.top = `${vh - CHIP_SIZE - 24}px`;
    } else {
      const topY = topChromeBottom() + 8;
      const cw = card.offsetWidth || 280;
      card.style.left = `${Math.max(12, Math.min((vw - cw) / 2, vw - cw - 12))}px`;
      card.style.top = `${topY}px`;
      chip.style.left = `${Math.max(12, (vw - CHIP_SIZE) / 2)}px`;
      chip.style.top = `${topY}px`;
    }
  }

  // Raise the toast stack above whatever is bottom-docked (card or chip) so gain
  // toasts never clip behind it; reset otherwise.
  const bottomH = minimized ? CHIP_SIZE : card.offsetHeight || 150;
  setToastLift(atBottom ? bottomH + 36 : 0);
};

/** Reposition every frame while a step is active (cheap: a few reads + writes),
 * so scene targets track the camera and DOM targets track any reflow. */
const loop = (): void => {
  if (activeIndex < 0) return;
  position();
  rafId = requestAnimationFrame(loop);
};

/** Push the active step's candidate-tile highlights to the scene (or clear them
 * when the step has none). Recomputed on each `show` — i.e. on every store
 * change — so highlights drop tiles as they get claimed. */
const applyHighlights = (step: Step | null, data: StateResponse | null): void => {
  const keys = step?.highlights && data ? step.highlights(data) : [];
  const sig = keys.join('|');
  if (sig === lastHighlightSig) return;
  lastHighlightSig = sig;
  highlightTiles(keys.length > 0 ? keys : null);
};

const show = (step: Step, index: number): void => {
  if (!root) return;
  const changed = index !== activeIndex;
  activeIndex = index;
  root.classList.remove('is-hidden');
  if (changed) {
    // A new step resets the transient view flags: blurb collapses, card restores.
    expanded = false;
    minimized = false;
    setStepContent(step, index);
  }
  applyHighlights(step, store.data);
  position();
  if (!rafId) rafId = requestAnimationFrame(loop);
};

/** Re-derive the tour state from the store and reflect it in the overlay. */
const evaluate = (): void => {
  if (!root) return;
  const data = store.data;
  if (!data || !data.me) {
    hide();
    return;
  }
  if (isDone()) {
    hide();
    return;
  }
  if (!decided) {
    decided = true;
    if (isVeteran(data)) {
      complete();
      return;
    }
  }
  const active = activeStep(data);
  if (!active) {
    complete();
    return;
  }
  show(active.step, active.index);
};

/** Mount the walkthrough overlay and begin mirroring the store. Call once, after
 * the HUD chrome is in place. */
export const initWalkthrough = (mount: HTMLElement): void => {
  if (root) return;
  build(mount);
  store.on('change', evaluate);
  evaluate();
};
