import type { Game } from 'phaser';
import {
  KEEP_STAGE_COSTS,
  MAX_LEVEL,
  PLOT_LEVELS,
} from '../../shared/catalog';
import type { Good, PlayerState, StateResponse } from '../../shared/types';
import { GOODS, xpFor } from '../../shared/logic/economy';
import type { HvTileSelected } from '../events';
import { HV_TILE_SELECTED, setCollapseObjectives } from '../events';
import { api } from '../net';
import { store } from '../state';
import {
  activeQuest,
  clearPending,
  el,
  fmtInt,
  gainedLine,
  GOOD_LABEL,
  goodIcon,
  iconEl,
  injectStyles,
  isPending,
  markPending,
  mountToasts,
  notifyError,
  promptLogin,
  readyCount,
  setGame,
  toast,
  toastAction,
  todayLabel,
  todayTip,
  todayUtc,
  WEATHER_META,
  withTip,
} from './dom';
import type { ShareKind } from '../net';
import { mountSheetRoot } from './sheet';
import { openMenuSheet, openTileSheet } from './panels';
import { openKeepSheet, openLevelSheet, openMarketSheet } from './sheets';
import { mountJournal } from './journal';
import { initWalkthrough } from './walkthrough';

/**
 * The persistent HUD chrome: the top resource bar (coins, Hall-material chips,
 * the one "Today" chip), the bottom-right FAB rail, the toast host, and
 * `initHud` — the entry point `game.ts` calls once Phaser has booted.
 * Everything reads from `store` and re-renders on `'change'`; nothing here is
 * torn down (it lives for the whole session), so there are no listener leaks
 * to chase.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

// Persistent element references (built once, updated on each render).
let coinsChip: HTMLElement;
let coinsNum: HTMLElement;
let ring: HTMLElement;
let ringProgress: SVGCircleElement;
let ringLevel: HTMLElement;
// One "Today" chip merges weather + festival ("Today: Rain · Craft ×1.5").
let todayChip: HTMLElement;
let todayIcon: HTMLElement;
let todayText: HTMLElement;
let signinPill: HTMLElement;
// A wallet chip per good, shown only when the player actually holds some. Raw
// goods + flour are sold at the Market; planks/bricks are spent at the Hall.
const goodChips: Partial<Record<Good, { chip: HTMLButtonElement; num: HTMLElement }>> = {};

// Keep pill (top-left column, beneath the Journal banner).
let keepPill: HTMLButtonElement;
let keepLabel: HTMLElement;
let keepFill: HTMLElement;

let collectFab: HTMLButtonElement;
let collectBadge: HTMLElement;
let checkinFab: HTMLButtonElement;
let checkinStreak: HTMLElement;

// Count-up animation + level-up tracking.
const rafMap = new Map<HTMLElement, number>();
let lastCoins = 0;
let prevLevel: number | null = null;
let prevStage: number | null = null;

// Collapsible objectives (top-left column): after 6s without interaction — or
// immediately when the player touches the map — the Journal banner + Hall pill
// give way to two compact chips; tapping a chip re-expands for 8s. Pure
// presentation, nothing persisted.
const OBJ_IDLE_MS = 6000;
const OBJ_PEEK_MS = 8000;
let topLeft: HTMLElement;
let jrChip: HTMLButtonElement;
let jrChipFill: HTMLElement;
let hallChip: HTMLButtonElement;
let hallChipLvl: HTMLElement;
let objTimer: number | undefined;
/** `${index}:${lap}:${done}` for the last-seen quest ('' = none) — expansion edge. */
let prevQuestSig: string | null = null;

// ── Entry point ──────────────────────────────────────────────────────────────

