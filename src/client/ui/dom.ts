import type { Game } from 'phaser';
import { showLoginPrompt, showToast } from '@devvit/web/client';
import { PAL } from '../../shared/palette';
import type {
  BuildingCategory,
  BuildingId,
  PlayerState,
  StateResponse,
  TileState,
} from '../../shared/types';
import { BOOST_DAILY_LIMIT } from '../../shared/catalog';
import { parseKey } from '../../shared/logic/grid';
import { accrue, adjacencyBonus, utcDay } from '../../shared/logic/economy';
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

// ── Category presentation ────────────────────────────────────────────────────

export type CatMeta = { label: string; emoji: string; color: string };

export const CATEGORY_META: Record<BuildingCategory, CatMeta> = {
  coins: { label: 'Coins', emoji: '🪙', color: PAL.roofStraw },
  supplies: { label: 'Supplies', emoji: '🌿', color: PAL.leaf },
  decor: { label: 'Decor', emoji: '✨', color: PAL.accent },
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
  let n = 0;
  for (const [key, tile] of Object.entries(data.grid)) {
    if (tile.owner !== id || tile.buildingId === undefined) continue;
    if (now < tile.readyAt) continue;
    const { x, y } = parseKey(key);
    const adj = adjacencyBonus(data.grid, x, y, fest, now);
    const g = accrue(tile, now, fest, adj);
    if (g.coins + g.supplies > 0) n += 1;
  }
  return n;
};

export const todayUtc = (): string => utcDay(store.serverNow());

/** Boosts a player still has today (accounting for the UTC date rollover). */
export const boostsLeft = (me: PlayerState): number => {
  const used = me.boostsDate === todayUtc() ? me.boostsToday : 0;
  return Math.max(0, BOOST_DAILY_LIMIT - used);
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
 * A longer-lived toast carrying a single action button (e.g. "Share it? 💬").
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
  font-family: ui-rounded, -apple-system, "Segoe UI Rounded", "Segoe UI", system-ui, sans-serif;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
#hv-hud * { box-sizing: border-box; }

.hv-pixel { image-rendering: pixelated; }

/* ── Top bar ─────────────────────────────────────────────── */
.hv-topbar {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(var(--sat) + 8px) calc(var(--sar) + 8px) 8px calc(var(--sal) + 8px);
  flex-wrap: wrap;
}
.hv-chip {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 6px;
  box-shadow: 0 2px 0 rgba(59,51,71,0.35);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.3px;
  line-height: 1;
}
.hv-chip .hv-swatch {
  width: 12px; height: 12px;
  border: 2px solid var(--ink);
  border-radius: 2px;
  flex: 0 0 auto;
}
.hv-chip-emoji { font-size: 15px; }
.hv-chip-num { font-variant-numeric: tabular-nums; }

.hv-ring {
  pointer-events: auto;
  position: relative;
  width: 40px; height: 40px;
  flex: 0 0 auto;
}
.hv-ring svg { display: block; }
.hv-ring .hv-ring-lvl {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 800;
  color: var(--ink);
}

.hv-fest {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 10px;
  border: 3px solid var(--ink);
  border-radius: 6px;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.3px;
  color: var(--ink);
  box-shadow: 0 2px 0 rgba(59,51,71,0.35);
}
.hv-fest .hv-fest-label { opacity: 0.85; font-weight: 800; }

.hv-signin-pill {
  pointer-events: auto;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  background: var(--glow);
  border: 3px solid var(--ink);
  border-radius: 6px;
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.3px;
  cursor: pointer;
  box-shadow: 0 3px 0 var(--wood-dark);
}
.hv-signin-pill:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--wood-dark); }

