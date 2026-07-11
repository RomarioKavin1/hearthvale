// Floating dev panel for the harness: time warp, resource cheats, weather/festival
// cycling, golden-window override, bot spawning, world reset and an FPS meter.
//
// After any change that alters the mock clock or city, it calls `store.refresh()`
// so the REAL client re-pulls state and re-syncs its clock skew — no production
// code is touched.

import { store } from '../../src/client/state';
import { devControls } from './mock-api';

const refresh = (): void => {
  void store.refresh().catch((err: unknown) => console.warn('[harness] refresh failed', err));
};

const fmtOffset = (ms: number): string => {
  if (ms === 0) return 'live';
  const sign = ms > 0 ? '+' : '-';
  const a = Math.abs(ms);
  const d = Math.floor(a / 86_400_000);
  const h = Math.floor((a % 86_400_000) / 3_600_000);
  const m = Math.floor((a % 3_600_000) / 60_000);
  const parts = [d ? `${d}d` : '', h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean);
  return `${sign}${parts.join(' ') || '<1m'}`;
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
};

const button = (label: string, onClick: () => void): HTMLButtonElement => {
  const b = el('button', { textContent: label, type: 'button' });
  b.style.cssText =
    'flex:1 1 auto;min-width:0;padding:6px 8px;border:1px solid #3a3a46;border-radius:8px;' +
    'background:#26262f;color:#e8e8ef;font-size:12px;cursor:pointer;white-space:nowrap';
  b.addEventListener('mouseenter', () => (b.style.background = '#32323d'));
  b.addEventListener('mouseleave', () => (b.style.background = '#26262f'));
  b.addEventListener('click', onClick);
  return b;
};

const row = (...kids: Node[]): HTMLDivElement => {
  const d = el('div', {}, kids);
  d.style.cssText = 'display:flex;gap:6px;margin:6px 0;align-items:center;flex-wrap:wrap';
  return d;
};

const label = (text: string): HTMLDivElement => {
  const d = el('div', { textContent: text });
  d.style.cssText = 'font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#8a8a99;margin-top:8px';
  return d;
};

export const mountDevPanel = (): void => {
  const panel = el('div', { id: 'hv-dev-panel' });
  panel.style.cssText =
    'position:fixed;top:10px;right:10px;z-index:2147483600;width:240px;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8e8ef;' +
    'background:rgba(20,20,26,.94);border:1px solid #3a3a46;border-radius:12px;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.5);backdrop-filter:blur(4px);overflow:hidden';

  // Header (collapse toggle)
  const clock = el('span', { textContent: 'live' });
  clock.style.cssText = 'font-size:11px;color:#9fe0a0';
  const fps = el('span', { textContent: '– fps' });
  fps.style.cssText = 'font-size:11px;color:#8a8a99;margin-left:auto';
  const header = el('div', {}, ['🛠 harness', clock, fps]);
  header.style.cssText =
    'display:flex;gap:8px;align-items:center;padding:8px 10px;cursor:pointer;' +
    'background:#1c1c24;font-size:12px;font-weight:600;user-select:none';

  const bodyWrap = el('div');
  bodyWrap.style.cssText = 'padding:6px 10px 10px';

  let open = true;
  header.addEventListener('click', () => {
    open = !open;
    bodyWrap.style.display = open ? 'block' : 'none';
  });

  // Time warp
  bodyWrap.append(label('time warp'));
  const warp = (ms: number): void => {
    devControls.warp(ms);
    refresh();
  };
  bodyWrap.append(
    row(
      button('+1m', () => warp(60_000)),
      button('+10m', () => warp(600_000)),
      button('+1h', () => warp(3_600_000)),
      button('+1d', () => warp(86_400_000))
    )
  );

  // Resources
  bodyWrap.append(label('resources'));
  bodyWrap.append(
    row(
      button('+500 coins', () => {
        devControls.addCoins(500);
        refresh();
      }),
      button('+20 planks', () => {
        devControls.addGoods('planks', 20);
        refresh();
      }),
      button('+20 bricks', () => {
        devControls.addGoods('bricks', 20);
        refresh();
      }),
      button('+20 wheat', () => {
        devControls.addGoods('wheat', 20);
        refresh();
      })
    )
  );

  // Environment
  bodyWrap.append(label('environment'));
  const weatherBtn = button('weather ▸', () => {});
  weatherBtn.textContent = 'weather ▸ clear';
  weatherBtn.addEventListener('click', () => {
    const w = devControls.cycleWeather();
    weatherBtn.textContent = `weather ▸ ${w}`;
    refresh();
  });
  const festBtn = button('festival ▸', () => {});
  festBtn.textContent = 'festival ▸ coins';
  festBtn.addEventListener('click', () => {
    const f = devControls.cycleFestival();
    festBtn.textContent = `festival ▸ ${f}`;
    refresh();
  });
  bodyWrap.append(row(weatherBtn), row(festBtn));

  // Golden always
  const goldenWrap = el('label');
  goldenWrap.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12px;margin:6px 0;cursor:pointer';
  const goldenChk = el('input', { type: 'checkbox' });
  goldenChk.checked = devControls.goldenAlways();
  goldenChk.addEventListener('change', () => devControls.setGoldenAlways(goldenChk.checked));
  goldenWrap.append(goldenChk, document.createTextNode('golden now (every collect doubles)'));
  bodyWrap.append(goldenWrap);

  // World
  bodyWrap.append(label('world'));
  bodyWrap.append(
    row(
      button('+ bot villager', () => {
        const ok = devControls.addBot();
        if (!ok) console.warn('[harness] no open tile for a bot');
        refresh();
      })
    )
  );
  const resetBtn = button('reset world', () => {
    if (!confirm('Reset the harness world? This clears all progress.')) return;
    devControls.reset();
    location.reload();
  });
  resetBtn.style.borderColor = '#6a2a2a';
  resetBtn.style.color = '#f0b0b0';
  bodyWrap.append(row(resetBtn));

  panel.append(header, bodyWrap);
  document.body.append(panel);

  // Clock label ticker
  setInterval(() => {
    clock.textContent = fmtOffset(devControls.offsetMs());
    clock.style.color = devControls.offsetMs() === 0 ? '#9fe0a0' : '#e0c060';
  }, 1000);

  // FPS meter — a true 1s rolling average: the count of frames whose timestamps
  // fall within the last 1000ms. A fixed per-second window (reset-and-divide)
  // read erratically (0/1/75) when a window boundary landed on an rAF stall;
  // rolling over a sliding 1s span smooths that out.
  const stamps: number[] = [];
  const start = performance.now();
  const tick = (t: number): void => {
    stamps.push(t);
    while (stamps.length > 0 && (stamps[0] ?? t) <= t - 1000) stamps.shift();
    // Only report once a full second of samples has accumulated, so the meter
    // doesn't flash a low ramp-up count in its first second.
    fps.textContent = t - start >= 1000 ? `${stamps.length} fps` : '– fps';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