export const initHud = (game: Game): void => {
  setGame(game);
  injectStyles();

  const host = document.getElementById('app') ?? document.body;
  const hud = el('div', { attrs: { id: 'hv-hud' } });
  host.appendChild(hud);

  hud.appendChild(buildTopBar());
  hud.appendChild(buildFabs());

  // Top-left column: the Journal banner, then the Keep pill, stacked — plus
  // their compact collapsed chips (visible only while the column is collapsed).
  topLeft = el('div', { cls: 'hv-topleft' });
  hud.appendChild(topLeft);
  mountJournal(topLeft);
  topLeft.appendChild(buildKeepPill());
  topLeft.appendChild(buildJournalChip());
  topLeft.appendChild(buildHallChip());
  initObjectivesCollapse();

  mountSheetRoot(hud);
  mountToasts(hud);
  // The guided walkthrough overlay (coach marks) sits above the chrome and points
  // new players at the next action; it self-hides for veterans / once completed.
  initWalkthrough(hud);

  window.addEventListener(HV_TILE_SELECTED, (e: Event) => {
    if (e instanceof CustomEvent) {
      const detail: HvTileSelected = e.detail;
      openTileSheet(detail);
    }
  });

  store.on('change', renderHud);
  // Buildings ripen over time without a store change, so refresh the FAB state
  // (Collect-All badge, check-in availability) on a light cadence too.
  window.setInterval(renderHud, 4000);
  renderHud();
};

// ── Top bar ──────────────────────────────────────────────────────────────────

const buildRing = (): void => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '40');
  svg.setAttribute('height', '40');
  svg.setAttribute('viewBox', '0 0 40 40');

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('cx', '20');
  track.setAttribute('cy', '20');
  track.setAttribute('r', String(RING_R));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--wall-shade)');
  track.setAttribute('stroke-width', '4');

  ringProgress = document.createElementNS(SVG_NS, 'circle');
  ringProgress.setAttribute('cx', '20');
  ringProgress.setAttribute('cy', '20');
  ringProgress.setAttribute('r', String(RING_R));
  ringProgress.setAttribute('fill', 'none');
  ringProgress.setAttribute('stroke', 'var(--glow)');
  ringProgress.setAttribute('stroke-width', '4');
  ringProgress.setAttribute('stroke-linecap', 'round');
  ringProgress.setAttribute('stroke-dasharray', String(RING_C));
  ringProgress.setAttribute('stroke-dashoffset', String(RING_C));
  ringProgress.setAttribute('transform', 'rotate(-90 20 20)');

  svg.appendChild(track);
  svg.appendChild(ringProgress);

  ringLevel = el('span', { cls: 'hv-ring-lvl', text: '1' });
  ring = el('button', {
    cls: 'hv-ring',
    attrs: { type: 'button' },
    on: { click: () => openLevelSheet() },
  });
  withTip(ring, () => `Level ${store.data?.me?.level ?? 1} — tap for unlocks`);
  ring.appendChild(svg);
  ring.appendChild(ringLevel);
};

/** A small top-bar chip for a wallet good. Tapping planks/bricks opens the Hall
 * (where they are spent); tapping a sellable good opens the Market. Hidden while
 * the count is 0. */
const buildGoodChip = (
  good: Good,
  tip: string,
  onOpen: () => void
): { chip: HTMLButtonElement; num: HTMLElement } => {
  const num = el('span', { cls: 'hv-chip-num', text: '0' });
  const chip = el('button', {
    cls: 'hv-chip hv-chip-good',
    attrs: { type: 'button' },
    children: [goodIcon(good, 16), num],
    on: { click: onOpen },
  });
  withTip(chip, tip);
  chip.style.display = 'none';
  return { chip, num };
};

