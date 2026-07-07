import { HV_CLEAR_SELECTION } from '../events';
import { store } from '../state';
import {
  clearNode,
  clearPending,
  el,
  isPending,
  markPending,
  notifyError,
  toast,
} from './dom';

/**
 * The single bottom-sheet host. One sheet is open at a time; opening another
 * swaps its content in place. A sheet supplies a `render(body)` callback that is
 * re-run on every `store` change (and optionally on a timer) so countdowns and
 * live figures stay fresh. Closing tears down those subscriptions and clears the
 * map's tile selection.
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
let sheet: HTMLElement | undefined;
let titleEl: HTMLElement | undefined;
let bodyEl: HTMLElement | undefined;

let current: SheetSpec | undefined;
let onStoreChange: (() => void) | undefined;
let tickTimer: number | undefined;

// Drag-to-close bookkeeping.
let dragStartY = 0;
let dragOffset = 0;
let dragging = false;

const rerender = (): void => {
  if (!current || !bodyEl) return;
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

export const mountSheetRoot = (parent: HTMLElement): void => {
  backdrop = el('div', {
    cls: 'hv-backdrop',
    on: { click: () => closeSheet() },
  });

  const handle = el('div', {
    cls: 'hv-sheet-handle',
    children: [el('span')],
  });
  handle.addEventListener('pointerdown', onDragStart);

  titleEl = el('h2', { cls: 'hv-sheet-title' });
  const close = el('button', {
    cls: 'hv-sheet-close',
    text: '✕',
    attrs: { type: 'button', 'aria-label': 'Close' },
    on: { click: () => closeSheet() },
  });
  const head = el('div', { cls: 'hv-sheet-head', children: [titleEl, close] });

  bodyEl = el('div', { cls: 'hv-sheet-body' });
  sheet = el('div', {
    cls: 'hv-sheet',
    attrs: { role: 'dialog', 'aria-modal': 'true' },
    children: [handle, head, bodyEl],
  });

  parent.appendChild(backdrop);
  parent.appendChild(sheet);
};

export const openSheet = (spec: SheetSpec): void => {
  if (!sheet || !backdrop || !titleEl || !bodyEl) return;
  // Swap out any previous sheet's subscriptions without firing a close event.
  teardown();

  current = spec;
  titleEl.textContent = spec.title;
  rerender();

  onStoreChange = () => rerender();
  store.on('change', onStoreChange);
  if (spec.tick !== undefined) {
    tickTimer = window.setInterval(rerender, spec.tick);
  }

  sheet.style.transform = '';
  sheet.classList.remove('is-dragging');
  backdrop.classList.add('is-open');
  sheet.classList.add('is-open');
};

export const closeSheet = (): void => {
  if (!sheet || !backdrop) return;
  const wasOpen = current !== undefined;
  teardown();
  sheet.classList.remove('is-open', 'is-dragging');
  sheet.style.transform = '';
  backdrop.classList.remove('is-open');
  if (wasOpen) {
    window.dispatchEvent(new CustomEvent(HV_CLEAR_SELECTION));
  }
};

// ── Drag-to-close ────────────────────────────────────────────────────────────

const onDragStart = (e: PointerEvent): void => {
  if (!sheet) return;
  dragging = true;
  dragStartY = e.clientY;
  dragOffset = 0;
  sheet.classList.add('is-dragging');
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
};

const onDragMove = (e: PointerEvent): void => {
  if (!dragging || !sheet) return;
  dragOffset = Math.max(0, e.clientY - dragStartY);
  sheet.style.transform = `translate(-50%, ${dragOffset}px)`;
};

const onDragEnd = (): void => {
  if (!sheet) return;
  dragging = false;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  sheet.classList.remove('is-dragging');
  if (dragOffset > 90) {
    closeSheet();
  } else {
    sheet.style.transform = '';
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
