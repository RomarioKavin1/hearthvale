import { MURAL_DAILY, MURAL_H, MURAL_PALETTE, MURAL_W } from '../../shared/catalog';
import { api } from '../net';
import { store } from '../state';
import {
  el,
  fmtInt,
  notifyError,
  promptLogin,
  todayUtc,
  withTip,
} from './dom';
import { openSheet, refreshSheet } from './sheet';

/**
 * The Village Mural sheet (E1) — a mini r/place editor. A crisp 24×16 canvas the
 * villager taps to paint one pixel at a time (immediate server call, optimistic
 * local set, rollback on error), a 12-swatch palette row, a "pixels left today"
 * counter and a budget-exhausted state. Remote paints arrive as `{t:'mural'}`
 * broadcasts → the store patch re-renders this sheet live while it's open.
 */

/** On-screen size of one mural cell (px). Kept crisp with pixelated rendering. */
const CELL = 18;

/** The currently-selected palette colour (module-scoped so re-renders keep it).
 * Defaults to red (index 2) — a friendly first mark, never the parchment blank. */
let selected = 2;

/** Pixels being painted right now, so a double-tap doesn't fire two calls. */
const inFlight = new Set<string>();

/** Mural pixels the player has spent today (0 on a date rollover). */
const usedToday = (): number => {
  const me = store.data?.me;
  if (!me) return 0;
  return me.muralDate === todayUtc() ? me.muralToday : 0;
};

/** Draw the whole mural into a freshly-built canvas from the store snapshot. */
const drawCanvas = (canvas: HTMLCanvasElement): void => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const mural = store.data?.mural ?? {};
  for (let y = 0; y < MURAL_H; y += 1) {
    for (let x = 0; x < MURAL_W; x += 1) {
      const c = mural[`${x},${y}`] ?? 0;
      ctx.fillStyle = MURAL_PALETTE[c] ?? MURAL_PALETTE[0] ?? '#fff3d9';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // A subtle 1px grid so individual cells read while painting.
  ctx.strokeStyle = 'rgba(59,51,71,0.12)';
  ctx.lineWidth = 0.06;
  for (let x = 0; x <= MURAL_W; x += 1) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MURAL_H);
    ctx.stroke();
  }
  for (let y = 0; y <= MURAL_H; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(MURAL_W, y);
    ctx.stroke();
  }
};

/** Paint one pixel: optimistic local set, server call, rollback + toast on error. */
const paintPixel = (x: number, y: number): void => {
  const data = store.data;
  if (!data) return;
  if (!data.me) {
    promptLogin();
    return;
  }
  if (usedToday() >= MURAL_DAILY) return; // budget spent — the UI already says so
  const key = `${x},${y}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);

  const prev = data.mural[key];
  const color = selected;
  // Optimistic: show the pixel + decrement the budget immediately.
  store.patchMuralPixel(x, y, color);
  if (data.me) {
    data.me = {
      ...data.me,
      muralToday: usedToday() + 1,
      muralDate: todayUtc(),
      muralPixels: data.me.muralPixels + 1,
    };
  }
  refreshSheet();

  void api
    .mural(x, y, color)
    .then((res) => {
      store.applyMutation({ me: res.me });
    })
    .catch((err: unknown) => {
      // Roll the pixel back to its previous value (or the blank if it was empty).
      if (store.data) {
        if (prev === undefined) delete store.data.mural[key];
        else store.data.mural[key] = prev;
      }
      void store.refresh().catch(() => {});
      notifyError(err instanceof Error ? err.message : 'Could not paint that pixel.');
    })
    .finally(() => {
      inFlight.delete(key);
    });
};

/** The 12-swatch palette row (the parchment blank is swatch 0, an "erase"). */
const paletteRow = (): HTMLElement => {
  const row = el('div', { cls: 'hv-mural-pal' });
  MURAL_PALETTE.forEach((hex, i) => {
    const btn = el('button', {
      cls: `hv-mural-swatch${selected === i ? ' is-selected' : ''}`,
      attrs: { type: 'button', style: `background:${hex}` },
    });
    withTip(btn, i === 0 ? 'Parchment (erase)' : `Colour ${i}`);
    btn.addEventListener('click', () => {
      selected = i;
      refreshSheet();
    });
    row.appendChild(btn);
  });
  return row;
};

export const openMuralSheet = (): void => {
  openSheet({
    title: 'Village Mural',
    render: (body) => {
      const data = store.data;
      const stack = el('div', { cls: 'hv-stack' });

      stack.appendChild(
        el('p', {
          cls: 'hv-note',
          text: 'Every village shares one mural. Tap to paint a pixel — you get 12 a day, and anyone can paint over anyone.',
        })
      );

      // The canvas board.
      const canvas = document.createElement('canvas');
      canvas.width = MURAL_W;
      canvas.height = MURAL_H;
      canvas.className = 'hv-mural-canvas';
      canvas.style.width = `${MURAL_W * CELL}px`;
      canvas.style.height = `${MURAL_H * CELL}px`;
      drawCanvas(canvas);
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(((e.clientX - rect.left) / rect.width) * MURAL_W);
        const y = Math.floor(((e.clientY - rect.top) / rect.height) * MURAL_H);
        if (x < 0 || x >= MURAL_W || y < 0 || y >= MURAL_H) return;
        paintPixel(x, y);
      });
      stack.appendChild(el('div', { cls: 'hv-mural-wrap', children: [canvas] }));

      // Palette + counter.
      stack.appendChild(paletteRow());

      const left = Math.max(0, MURAL_DAILY - usedToday());
      if (!data?.me) {
        stack.appendChild(
          el('p', { cls: 'hv-note hv-muted', text: 'Sign in to leave your mark on the mural.' })
        );
      } else if (left <= 0) {
        stack.appendChild(
          el('p', {
            cls: 'hv-note hv-muted',
            text: 'Come back tomorrow — the mural remembers.',
          })
        );
      } else {
        stack.appendChild(
          el('div', {
            cls: 'hv-mural-count',
            children: [
              el('b', { text: `${fmtInt(left)}` }),
              el('span', { text: left === 1 ? ' pixel left today' : ' pixels left today' }),
            ],
          })
        );
      }

      body.appendChild(stack);
    },
  });
};