const buildTopBar = (): HTMLElement => {
  // Left: coins, plus one chip per held good (all appear only when nonzero).
  coinsNum = el('span', { cls: 'hv-chip-num', text: '0' });
  coinsChip = el('div', {
    cls: 'hv-chip',
    children: [iconEl('icon-coin', 16), coinsNum],
  });
  withTip(coinsChip, 'Your coins');
  const left = el('div', { cls: 'hv-tb-left', children: [coinsChip] });
  for (const g of GOODS) {
    const isHall = g === 'planks' || g === 'bricks';
    const tip = isHall
      ? `${GOOD_LABEL[g]} — contribute at the Village Hall`
      : `${GOOD_LABEL[g]} — sell at the Village Market`;
    const built = buildGoodChip(g, tip, isHall ? openKeepSheet : () => openMarketSheet());
    goodChips[g] = built;
    left.appendChild(built.chip);
  }

  // Right: level ring (logged in) or the sign-in pill (logged out).
  buildRing();
  signinPill = el('button', {
    cls: 'hv-signin-pill',
    attrs: { type: 'button' },
    children: [iconEl('icon-home', 15), el('span', { text: 'Sign in to build' })],
    on: { click: () => promptLogin() },
  });
  const right = el('div', { cls: 'hv-tb-right', children: [ring, signinPill] });

  // Center: ONE compact "Today" chip covering weather + festival.
  todayIcon = iconEl('icon-star', 14);
  todayText = el('span', { cls: 'hv-tb-label', text: 'Today' });
  todayChip = el('div', {
    cls: 'hv-tb-chip',
    children: [todayIcon, todayText],
  });
  withTip(todayChip, () =>
    todayTip(store.data?.weather ?? 'sunny', store.data?.city.festival ?? 'coins')
  );
  const center = el('div', { cls: 'hv-tb-center', children: [todayChip] });

  return el('div', { cls: 'hv-topbar', children: [left, center, right] });
};

// ── FAB stack ────────────────────────────────────────────────────────────────

const buildFab = (
  icon: HTMLElement,
  caption: string,
  tip: string,
  primary: boolean
): HTMLButtonElement => {
  const fab = el('button', {
    cls: `hv-fab${primary ? ' hv-primary' : ''}`,
    attrs: { type: 'button' },
    children: [icon, el('span', { cls: 'hv-fab-cap', text: caption })],
  });
  return withTip(fab, tip);
};

const buildFabs = (): HTMLElement => {
  // Order top→bottom: Collect · Market · Check in · Menu.
  collectFab = buildFab(
    iconEl('icon-coin', 24),
    'Collect',
    'Collect every ready building at once',
    true
  );
  collectFab.setAttribute('data-fab', 'collect');
  collectBadge = el('span', { cls: 'hv-fab-badge' });
  collectFab.appendChild(collectBadge);
  collectFab.addEventListener('click', doCollectAll);

  const marketFab = buildFab(
    iconEl('icon-cart', 24),
    'Market',
    'See village prices and what the village needs',
    false
  );
  marketFab.setAttribute('data-fab', 'market');
  marketFab.addEventListener('click', () => openMarketSheet());

  checkinFab = buildFab(
    iconEl('icon-streak', 24),
    'Check in',
    'Daily check-in — coins and a growing streak',
    false
  );
  checkinFab.setAttribute('data-fab', 'checkin');
  checkinStreak = el('span', { cls: 'hv-streak' });
  checkinFab.appendChild(checkinStreak);
  checkinFab.addEventListener('click', doCheckin);

  const menuFab = buildFab(
    iconEl('icon-gear', 24),
    'Menu',
    'Market, hall, leaderboards and help',
    false
  );
  menuFab.setAttribute('data-fab', 'menu');
  menuFab.addEventListener('click', () => openMenuSheet());

  return el('div', {
    cls: 'hv-fabs',
    children: [collectFab, marketFab, checkinFab, menuFab],
  });
};

// ── Hall pill (collective goal, always in view) ──────────────────────────────

const buildKeepPill = (): HTMLButtonElement => {
  keepLabel = el('span', { cls: 'hv-keep-label', text: 'Hall' });
  keepFill = el('i');
  keepPill = el('button', {
    cls: 'hv-keep-pill',
    attrs: { type: 'button' },
    children: [
      iconEl('icon-trophy', 15),
      el('div', {
        cls: 'hv-keep-main',
        children: [
          keepLabel,
          el('div', { cls: 'hv-keep-bar', children: [keepFill] }),
        ],
      }),
    ],
    on: { click: () => openKeepSheet() },
  });
  withTip(keepPill, 'Village Hall — tap to contribute planks and bricks');
  return keepPill;
};

