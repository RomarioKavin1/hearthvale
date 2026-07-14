import { HV_CLEAR_SELECTION } from '../events';
import { store } from '../state';
import {
  clearNode,
  clearPending,
  closePopover,
  el,
  hideTip,
  iconEl,
  isPending,
  markPending,
  notifyError,
  toast,
} from './dom';

/**
 * The single modal host. One modal is open at a time; opening another swaps its
 * content in place. A spec supplies a `render(body)` callback that is re-run on
 * every `store` change (and optionally on a timer) so countdowns and live figures
 * stay fresh. Closing tears down those subscriptions and clears the map's tile
 * selection.
 *
 * Presentation (W3): a centred card over a dark, blurred backdrop — scale+fade in,
 * closes on backdrop tap / the ✕ button / Escape. The public API (`openSheet`,
 * `closeSheet`, `refreshSheet`, `setSheetTitle`, `action`) is unchanged so the
 * panels/sheets code is untouched by the slide-up→modal swap.
 */

export type SheetSpec = {
  title: string;
  /** Populate `body`; called on open, on each store change and on each tick. */
  render: (body: HTMLElement) => void;
  /** Optional re-render cadence in ms (for countdowns/storage bars). */
  tick?: number;
  /** Extra cleanup when this sheet closes. */
  onClose?: () => void;
};

let backdrop: HTMLElement | undefined;
let card: HTMLElement | undefined;
let titleEl: HTMLElement | undefined;
let bodyEl: HTMLElement | undefined;

let current: SheetSpec | undefined;
let onStoreChange: (() => void) | undefined;
let tickTimer: number | undefined;

const rerender = (): void => {
  if (!current || !bodyEl) return;
  // Any visible tooltip is anchored to a node about to be destroyed — hide it
  // first, or it would float with stale text (pointerleave never fires).
  hideTip();
  clearNode(bodyEl);
  current.render(bodyEl);
};

/** Re-run the active sheet's render (used after a pending-state change). */
export const refreshSheet = (): void => rerender();

/** Update the open sheet's header (variants change the contextual title). */
export const setSheetTitle = (text: string): void => {
  if (titleEl) titleEl.textContent = text;
};

export const isSheetOpen = (): boolean => current !== undefined;

const teardown = (): void => {
  // The sheet's content (and any tooltip anchored inside it) is going away —
  // dismiss the shared bubble so it can't linger over the map.
  hideTip();
  if (onStoreChange) {
    store.off('change', onStoreChange);
    onStoreChange = undefined;
  }
  if (tickTimer !== undefined) {
    window.clearInterval(tickTimer);
    tickTimer = undefined;
  }
  const prev = current;
  current = undefined;
  prev?.onClose?.();
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') closeSheet();
};

export const mountSheetRoot = (parent: HTMLElement): void => {
  titleEl = el('h2', { cls: 'hv-modal-title' });
  const close = el('button', {
    cls: 'hv-modal-close',
    attrs: { type: 'button', 'aria-label': 'Close' },
    children: [iconEl('icon-cross', 14)],
    on: { click: () => closeSheet() },
  });
  const head = el('div', { cls: 'hv-modal-head', children: [titleEl, close] });

  bodyEl = el('div', { cls: 'hv-modal-body' });
  card = el('div', {
    cls: 'hv-modal',
    attrs: { role: 'dialog', 'aria-modal': 'true' },
    children: [head, bodyEl],
  });

  // The backdrop is the flex host that centres the card; a tap on the backdrop
  // itself (not its child card) closes.
  backdrop = el('div', { cls: 'hv-backdrop', children: [card] });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSheet();
  });

  parent.appendChild(backdrop);
};

export const openSheet = (spec: SheetSpec): void => {
  if (!card || !backdrop || !titleEl || !bodyEl) return;
  // A modal sheet and the tile popover are mutually exclusive — close any open
  // popover silently (the scene keeps whatever selection this sheet is for).
  closePopover(true);
  // Swap out any previous sheet's subscriptions without firing a close event.
  const wasOpen = current !== undefined;
  teardown();

  current = spec;
  titleEl.textContent = spec.title;
  rerender();
  bodyEl.scrollTop = 0;

  onStoreChange = () => rerender();
  store.on('change', onStoreChange);
  if (spec.tick !== undefined) {
    tickTimer = window.setInterval(rerender, spec.tick);
  }

  backdrop.classList.add('is-open');
  if (!wasOpen) document.addEventListener('keydown', onKeydown);
};

export const closeSheet = (): void => {
  if (!card || !backdrop) return;
  const wasOpen = current !== undefined;
  teardown();
  backdrop.classList.remove('is-open');
  document.removeEventListener('keydown', onKeydown);
  if (wasOpen) {
    window.dispatchEvent(new CustomEvent(HV_CLEAR_SELECTION));
  }
};

// ── Shared async-action helper (disabled-while-pending + error toast) ─────────

/**
 * Run a guarded async action: no-op while its `key` is already in flight,
 * disables the matching control across re-renders, funnels any error to a toast.
 */
export const action = async (
  key: string,
  fn: () => Promise<void>
): Promise<void> => {
  if (isPending(key)) return;
  markPending(key);
  refreshSheet();
  try {
    await fn();
  } catch (err) {
    notifyError(err instanceof Error ? err.message : 'Something went wrong.');
  } finally {
    clearPending(key);
    refreshSheet();
  }
};

export { toast };
