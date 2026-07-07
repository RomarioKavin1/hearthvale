import type { BuildingSpec, TierStats } from '../../shared/catalog';
import { CATALOG, tierStats } from '../../shared/catalog';
import type {
  PlayerState,
  StateResponse,
  Tier,
  TileState,
  Weather,
} from '../../shared/types';
import { isClaimable, neighbors, tileKey } from '../../shared/logic/grid';
import {
  accrue,
  adjacencyBonus,
  canClaim,
  CHAIN_PAIRS,
  goodsTotal,
  plotsForLevel,
  roleToFestival,
} from '../../shared/logic/economy';
import { isRiver } from '../../shared/logic/expansion';
import type { HvTileSelected } from '../events';
import { api } from '../net';
import { store } from '../state';
import {
  boostsLeft,
  buildingIconKey,
  el,
  fmtBuildTime,
  fmtDur,
  fmtInt,
  GOOD_LABEL,
  goodIcon,
  iconEl,
  isPending,
  ownedCount,
  pctStr,
  promptLogin,
} from './dom';
import type { SpriteKey } from '../art/manifest';
import { action, openSheet, setSheetTitle, toast } from './sheet';
import {
  openBallotSheet,
  openHowToSheet,
  openKeepSheet,
  openLeaderboardsSheet,
  openMarketSheet,
  openTraderSheet,
} from './sheets';

/**
 * The two "hub" sheets: the context-sensitive tile sheet (six variants driven by
 * what was tapped) and the menu that fans out to the secondary sheets. Both
 * recompute from `store` on every render so they track claims/builds/collects and
 * live countdowns without stale closures.
 */

/** Tier pips as monochrome geometric shapes (filled ● / empty ○ — not emoji). */
const stars = (tier: number): string =>
  '●●●'.slice(0, tier) + '○○○'.slice(0, Math.max(0, 3 - tier));

const line = (label: string, value: string): HTMLElement =>
  el('div', {
    cls: 'hv-row-line',
    children: [el('span', { text: label }), el('b', { text: value })],
  });

/** The icon for whatever a building outputs (a good, or coins). */
const outputIcon = (spec: BuildingSpec, size = 16): HTMLElement => {
  if (spec.role === 'raw' && spec.good) return goodIcon(spec.good, size);
  if (spec.role === 'processor' && spec.output && spec.output !== 'coins') {
    return goodIcon(spec.output, size);
  }
  return iconEl('icon-coin', size);
};

/** A short economics label for a build-grid card. */
const buildSub = (spec: BuildingSpec): string => {
  if (spec.role === 'decor') return '+10% / tier';
  if (spec.role === 'raw' && spec.good) {
    return `${GOOD_LABEL[spec.good]} ${spec.ratePerMin}/min`;
  }
  if (spec.role === 'processor' && spec.input && spec.output) {
    if (spec.output === 'coins') {
      return `${spec.input.per} ${GOOD_LABEL[spec.input.good]} → ${spec.coinsPerFlour ?? 0} coins`;
    }
    return `${spec.input.per} ${GOOD_LABEL[spec.input.good]} → 1 ${GOOD_LABEL[spec.output]}`;
  }
  return `${spec.ratePerMin}/min coins`;
};

const coinCost = (cost: number, broke: boolean): HTMLElement =>
  el('div', {
    cls: `hv-card-cost${broke ? ' is-broke' : ''}`,
    children: [iconEl('icon-coin', 12), el('span', { text: fmtInt(cost) })],
  });

// ── Tile sheet ───────────────────────────────────────────────────────────────

export const openTileSheet = (detail: HvTileSelected): void => {
  const { x, y, key } = detail;
  openSheet({
    title: 'Plot',
    tick: 1000,
    render: (body) => {
      const data = store.data;
      if (!data) return;
      const me = data.me;
      const tile = data.grid[key] ?? null;
      const mine = tile !== null && me !== null && tile.owner === me.id;
      const claimable = isClaimable(x, y) && tile === null;

      if (claimable) {
        if (me) renderClaim(body, data, me, x, y, key);
        else renderSignIn(body);
        return;
      }
      if (tile !== null && mine && me) {
        if (tile.buildingId === undefined) renderBuildGrid(body, me, x, y, key);
        else renderMineBuilding(body, data, me, tile, x, y, key);
        return;
      }
      if (tile !== null) {
        if (tile.buildingId !== undefined) renderNeighbour(body, me, tile, x, y);
        else renderOwnerFlavor(body, tile);
        return;
      }
      renderPlaza(body);
    },
  });
};

