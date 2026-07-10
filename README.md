# Hearthvale

A cozy village your whole subreddit builds together — and it only works if you build it together.

Hearthvale is a shared, persistent village that lives inside a single Reddit post. Everyone in the subreddit settles plots on the same island, and the loop is one gesture: tap a ripe building and coins pop instantly — your harvest sells itself into the village stockpile at whatever the market pays right now. Underneath, a real economy hums: prices move with supply, workshops pull inputs out of the shared stockpile, and the Village Hall only rises when people craft planks and bricks together. Part village-builder, part town square.

## What it is

- **A shared village.** One island, one economy, everyone plays on the same map in real time.
- **Tap → coins.** Fields, groves and quarries ripen on timers; tapping them sells the harvest automatically at the current village price.
- **A living market underneath.** Every good has a price that moves with supply — the market panel shows at a glance what the village needs next.
- **The Village Hall.** A five-level hall the community raises together with planks and bricks — the shared goal no single player can finish.

## How to play

1. **Settle.** Tap open grass to claim a plot — your first claim builds your House.
2. **Plant.** Build a wheat field, a forester's grove, or a quarry and let it ripen.
3. **Tap to collect.** Your harvest sells itself into the village stockpile — coins pop instantly, and scarce goods pay more.
4. **Grow.** Spend coins on more buildings and upgrades. Sawmills and kilns craft planks and bricks, the Hall-building material; a windmill and bakery turn the village's wheat into bread money.
5. **Raise the Village Hall together.** Contribute planks and bricks. Every level pays a pot split by contribution, buffs the whole village, and unlocks new land.

## Features

- **12 buildings across three production chains** — grain, wood, and stone — plus a bakery, houses, a manor, and decor pieces.
- **Auto-selling harvests** — no inventory to manage; the market prices every tap, rising when the village runs short and falling when it is well stocked.
- **The Village Hall** — five levels built from planks and bricks, with pro-rata coin payouts, a village-wide production buff per level, land-ring unlocks, and naming rights for top contributors.
- **Placement strategy** — a windmill by a wheat field earns more, so does a sawmill by a grove; river-side raw producers do best of all, and decor spreads a smaller bonus.
- **Daily weather and rotating festivals** — one "Today" chip tells you what pays best; the festival category auto-rotates every day.
- **Check-in streaks and neighbour boosts** — reward showing up and helping other players' plots.
- **Demolish and rebuild** — clear any building for a 50% coin refund, so no plot is ever a dead end.
- **Leaderboards and flair** — village value, lifetime earnings, and Hall contributions, with titles to match.
- **Per-subreddit customization** — moderators name their village and pick a colour theme (meadow, autumn, twilight, or pale) from a mod menu form, and any player can paint their building roofs one of four colours.
- **Mobile-first** — designed for the phone-sized Reddit feed, with a comfortable touch HUD.

## The hook

Hearthvale is built to bring people back, because four things change between sessions without you lifting a finger:

- **Your timers finish**, so there's always something ready to tap.
- **Prices move**, so yesterday's cheap harvest might be the village's most wanted good today.
- **The stockpile and the Hall advance**, because other people kept playing while you were gone.
- **The weather and the festival roll over**, so every new day genuinely plays differently.

The daily post puts that change right in the feed — a market report and the day's weather. And because more land only unlocks as the Village Hall rises, the village grows fastest when players bring friends in.

## Tech

- **Devvit Web** — the whole game runs inside a Reddit post, client and server.
- **Phaser 4** — the isometric village diorama.
- **Redis** — the persistent village, market, stockpile, players, and leaderboards.
- **Realtime channels** — live tile, market, and city updates across everyone viewing the post.
- **Scheduler** — a daily cron rolls the weather, rotates the festival, and posts the day's village update.

## Local dev harness (play without Devvit)

You can play the real game in a normal browser — no Devvit login, no `devvit playtest` — against an in-browser mock server:

```bash
npm run harness      # serves http://localhost:5199 (fixed port)
```

This runs the **real client** — the Phaser village scene and the DOM HUD, unchanged — and swaps the `@devvit/web/client` import for a browser stub (`dev/harness/mock-devvit-client.ts`). A patched `window.fetch` answers every `/api/*` call from an in-memory world (`dev/harness/mock-api.ts`) that **reuses the real shared game logic** (`src/shared/*` — accrual, adjacency, market pricing, quests, expansion, the Village-Hall and house buffs), so a collect, build, or contribution scores exactly as it does in production. The world is persisted to `localStorage`, so reloads keep your progress.

A floating **dev panel** (top-right) gives you:

- **Time warp** — jump the clock forward +1m / +10m / +1h / +1d so timers ripen instantly (the client's clock skew is re-synced, so countdowns and the golden-window sparkle stay honest).
- **Resource cheats** — +500 coins, +20 planks / bricks / wheat.
- **Weather** and **festival** cycling.
- **Golden now** — force every collect into the Perfect-Harvest doubling window.
- **+ bot villager** — drop a neighbouring house + producer to grow the population (and trigger Village-Hall level-ups).
- **Reset world** and an **FPS meter**.

**Known quirk — use one focused tab.** Phaser drives its asset loader from the browser's `requestAnimationFrame`, which browsers pause in background/unfocused tabs. So a **second** harness tab (or one you `cmd`/`ctrl`-click open in the background) can appear frozen at the preloader bar around ~10% — every asset request still returns `200`, there is no console error, the tab is simply throttled. Focus that tab (click into it) and the loader resumes and finishes; keep a single focused tab while playing. This is browser tab-throttling, not a game bug, and does not affect the published Devvit post (which renders in a single, always-foreground webview).

**What it does and does not test.** The harness exercises **client behaviour and game feel** — rendering, the HUD, the tile sheets, the realtime live-update paths (tile/city/market/festival/ring broadcasts are emitted from the mock's mutations), and the shared economy math. It does **not** run the real server code in `src/server/` (Redis transactions, Reddit side effects, the scheduler, leaderboards): the mock re-implements those endpoint contracts locally. See the divergences list at the top of `dev/harness/mock-api.ts`. None of the harness is part of the production Devvit build — `npm run build` (via `vite.config.ts`) never sees `dev/harness/` or the harness config.

## Credits

- **Art:** Kenney (kenney.nl) — CC0.
- **Font:** Fredoka (OFL).

## Playing / installing

Install Hearthvale on your subreddit and it creates the village post automatically. Moderators can also use the "Create a new post" menu action to start a fresh village at any time. Open the post, sign in with your Reddit account, and settle your first plot.