const renderKeepPill = (data: StateResponse): void => {
  const level = data.city.hallLevel;
  const stages = KEEP_STAGE_COSTS.length;
  if (level >= stages) {
    keepLabel.textContent = 'Hall complete';
    keepFill.style.width = '100%';
    return;
  }
  const cost = KEEP_STAGE_COSTS[level] ?? { planks: 0, bricks: 0 };
  const have = data.city.stagePlanks + data.city.stageBricks;
  const need = cost.planks + cost.bricks;
  const frac = need > 0 ? have / need : 0;
  const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  // The population half of the level-up gate: villagers here / needed next.
  const popNeed = data.ring.nextThreshold;
  const villagers =
    popNeed !== null ? ` · villagers ${data.ring.population}/${popNeed}` : '';
  keepLabel.textContent = `Hall L${level} · resources ${pct}%${villagers}`;
  keepFill.style.width = `${pct}%`;
};

// ── Collapsible objectives (banner + pill ⇄ compact chips) ───────────────────

const setObjCollapsed = (collapsed: boolean): void => {
  topLeft.classList.toggle('is-collapsed', collapsed);
};

/** (Re)arm the auto-collapse timer. */
const armObjTimer = (ms: number): void => {
  if (objTimer !== undefined) window.clearTimeout(objTimer);
  objTimer = window.setTimeout(() => {
    objTimer = undefined;
    setObjCollapsed(true);
  }, ms);
};

/** Collapse the column immediately, cancelling any pending idle timer. */
const collapseObjectivesNow = (): void => {
  if (objTimer !== undefined) {
    window.clearTimeout(objTimer);
    objTimer = undefined;
  }
  setObjCollapsed(true);
};

/** Expand the column now and collapse again after `ms` of no interaction. */
const expandObjectives = (ms: number): void => {
  setObjCollapsed(false);
  armObjTimer(ms);
};

const initObjectivesCollapse = (): void => {
  armObjTimer(OBJ_IDLE_MS);
  // The column collapses on exactly two triggers, and NOTHING else:
  //   1. A genuine pointerdown on the game canvas (a map drag/tap) — the Village
  //      scene calls requestCollapseObjectives() from its canvas handler. There
  //      is deliberately NO window-level pointerdown listener here: such a
  //      listener races chip/banner/pill clicks and can collapse the column out
  //      from under the very tap meant to claim/open it (playtest softlock).
  //   2. OBJ_IDLE_MS of no interaction with the column (the armObjTimer above).
  setCollapseObjectives(collapseObjectivesNow);
  // Any press INSIDE the column just restarts its idle window — never collapses.
  // Bound to the column element itself (not the window), so it can't interfere
  // with the chips'/banner's own click handlers.
  topLeft.addEventListener('pointerdown', () => armObjTimer(OBJ_IDLE_MS));
};

/** The journal chip: a small rounded-square parchment card with the scroll icon
 * and a thin progress underline; turns gold (CSS .is-claimable) with a gentle
 * pulse when the goal is claimable. */
const buildJournalChip = (): HTMLButtonElement => {
  jrChipFill = el('i');
  const underline = el('div', { cls: 'hv-obj-underline', children: [jrChipFill] });

  jrChip = el('button', {
    cls: 'hv-obj-chip hv-obj-jr',
    attrs: { type: 'button', 'aria-label': 'Current goal — tap to expand' },
    children: [iconEl('icon-scroll', 16), underline],
  });
  jrChip.style.display = 'none';
  jrChip.addEventListener('click', () => expandObjectives(OBJ_PEEK_MS));
  return jrChip;
};