// ── Variant (a): claimable, logged in ────────────────────────────────────────

const renderClaim = (
  body: HTMLElement,
  data: StateResponse,
  me: PlayerState,
  x: number,
  y: number,
  key: string
): void => {
  setSheetTitle('Open plot');
  const owned = ownedCount(data, me.id);
  const max = plotsForLevel(me.level);
  const reason = canClaim(data.grid, x, y, me, owned);

  const stack = el('div', { cls: 'hv-stack' });
  stack.appendChild(el('p', { cls: 'hv-note', text: 'A patch of open grass, waiting for a home.' }));
  stack.appendChild(line('Plots used', `${owned} / ${max}`));

  const btn = el('button', {
    cls: 'hv-btn',
    text: 'Settle here',
    attrs: { type: 'button' },
  });
  if (reason !== null || isPending('claim')) btn.disabled = true;
  btn.addEventListener('click', () => {
    void action('claim', async () => {
      const res = await api.claim(x, y);
      store.applyMutation({ key, tile: res.tile, me: res.me });
      toast('Settled a new plot!', 'celebrate');
    });
  });
  stack.appendChild(btn);
  if (reason !== null) stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: reason }));
  body.appendChild(stack);
};

// ── Variant (b): claimable, logged out ───────────────────────────────────────

const renderSignIn = (body: HTMLElement): void => {
  setSheetTitle('Open plot');
  const stack = el('div', { cls: 'hv-stack' });
  stack.appendChild(el('p', { cls: 'hv-note', text: 'Sign in with your Reddit account to settle here and start your village.' }));
  const btn = el('button', {
    cls: 'hv-btn',
    text: 'Sign in to play',
    attrs: { type: 'button' },
    on: { click: () => promptLogin() },
  });
  stack.appendChild(btn);
  body.appendChild(stack);
};

// ── Variant (c): mine, empty → build grid ────────────────────────────────────

const renderBuildGrid = (
  body: HTMLElement,
  me: PlayerState,
  x: number,
  y: number,
  key: string
): void => {
  setSheetTitle('Build here');
  const cards = el('div', { cls: 'hv-cards' });

  for (const spec of Object.values(CATALOG)) {
    const locked = me.level < spec.unlockLevel;
    const broke = me.coins < spec.cost;

    const img = iconEl(buildingIconKey(spec.id), 40);

    const card = el('button', {
      cls: `hv-card${locked ? ' is-locked' : ''}`,
      attrs: { type: 'button' },
      children: [
        img,
        el('div', { cls: 'hv-card-name', text: spec.name }),
        el('div', { cls: 'hv-card-sub', text: buildSub(spec) }),
        coinCost(spec.cost, broke),
        locked
          ? el('div', { cls: 'hv-lock', text: `Lv ${spec.unlockLevel}` })
          : el('div', { cls: 'hv-card-sub', text: fmtBuildTime(spec.buildSeconds) }),
      ],
    });

    if (locked || isPending(`build:${spec.id}`)) card.disabled = true;
    if (!locked) {
      card.addEventListener('click', () => {
        void action(`build:${spec.id}`, async () => {
          const res = await api.build(x, y, spec.id);
          store.applyMutation({ key, tile: res.tile, me: res.me });
          toast(`Built ${spec.name}!`, 'gain');
        });
      });
    }
    cards.appendChild(card);
  }
  body.appendChild(cards);
};

// ── Variant (d): mine, building ──────────────────────────────────────────────

