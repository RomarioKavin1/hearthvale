import type { BuildingSpec, TierStats } from '../../shared/catalog';
import {
  CATALOG,
  DEMOLISH_REFUND,
  PAINT_COST,
  investedCost,
  isStackedBuilding,
  tierStats,
  villageDisplayName,
} from '../../shared/catalog';
import { PAL } from '../../shared/palette';
import type {
  PlayerState,
  RoofColor,
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
  plotsAllowed,
  roleToFestival,
} from '../../shared/logic/economy';
import { isRiver } from '../../shared/logic/expansion';
import { priceFor } from '../../shared/logic/market';
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
      const claimable = isClaimable(x, y) && tile === null && !isRiver(x, y);

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
  const max = plotsAllowed(me.level, data.city.hallLevel);
  const reason = canClaim(data.grid, x, y, me, owned, data.city.hallLevel);

  const stack = el('div', { cls: 'hv-stack' });
  stack.appendChild(el('p', { cls: 'hv-note', text: 'A patch of open grass, waiting for a home.' }));
  stack.appendChild(
    el('div', {
      cls: 'hv-callout hv-plots',
      children: [
        iconEl('icon-home', 22),
        el('span', {
          cls: 'hv-plots-count',
          children: [
            el('b', { text: `${owned} / ${max}` }),
            el('span', { cls: 'hv-plots-label', text: 'plots settled' }),
          ],
        }),
      ],
    })
  );

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
    // The house is placed free on the first claim — never sold in the grid.
    if (spec.special === 'house') continue;
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
    // Demolish is available mid-build too (refund is 50% of the invested cost).
    renderDemolish(stack, spec, tile, x, y, key);
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
  renderPaint(stack, me, tile, x, y, key);
  renderDemolish(stack, spec, tile, x, y, key);
  body.appendChild(stack);
};

// ── Paintable roofs (stacked buildings only) ─────────────────────────────────

/** The four paintable roof colours and their CSS swatch colours (from PAL). */
const ROOF_SWATCHES: ReadonlyArray<{ color: RoofColor; label: string; css: string }> = [
  { color: 'brown', label: 'Brown', css: PAL.roofBrown },
  { color: 'green', label: 'Green', css: PAL.roofGreen },
  { color: 'purple', label: 'Purple', css: PAL.roofPurple },
  { color: 'beige', label: 'Beige', css: PAL.roofBeige },
];

/**
 * A "Paint roof — 25 coins" row of four colour swatches, shown only for stacked
 * buildings (flat crops/decor have no roof). The current colour is highlighted;
 * tapping a swatch spends PAINT_COST and repaints. Pending-guarded; errors toast.
 */