/** The hall chip: a tiny dark circle with the trophy icon + hall level number. */
const buildHallChip = (): HTMLButtonElement => {
  hallChipLvl = el('span', { cls: 'hv-obj-lvl', text: '0' });
  hallChip = el('button', {
    cls: 'hv-obj-chip hv-obj-hall',
    attrs: { type: 'button', 'aria-label': 'Village Hall — tap to expand' },
    children: [iconEl('icon-trophy', 13), hallChipLvl],
    on: { click: () => expandObjectives(OBJ_PEEK_MS) },
  });
  return hallChip;
};

/** Mirror quest/hall state onto the chips; auto-expand on a quest edge (done
 * flips true, or a brand-new quest arrives). */
const renderObjChips = (data: StateResponse): void => {
  const quest = data.me ? activeQuest(data) : null;
  jrChip.style.display = quest ? '' : 'none';
  if (quest) {
    const frac =
      quest.target > 0 ? Math.max(0, Math.min(1, quest.have / quest.target)) : 1;
    jrChipFill.style.width = `${Math.round(frac * 100)}%`;
    jrChip.classList.toggle('is-claimable', quest.done);
  }
  hallChipLvl.textContent = String(data.city.hallLevel);

  const sig = quest ? `${quest.index}:${quest.lap}:${quest.done ? 1 : 0}` : '';
  if (quest && prevQuestSig !== null && sig !== prevQuestSig) {
    const [pi = '', pl = '', pd = ''] = prevQuestSig.split(':');
    const isNewQuest =
      prevQuestSig === '' || pi !== String(quest.index) || pl !== String(quest.lap);
    const nowClaimable = quest.done && pd !== '1' && !isNewQuest;
    if (isNewQuest || nowClaimable) expandObjectives(OBJ_PEEK_MS);
  }
  prevQuestSig = sig;
};

const doCollectAll = (): void => {
  if (isPending('collectAll')) return;
  markPending('collectAll');
  renderHud();
  void api
    .collectAll()
    .then((res) => {
      const tiles = Object.entries(res.tiles).map(([key, tile]) => ({ key, tile }));
      store.applyMutation({ tiles, me: res.me });
      const line = gainedLine(res.gained);
      if (line) toast(line, 'gain');
    })
    .catch((err: unknown) =>
      notifyError(err instanceof Error ? err.message : 'Could not collect.')
    )
    .finally(() => {
      clearPending('collectAll');
      renderHud();
    });
};

const doCheckin = (): void => {
  if (isPending('checkin')) return;
  markPending('checkin');
  renderHud();
  void api
    .checkin()
    .then((res) => {
      store.applyMutation({ me: res.me });
      toast(
        `Checked in! Streak ${res.me.streak} — +${fmtInt(res.gained.coins)} coins, +${fmtInt(res.gained.xp)} XP`,
        'celebrate'
      );
    })
    .catch((err: unknown) =>
      notifyError(err instanceof Error ? err.message : 'Could not check in.')
    )
    .finally(() => {
      clearPending('checkin');
      renderHud();
    });
};

// ── Render ───────────────────────────────────────────────────────────────────

const animateCount = (span: HTMLElement, from: number, to: number): void => {
  const existing = rafMap.get(span);
  if (existing !== undefined) cancelAnimationFrame(existing);
  if (from === to) {
    span.textContent = fmtInt(to);
    rafMap.delete(span);
    return;
  }
  const start = performance.now();
  const step = (t: number): void => {
    const k = Math.min(1, (t - start) / 400);
    span.textContent = fmtInt(from + (to - from) * k);
    if (k < 1) rafMap.set(span, requestAnimationFrame(step));
    else rafMap.delete(span);
  };
  rafMap.set(span, requestAnimationFrame(step));
};

/** Offer an opt-in "share this milestone to the comments" toast button. */
const promptShare = (kind: ShareKind, value: number): void => {
  toastAction('Share it?', 'Share', () => {
    void api
      .share(kind, value)
      .then(() => toast('Shared to comments!', 'celebrate'))
      .catch((err: unknown) =>
        notifyError(err instanceof Error ? err.message : 'Could not share.')
      );
  });
};