const renderMineBuilding = (
  body: HTMLElement,
  data: StateResponse,
  me: PlayerState,
  tile: TileState,
  x: number,
  y: number,
  key: string
): void => {
  const bid = tile.buildingId;
  if (bid === undefined) return;
  const spec = CATALOG[bid];
  const now = store.serverNow();
  setSheetTitle(spec.name);

  const stack = el('div', { cls: 'hv-stack' });
  stack.appendChild(
    el('div', {
      cls: 'hv-row-line',
      children: [
        el('span', { text: spec.name }),
        el('span', { cls: 'hv-stars', text: stars(tile.tier) }),
      ],
    })
  );

  // Construction countdown.
  if (now < tile.readyAt) {
    stack.appendChild(line('Building…', fmtDur(tile.readyAt - now)));
    const span = Math.max(1, tile.readyAt - tile.builtAt);
    const frac = (now - tile.builtAt) / span;
    stack.appendChild(
      el('div', { cls: 'hv-fill hv-fill-glow', children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })] })
    );
    body.appendChild(stack);
    return;
  }

  const statsT = tierStats(spec, tile.tier);

  if (spec.role === 'decor') {
    stack.appendChild(el('p', { cls: 'hv-note', text: `Boosts each neighbouring producer by +${10 * tile.tier}%.` }));
  } else {
    renderProducerStats(stack, data, spec, statsT, tile, x, y, now, key);
  }

  if (tile.boostUntil > now) {
    stack.appendChild(
      el('div', { cls: 'hv-row-line', children: [el('span', { text: 'Boosted ×2' }), el('b', { text: `${fmtDur(tile.boostUntil - now)} left` })] })
    );
  }

  renderUpgrade(stack, me, spec, tile, x, y, key);
  body.appendChild(stack);
};

/** Weather line for a producer, or null when today's weather doesn't apply. */
const weatherLine = (weather: Weather, spec: BuildingSpec): string | null => {
  if (weather === 'sunny') return 'Sunny +10%';
  if (weather === 'harvestmoon') return 'Harvest Moon +50%';
  if (weather === 'rain') {
    return spec.good === 'wheat' || spec.good === 'logs' ? 'Rain +30%' : null;
  }
  return null;
};

const chainPartnerOf = (a: string, b: string): boolean =>
  CHAIN_PAIRS.some(([p, q]) => (a === p && b === q) || (a === q && b === p));

/** Name of an adjacent, completed chain-partner building, if any. */
const chainHint = (
  grid: Record<string, TileState>,
  x: number,
  y: number,
  selfId: string,
  now: number
): string | null => {
  for (const n of neighbors(x, y)) {
    const t = grid[tileKey(n.x, n.y)];
    if (t?.buildingId && t.readyAt <= now && chainPartnerOf(selfId, t.buildingId)) {
      return `Next to ${CATALOG[t.buildingId].name} (+25%)`;
    }
  }
  return null;
};

const riverAdjacent = (x: number, y: number): boolean =>
  neighbors(x, y).some((n) => isRiver(n.x, n.y));