const renderPaint = (
  stack: HTMLElement,
  me: PlayerState,
  tile: TileState,
  x: number,
  y: number,
  key: string
): void => {
  const bid = tile.buildingId;
  if (bid === undefined || !isStackedBuilding(bid)) return;

  const affordable = me.coins >= PAINT_COST;
  stack.appendChild(
    el('div', {
      cls: 'hv-row-line',
      children: [
        el('span', { text: 'Paint roof' }),
        el('b', {
          cls: 'hv-chain',
          children: [iconEl('icon-coin', 14), el('span', { text: fmtInt(PAINT_COST) })],
        }),
      ],
    })
  );

  const row = el('div', { cls: 'hv-swatches' });
  for (const sw of ROOF_SWATCHES) {
    const selected = tile.roofColor === sw.color;
    const btn = el('button', {
      cls: `hv-swatch${selected ? ' is-selected' : ''}`,
      attrs: {
        type: 'button',
        title: sw.label,
        'aria-label': `Paint roof ${sw.label}`,
        style: `background:${sw.css}`,
      },
    });
    if (selected || !affordable || isPending('paint')) btn.disabled = true;
    btn.addEventListener('click', () => {
      void action('paint', async () => {
        const res = await api.paint(x, y, sw.color);
        store.applyMutation({ key, tile: res.tile, me: res.me });
        toast(`Roof painted ${sw.label.toLowerCase()}`, 'gain');
      });
    });
    row.appendChild(btn);
  }
  stack.appendChild(row);
  if (!affordable) {
    stack.appendChild(
      el('p', { cls: 'hv-note hv-muted', text: `Need ${fmtInt(PAINT_COST)} coins to paint.` })
    );
  }
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
  if (data.city.hallLevel > 0) {
    stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: `Village Hall +${3 * data.city.hallLevel}%` }));
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

  const { gained, consumed } = accrue(tile, now, fest, adj, data.weather, data.stockpile);
  const accrued = gained.coins + goodsTotal(gained.goods);
  const frac = statsT.cap > 0 ? accrued / statsT.cap : 0;
  stack.appendChild(
    el('div', { cls: 'hv-fill', children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })] })
  );
  stack.appendChild(el('div', { cls: 'hv-fill-cap', text: `Storage ${fmtInt(accrued)} / ${fmtInt(statsT.cap)}` }));

  // Collecting a processor silently spends stockpile inputs from the owner's
  // coin balance — preview that cost so it isn't a surprise. Uses the same
  // `consumed` the accrual above already computed; the server remains the
  // authority on the exact charge (this is only an estimate, hence '≈').
  if (spec.role === 'processor' && spec.input) {
    const inputGood = spec.input.good;
    const units = consumed[inputGood] ?? 0;
    if (units > 0) {
      const price = priceFor(data.stockpile[inputGood], inputGood);
      const cost = price * units;
      if (spec.output === 'coins') {
        const net = Math.max(0, gained.coins - cost);
        stack.appendChild(
          el('div', {
            cls: 'hv-note hv-muted',
            text: `≈${fmtInt(net)} coins after buying ${GOOD_LABEL[inputGood]}`,
          })
        );
      } else {
        stack.appendChild(
          el('div', {
            cls: 'hv-note hv-muted',
            text: `Inputs: ~${fmtInt(units)} ${GOOD_LABEL[inputGood]} (≈${fmtInt(cost)} coins from your balance)`,
          })
        );
      }
    }
  }

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

// A single-arm confirm for demolish: the first tap on a tile's Demolish button
// arms it for 3s; a second tap within the window commits. Kept at module scope
// so it survives the tile sheet's 1s re-render tick.
let demolishArmed: { key: string; until: number } | null = null;

const renderDemolish = (
  stack: HTMLElement,
  spec: BuildingSpec,
  tile: TileState,
  x: number,
  y: number,
  key: string
): void => {
  const refund = Math.floor(DEMOLISH_REFUND * investedCost(spec, tile.tier));
  const armedLabel = `Tap again to confirm — refund ${fmtInt(refund)} coins`;
  const isArmed = (): boolean =>
    demolishArmed?.key === key && demolishArmed.until > Date.now();

  const btn = el('button', {
    cls: 'hv-btn hv-btn-ghost hv-btn-danger',
    attrs: { type: 'button' },
  });
  btn.textContent = isArmed() ? armedLabel : 'Demolish';
  if (isArmed()) btn.classList.add('is-armed');

  btn.addEventListener('click', () => {
    if (isPending('demolish')) return;
    if (!isArmed()) {
      demolishArmed = { key, until: Date.now() + 3000 };
      btn.textContent = armedLabel;
      btn.classList.add('is-armed');
      window.setTimeout(() => {
        if (demolishArmed?.key === key) demolishArmed = null;
        btn.textContent = 'Demolish';
        btn.classList.remove('is-armed');
      }, 3000);
      return;
    }
    demolishArmed = null;
    void action('demolish', async () => {
      const res = await api.demolish(x, y);
      store.applyMutation({ key, tile: res.tile, me: res.me });
      toast(`+${fmtInt(refund)} coins refunded`, 'gain');
    });
  });
  stack.appendChild(btn);
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
    title: villageDisplayName(store.data?.city.villageName ?? ''),
    render: (body) => {
      const data = store.data;
      const stack = el('div', { cls: 'hv-stack' });

      // Expansion status line.
      if (data) {
        const { population, nextThreshold } = data.ring;
        // Land now opens when the Village Hall levels up (which needs both
        // resources and this villager threshold), not by raw population alone.
        const text =
          nextThreshold === null
            ? `Village: ${fmtInt(population)} villagers · fully settled`
            : `Village: ${fmtInt(population)} villagers · ${fmtInt(nextThreshold)} needed for the next Hall level`;
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