const swapIcon = (slot: HTMLElement, next: HTMLElement): HTMLElement => {
  slot.replaceWith(next);
  return next;
};

const renderToday = (data: StateResponse): void => {
  todayIcon = swapIcon(todayIcon, iconEl(WEATHER_META[data.weather].icon, 14));
  todayText.textContent = todayLabel(data.weather, data.city.festival);
  todayChip.setAttribute('aria-label', todayTip(data.weather, data.city.festival));
};

/** Each wallet-good chip appears in the top bar only while the player holds some
 * of that good. */
const renderGoodChips = (me: PlayerState): void => {
  for (const g of GOODS) {
    const c = goodChips[g];
    if (!c) continue;
    c.num.textContent = fmtInt(me.wallet[g]);
    c.chip.style.display = me.wallet[g] > 0 ? '' : 'none';
  }
};

const renderPlayer = (me: PlayerState): void => {
  coinsChip.style.display = '';
  ring.style.display = '';
  signinPill.style.display = 'none';

  animateCount(coinsNum, lastCoins, me.coins);
  lastCoins = me.coins;
  renderGoodChips(me);

  const cur = xpFor(me.level);
  const next = xpFor(me.level + 1);
  const denom = next - cur;
  const frac = me.level >= MAX_LEVEL || denom <= 0 ? 1 : (me.xp - cur) / denom;
  const clamped = Math.max(0, Math.min(1, frac));
  ringProgress.setAttribute('stroke-dashoffset', String(RING_C * (1 - clamped)));
  ringLevel.textContent = String(me.level);
  ring.setAttribute('aria-label', `Level ${me.level} — tap for unlocks`);

  if (prevLevel !== null && me.level > prevLevel) {
    const unlocked = PLOT_LEVELS.includes(me.level);
    toast(
      `Level ${me.level}!${unlocked ? ' New plot unlocked' : ''}`,
      'celebrate'
    );
    if (me.level >= 2) promptShare('levelup', me.level);
  }
  prevLevel = me.level;
};

const renderLoggedOut = (): void => {
  coinsChip.style.display = 'none';
  for (const g of GOODS) {
    const c = goodChips[g];
    if (c) c.chip.style.display = 'none';
  }
  ring.style.display = 'none';
  signinPill.style.display = '';
};

const renderFabs = (data: StateResponse, me: PlayerState | null): void => {
  if (!me) {
    collectFab.style.display = 'none';
    checkinFab.style.display = 'none';
    return;
  }
  const now = store.serverNow();
  const ready = readyCount(data, me.id, now);
  const busyCollect = isPending('collectAll');
  collectFab.style.display = ready > 0 || busyCollect ? '' : 'none';
  collectBadge.textContent = String(ready);
  collectBadge.style.display = ready > 0 ? '' : 'none';
  collectFab.disabled = busyCollect || ready === 0;

  checkinFab.style.display = '';
  const checkedIn = me.lastCheckIn === todayUtc();
  checkinFab.disabled = checkedIn || isPending('checkin');
  checkinFab.classList.toggle('is-checked', checkedIn);
  checkinStreak.textContent = me.streak > 0 ? String(me.streak) : '';
  checkinStreak.style.display = me.streak > 0 ? '' : 'none';
};

const renderHud = (): void => {
  const data = store.data;
  if (!data) return;
  const me = data.me;

  renderToday(data);
  renderKeepPill(data);
  renderObjChips(data);
  if (me) renderPlayer(me);
  else renderLoggedOut();
  renderFabs(data, me);

  // A Village Hall level the whole village just raised together — offer a share.
  const stage = data.city.hallLevel;
  if (prevStage !== null && stage > prevStage && stage >= 1) {
    promptShare('stage', stage);
  }
  prevStage = stage;
};