const renderProducerStats = (
  stack: HTMLElement,
  data: StateResponse,
  spec: BuildingSpec,
  statsT: TierStats,
  tile: TileState,
  x: number,
  y: number,
  now: number,
  key: string
): void => {
  const fest = data.city.festival;
  const adj = adjacencyBonus(data.grid, x, y, fest, now);
  const festing = fest === roleToFestival(spec.role);
  const effRate = statsT.ratePerMin * (festing ? 1.5 : 1) * (1 + adj);

  stack.appendChild(
    el('div', {
      cls: 'hv-row-line',
      children: [
        el('span', { text: 'Output' }),
        el('b', {
          cls: 'hv-chain',
          children: [el('span', { text: `${effRate.toFixed(1)}/min` }), outputIcon(spec, 16)],
        }),
      ],
    })
  );
  stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: `Base ${statsT.ratePerMin.toFixed(1)}/min` }));
  if (festing) stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: '×1.5 festival bonus today' }));

  const wl = weatherLine(data.weather, spec);
  if (wl) stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: wl }));

  const selfId = spec.id;
  const ch = chainHint(data.grid, x, y, selfId, now);
  if (ch) stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: ch }));
  if (spec.role === 'raw' && riverAdjacent(x, y)) {
    stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: 'River-side (+50%)' }));
  }
  if (adj > 0) {
    stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: `Placement bonus +${Math.round(adj * 100)}%` }));
  }
  if (data.city.landmarkStage > 0) {
    stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: `Grand Keep +${3 * data.city.landmarkStage}%` }));
  }

  // Processor starvation: no input in the village stockpile.
  if (spec.role === 'processor' && spec.input && data.stockpile[spec.input.good] < spec.input.per) {
    const input = spec.input.good;
    const warn = el('div', {
      cls: 'hv-warn',
      children: [
        goodIcon(input, 18),
        el('span', { text: `The stockpile has no ${GOOD_LABEL[input]} — sell some or build fields.` }),
      ],
    });
    stack.appendChild(warn);
    const openMkt = el('button', {
      cls: 'hv-btn hv-btn-ghost',
      text: 'Open market',
      attrs: { type: 'button' },
      on: { click: () => openMarketSheet(input) },
    });
    stack.appendChild(openMkt);
  }

  const { gained } = accrue(tile, now, fest, adj, data.weather, data.stockpile);
  const accrued = gained.coins + goodsTotal(gained.goods);
  const frac = statsT.cap > 0 ? accrued / statsT.cap : 0;
  stack.appendChild(
    el('div', { cls: 'hv-fill', children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })] })
  );
  stack.appendChild(el('div', { cls: 'hv-fill-cap', text: `Storage ${fmtInt(accrued)} / ${fmtInt(statsT.cap)}` }));

  const collect = el('button', {
    cls: 'hv-btn',
    attrs: { type: 'button' },
    children: [el('span', { text: `Collect ${fmtInt(accrued)}` }), outputIcon(spec, 16)],
  });
  if (accrued <= 0 || isPending('collect')) collect.disabled = true;
  collect.addEventListener('click', () => {
    void action('collect', async () => {
      const res = await api.collect(x, y);
      store.applyMutation({ key, tile: res.tile, me: res.me });
      const got = res.gained.coins + goodsTotal(res.gained.goods);
      toast(`+${fmtInt(got)}`, 'gain');
    });
  });
  stack.appendChild(collect);
};

const renderUpgrade = (
  stack: HTMLElement,
  me: PlayerState,
  spec: BuildingSpec,
  tile: TileState,
  x: number,
  y: number,
  key: string
): void => {
  if (tile.tier >= 3) {
    stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: `Max tier ${stars(3)}` }));
    return;
  }
  const nextTier: Tier = tile.tier === 1 ? 2 : 3;
  const cost = tierStats(spec, nextTier).cost;
  const affordable = me.coins >= cost;

  const btn = el('button', {
    cls: 'hv-btn hv-btn-ghost',
    attrs: { type: 'button' },
    children: [
      el('span', { text: `Upgrade to ${stars(nextTier)} —` }),
      iconEl('icon-coin', 14),
      el('span', { text: fmtInt(cost) }),
    ],
  });
  if (!affordable || isPending('upgrade')) btn.disabled = true;
  btn.addEventListener('click', () => {
    void action('upgrade', async () => {
      const res = await api.upgrade(x, y);
      store.applyMutation({ key, tile: res.tile, me: res.me });
      toast(`Upgraded to tier ${nextTier}!`, 'celebrate');
    });
  });
  stack.appendChild(btn);
  if (!affordable) stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: `Need ${fmtInt(cost)} coins to upgrade.` }));
};

// ── Variant (e): neighbour's producer → boost ────────────────────────────────

