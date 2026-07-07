import type { StateResponse } from '../../shared/types';
import { goodsTotal } from '../../shared/logic/economy';
import { store } from '../state';
import { clearNode, el, ownedTiles } from './dom';

/**
 * First-run coach-mark tutorial (Task wave2 D5).
 *
 * A compact card anchored bottom-centre above the FAB rail whose single step is
 * *derived from store state* — it never stores "which step" itself. Each store
 * mutation (claim, build, collect, sell) shifts the derived step forward, so the
 * card advances on its own as the player acts. Completion is remembered in
 * sessionStorage AND auto-derived: a returning player who already has a building
 * and lifetime earnings (i.e. lands past the early steps) is treated as done and
 * never sees the card pop up.
 *
 * State machine (evaluated top-down; first match wins):
 *   1 owns 0 tiles ............................. "claim a plot"      → owns ≥1 tile
 *   2 owns a tile, no building ................. "build a field"     → any owned tile built
 *   3 has a building, never collected .......... "collect over time" → lifetimeEarned>0 || goods>0
 *   4 holds goods, hasn't sold this session .... "sell at market"    → a sell (markTutorialSell) / skip
 *   5 otherwise ................................ "raise the Keep"     → Done
 */

const DONE_KEY = 'hv-tutorial-done';
const TOTAL = 5;

const STEP_COPY: Record<number, { title: string; body: string; market: boolean }> = {
  1: {
    title: 'Welcome to Hearthvale',
    body: 'This whole village is shared — everyone in the subreddit builds it together. Tap any open grass tile to claim your first plot.',
    market: false,
  },
  2: {
    title: 'Plant your first field',
    body: "Build a Wheat Field first — grain is the village's lifeblood, and it pays. You'll unlock a second plot at level 2, and demolish is always an option too.",
    market: false,
  },
  3: {
    title: 'Collect over time',
    body: 'Buildings produce over real time — even while you are away. Tap your building when it glows to collect.',
    market: false,
  },
  4: {
    title: 'Sell at the Market',
    body: 'Sell goods at the Market — prices rise when the village runs short. Processors like the Windmill buy from the stockpile.',
    market: true,
  },
  5: {
    title: 'Raise the Grand Keep',
    body: "Together, build the Grand Keep — contribute planks and bricks, earn the stage pot, and vote on tomorrow's festival. Check in daily to keep your streak.",
    market: false,
  },
};

let card: HTMLElement | undefined;
let hudRoot: HTMLElement | undefined;
let marketFab: HTMLElement | undefined;
let everShown = false;
let sold = false;

const isDismissed = (): boolean => {
  try {
    return sessionStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
};

const dismiss = (): void => {
  try {
    sessionStorage.setItem(DONE_KEY, '1');
  } catch {
    // Private-mode storage failures are non-fatal — the card just re-derives.
  }
};

/** The step to show for the current snapshot, or null when the card should hide. */
const deriveStep = (data: StateResponse): number | null => {
  const me = data.me;
  if (!me) return null; // logged-out players see the sign-in pill instead
  const owned = ownedTiles(data, me.id);
  if (owned.length === 0) return 1;
  const hasBuilding = owned.some(({ tile }) => tile.buildingId !== undefined);
  if (!hasBuilding) return 2;
  const goods = goodsTotal(me.wallet);
  const collected = me.lifetimeEarned > 0 || goods > 0;
  if (!collected) return 3;
  if (goods > 0 && !sold) return 4;
  return 5;
};

const hide = (): void => {
  if (card) {
    card.classList.remove('is-in');
    clearNode(card);
  }
  hudRoot?.classList.remove('hv-has-tutorial');
  marketFab?.classList.remove('is-tut-highlight');
};

const close = (): void => {
  dismiss();
  hide();
};

const paint = (step: number): void => {
  if (!card) return;
  const copy = STEP_COPY[step];
  if (!copy) return;
  clearNode(card);

  const skip = el('button', {
    cls: 'hv-tut-skip',
    text: 'Skip',
    attrs: { type: 'button' },
    on: { click: () => close() },
  });
  card.appendChild(
    el('div', {
      cls: 'hv-tut-head',
      children: [el('div', { cls: 'hv-tut-title', text: copy.title }), skip],
    })
  );
  card.appendChild(el('div', { cls: 'hv-tut-body', text: copy.body }));

  const dots = el('div', { cls: 'hv-tut-dots' });
  for (let i = 1; i <= TOTAL; i += 1) {
    const state = i < step ? ' is-done' : i === step ? ' is-on' : '';
    dots.appendChild(el('span', { cls: `hv-tut-dot${state}` }));
  }
  const foot = el('div', { cls: 'hv-tut-foot', children: [dots] });
  if (step === TOTAL) {
    foot.appendChild(
      el('button', {
        cls: 'hv-tut-done',
        text: 'Done',
        attrs: { type: 'button' },
        on: { click: () => close() },
      })
    );
  }
  card.appendChild(foot);

  void card.offsetWidth; // force reflow so the enter transition runs
  card.classList.add('is-in');
  hudRoot?.classList.add('hv-has-tutorial');
  marketFab?.classList.toggle('is-tut-highlight', copy.market);
};

const render = (): void => {
  const data = store.data;
  if (!card || !data) return;
  if (isDismissed()) {
    hide();
    return;
  }
  const step = deriveStep(data);
  if (step === null) {
    hide();
    return;
  }
  // A returning, experienced player — building raised AND lifetime coin earnings,
  // landing past the early steps — who never opened the flow this session is
  // treated as done (no popup). A genuinely new player mid-flow has everShown set.
  if (!everShown && step >= 4 && (data.me?.lifetimeEarned ?? 0) > 0) {
    dismiss();
    hide();
    return;
  }
  everShown = true;
  paint(step);
};

/** Called by the Market sheet when a sell succeeds — advances step 4 → 5. */
export const markTutorialSell = (): void => {
  sold = true;
  render();
};

/** Build the tutorial card, wire it to the store, and start deriving steps. */
export const mountTutorial = (
  parent: HTMLElement,
  opts: { marketFab: HTMLElement }
): void => {
  hudRoot = parent;
  marketFab = opts.marketFab;
  card = el('div', { cls: 'hv-tut' });
  parent.appendChild(card);
  store.on('change', render);
  render();
};