/* ── FAB stack ───────────────────────────────────────────── */
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
  width: 60px; height: 60px;
  min-width: 44px; min-height: 44px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 12px;
  box-shadow: 0 4px 0 var(--wood-dark);
  cursor: pointer;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: 0.3px;
}
.hv-fab .hv-fab-emoji { font-size: 22px; line-height: 1; }
.hv-fab .hv-fab-cap { font-size: 9px; letter-spacing: 0.2px; }
.hv-fab.hv-primary { background: var(--glow); }
.hv-fab:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--wood-dark); }
.hv-fab[disabled] { opacity: 0.5; cursor: not-allowed; box-shadow: 0 4px 0 var(--wood-dark); transform: none; }
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

/* ── Sheets ──────────────────────────────────────────────── */
.hv-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(46,40,55,0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease-out;
}
.hv-backdrop.is-open { opacity: 1; pointer-events: auto; }

.hv-sheet {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: min(520px, 100%);
  transform: translate(-50%, 100%);
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-bottom: none;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -6px 0 rgba(59,51,71,0.25);
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
  padding-bottom: var(--sab);
}
.hv-sheet.is-open { transform: translate(-50%, 0); pointer-events: auto; }
.hv-sheet.is-dragging { transition: none; }

.hv-sheet-handle {
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  cursor: grab;
  touch-action: none;
}
.hv-sheet-handle span {
  width: 44px; height: 5px;
  background: var(--wall-shade);
  border: 1px solid var(--ink);
  border-radius: 3px;
}
.hv-sheet-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 14px 10px;
}
.hv-sheet-title {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.5px;
  margin: 0;
}
.hv-sheet-close {
  pointer-events: auto;
  margin-left: auto;
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
.hv-sheet-close:active { transform: translateY(2px); }
.hv-sheet-body {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 4px 14px calc(16px + var(--sab));
}

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

.hv-note { font-size: 12.5px; line-height: 1.5; color: var(--ink); opacity: 0.85; }
.hv-muted { opacity: 0.7; }
.hv-stack > * + * { margin-top: 12px; }
.hv-row-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13.5px; }
.hv-row-line b { font-variant-numeric: tabular-nums; }
.hv-stars { color: var(--straw); letter-spacing: 2px; font-size: 15px; }

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

/* ── Onboarding + login ──────────────────────────────────── */
.hv-onboard {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  background: radial-gradient(120% 60% at 50% 40%, rgba(46,40,55,0) 30%, rgba(46,40,55,0.6) 100%);
}
.hv-onboard-card {
  margin-top: calc(var(--sat) + 64px);
  max-width: 300px;
  padding: 14px 16px;
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 14px;
  box-shadow: 0 4px 0 var(--wood-dark);
  text-align: center;
  position: relative;
}
.hv-onboard-card h3 { margin: 0 0 6px; font-size: 16px; letter-spacing: 0.5px; }
.hv-onboard-card p { margin: 0; font-size: 13px; line-height: 1.4; }
.hv-onboard-dismiss {
  pointer-events: auto;
  position: absolute;
  top: -10px; right: -10px;
  width: 30px; height: 30px;
  border-radius: 15px;
  background: var(--wall);
  border: 3px solid var(--ink);
  font-weight: 800;
  cursor: pointer;
  color: var(--ink);
}
.hv-onboard-arrow {
  margin-top: 8px;
  font-size: 34px;
  color: var(--glow);
  text-shadow: 0 2px 0 var(--ink);
  animation: hv-bounce 1s ease-in-out infinite;
}
@keyframes hv-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(10px); }
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

/* ── Focus visibility ────────────────────────────────────── */
#hv-hud :focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

@media (max-width: 380px) {
  .hv-chip { height: 32px; font-size: 13px; padding: 0 8px; }
  .hv-fab { width: 54px; height: 54px; }
  .hv-sheet-title { font-size: 16px; }
}

/* ── Reduced motion: still the bob, drop transition easing ──── */
@media (prefers-reduced-motion: reduce) {
  .hv-onboard-arrow { animation: none; }
  .hv-toast { transition: opacity 120ms linear; transform: none; }
  .hv-toast.is-in { transform: none; }
  .hv-sheet { transition: none; }
  .hv-fill > i { transition: none; }
}
`;