const renderNeighbour = (
  body: HTMLElement,
  me: PlayerState | null,
  tile: TileState,
  x: number,
  y: number
): void => {
  const bid = tile.buildingId;
  if (bid === undefined) return;
  const spec = CATALOG[bid];
  const now = store.serverNow();
  setSheetTitle(`${tile.ownerName}’s plot`);

  const stack = el('div', { cls: 'hv-stack' });
  stack.appendChild(line('Neighbour', tile.ownerName));
  stack.appendChild(
    el('div', {
      cls: 'hv-row-line',
      children: [el('span', { text: spec.name }), el('span', { cls: 'hv-stars', text: stars(tile.tier) })],
    })
  );

  let reason: string | null = null;
  if (spec.role === 'decor') reason = 'Decorations can’t be boosted.';
  else if (now < tile.readyAt) reason = 'Still under construction.';
  else if (tile.boostUntil > now) reason = `Already boosted — ${fmtDur(tile.boostUntil - now)} left.`;
  else if (me !== null && boostsLeft(me) <= 0) reason = 'No boosts left today.';

  const btn = el('button', {
    cls: 'hv-btn hv-btn-accent',
    text: me ? 'Boost ×2 for 30m' : 'Sign in to boost',
    attrs: { type: 'button' },
  });
  if ((me !== null && reason !== null) || isPending('boost')) btn.disabled = true;
  btn.addEventListener('click', () => {
    if (!me) {
      promptLogin();
      return;
    }
    void action('boost', async () => {
      const res = await api.boost(x, y);
      store.applyMutation({ key: `${x},${y}`, tile: res.tile, me: res.me });
      toast(`Boosted ${tile.ownerName}’s ${spec.name}!`, 'gain');
    });
  });
  stack.appendChild(btn);

  if (me) stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: `${boostsLeft(me)} boosts left today.` }));
  if (me !== null && reason !== null) stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: reason }));
  body.appendChild(stack);
};

// ── Variant: neighbour's empty plot ──────────────────────────────────────────

const renderOwnerFlavor = (body: HTMLElement, tile: TileState): void => {
  setSheetTitle(`${tile.ownerName}’s plot`);
  body.appendChild(
    el('p', { cls: 'hv-note', text: `${tile.ownerName} claimed this plot but hasn’t built here yet.` })
  );
};

// ── Variant (f): plaza ───────────────────────────────────────────────────────

const renderPlaza = (body: HTMLElement): void => {
  setSheetTitle('Village square');
  body.appendChild(
    el('p', {
      cls: 'hv-note',
      text: 'The village square — a shared gathering place at the heart of Hearthvale. The Grand Keep rises here; plots can’t be claimed on the plaza.',
    })
  );
};

// ── Menu sheet ───────────────────────────────────────────────────────────────

type MenuItem = {
  icon: SpriteKey;
  label: string;
  open: () => void;
  badge?: () => boolean;
};

const MENU: MenuItem[] = [
  { icon: 'icon-cart', label: 'Market', open: () => openMarketSheet() },
  {
    icon: 'icon-scroll',
    label: 'Wandering Trader',
    open: openTraderSheet,
    badge: () => store.data?.trader.done === false,
  },
  { icon: 'castle-tower', label: 'Grand Keep', open: openKeepSheet },
  { icon: 'icon-star', label: 'Festival ballot', open: openBallotSheet },
  { icon: 'icon-trophy', label: 'Leaderboards', open: openLeaderboardsSheet },
  { icon: 'icon-question', label: 'How to play', open: openHowToSheet },
];

export const openMenuSheet = (): void => {
  openSheet({
    title: 'Menu',
    render: (body) => {
      const data = store.data;
      const stack = el('div', { cls: 'hv-stack' });

      // Expansion status line.
      if (data) {
        const { population, nextThreshold } = data.ring;
        const text =
          nextThreshold === null
            ? `Village: ${fmtInt(population)} villagers · fully settled`
            : `Village: ${fmtInt(population)} villagers · next land at ${fmtInt(nextThreshold)}`;
        stack.appendChild(el('p', { cls: 'hv-note', text }));
      }

      const menu = el('div', { cls: 'hv-menu' });
      for (const item of MENU) {
        const iconSlot = el('span', { cls: 'hv-menu-emoji', children: [iconEl(item.icon, 22)] });
        if (item.badge?.()) iconSlot.appendChild(el('span', { cls: 'hv-badge-dot' }));
        const btn = el('button', {
          cls: 'hv-menu-btn',
          attrs: { type: 'button' },
          children: [
            iconSlot,
            el('span', { text: item.label }),
            el('span', { cls: 'hv-menu-arrow', text: '›' }),
          ],
        });
        btn.addEventListener('click', () => item.open());
        menu.appendChild(btn);
      }
      stack.appendChild(menu);
      body.appendChild(stack);
    },
  });
};
