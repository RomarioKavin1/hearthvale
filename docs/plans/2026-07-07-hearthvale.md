# Hearthvale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "Hearthvale" — a cozy isometric pixel-village builder for Reddit (Devvit Web) where one persistent village per subreddit is built collectively by its members, for the Reddit "Games with a Hook" hackathon.

**Architecture:** Webview client (Phaser 4 renders the shared isometric village; DOM overlay renders HUD/panels) + serverless Hono backend on Devvit with all state in per-installation Redis, computed lazily from timestamps (no ticking). Realtime channel pushes village changes live; one daily scheduler job rotates festivals, tallies ballots, and posts a fresh daily post. All pixel art is generated at runtime from declarative sprite specs (no binary assets).

**Tech Stack:** TypeScript, Phaser 4.2.0, Vite 8 + `@devvit/start`, Hono 4, `@devvit/web` 0.13.6, Redis (Devvit), Vitest (add).

## Global Constraints

- App name in `devvit.json` and `package.json`: `hearthvale` (3–16 chars, `^[a-z][a-z0-9-]*$`).
- Node >= 22.2.0. Template scripts: `npm run build` (vite build), `npm run type-check`, `npm run lint`, `npm run dev` (devvit playtest).
- Server bundle must remain CommonJS (`dist/server/index.cjs` — handled by the vite plugin; do not change `server.entry`).
- Client may ONLY call its own server via `fetch('/api/...')`. No external URLs anywhere in client code, no CDN scripts, no external fonts. All assets generated at runtime or bundled locally.
- All `/api/*` endpoints are publicly reachable — every mutation MUST validate server-side (ownership, cost, cooldown, level).
- Trigger delivery is at-least-once — install trigger must be idempotent.
- `redis` from `@devvit/web/server`: NO plain sets/lists/pub-sub/key-scan. Sorted sets + hashes only. `watch/multi/exec` for the plot-claim race.
- Timestamps: `Date.now()` server-side is fine (this is app code, not a Workflow script).
- Git commits: conventional messages, NO Co-Authored-By trailers of any kind.
- Code style (template AGENTS.md): type aliases over interfaces, named exports, never cast types (no `as X` except `as const`), no inline `<script>` in HTML.
- Mobile-first: everything must be usable at 360×640; inline splash must render < 1s (no Phaser in splash).
- Identity: cozy pixel village. Palette (the ONLY colors used for sprites, defined in `src/shared/palette.ts`): see Task 2. UI copy is warm and villagey ("hearth", "festival", "neighbor"), never Reddit-corporate.

## Game Design Reference (single source of truth)

- **Village grid:** 18×18 isometric tiles. Rings: center 2×2 = landmark plaza (not claimable), surrounding ring of 12 tiles = decorative plaza edge (not claimable), everything else claimable. Tile key `"x,y"`, 0-indexed.
- **Plots per player:** 1 at level 1, +1 at levels 3, 5, 8, 12 (max 5).
- **Resources:** `coins` (buy/upgrade), `supplies` (contribute to landmark), `xp` (levels).
- **Buildings** (id, name, category, unlockLevel, baseCost coins, rate per minute, storage cap, buildSeconds; tier 2 = cost×2.5 / rate×2.2 / cap×2 / build×2; tier 3 = cost×6 / rate×4 / cap×3.5 / build×4 — all relative to base, rounded):

| id | name | category | lvl | cost | rate | cap | build s |
|---|---|---|---|---|---|---|---|
| cottage | Cottage | coins | 1 | 40 | 3 | 90 | 20 |
| bakery | Bakery | coins | 1 | 90 | 6 | 180 | 45 |
| garden | Herb Garden | supplies | 1 | 60 | 2 | 60 | 30 |
| market | Market Stall | coins | 2 | 200 | 11 | 330 | 90 |
| sawmill | Sawmill | supplies | 3 | 260 | 4 | 120 | 120 |
| tavern | Tavern | coins | 4 | 450 | 20 | 600 | 180 |
| lantern | Lantern Post | decor | 2 | 120 | 0 | 0 | 15 |
| topiary | Topiary | decor | 4 | 300 | 0 | 0 | 30 |
| mill | Windmill | coins | 6 | 900 | 34 | 1000 | 300 |
| forge | Forge | supplies | 7 | 800 | 7 | 210 | 300 |
| manor | Manor | coins | 9 | 1600 | 55 | 1650 | 480 |
| fountain | Mossy Fountain | decor | 8 | 700 | 0 | 0 | 60 |

- **Decor adjacency:** each orthogonally adjacent decor building adds +10% × its tier to a producer's rate (max +60% total).
- **Festival:** one category (`coins` | `supplies` | `decor`) is "festival of the day": producers of that category run at 1.5×; decor festival day = adjacency bonus doubled. Chosen by yesterday's ballot (majority; tie → rotate).
- **Landmark:** the Grand Clocktower, 5 stages. Stage thresholds (cumulative supplies): 300 / 900 / 2000 / 4000 / 7500. Completing a stage: realtime celebration + every player who contributed to that stage gets `stage × 100` coins on next state fetch (mark paid).
- **XP:** collect = 1 xp per 10 coins (round up), contribute = 1 xp per supply, build/upgrade = cost/10 xp. Level thresholds: `xpFor(level) = 75 × level × (level − 1)` (L2=150, L3=450, L4=900 …), max level 15.
- **Streak check-in:** explicit button, once per UTC day: coins = 25 × min(streak, 7). Missing a day resets streak to 1.
- **Boosts:** boosting a NEIGHBOR'S producer sets 2× rate for 30 min on that tile; booster gets 15 coins + 5 xp. Limit 5 boosts/day per player; can't boost own tiles; one active boost per tile.
- **Economy start:** new player: 120 coins, 0 supplies, level 1.
- **Leaderboards (zsets):** `lb:value` (sum of tile values = cost spent), `lb:earned` (lifetime coins collected), `lb:contrib` (lifetime supplies contributed).
- **Flair (best effort, try/catch):** on level-up to 3/6/9/12/15 set user flair: Settler / Builder / Architect / Alderman / Founder.

## Redis Schema (exact keys)

- `city:grid` — hash, field `"x,y"` → JSON `TileState`
- `city:state` — hash: `foundedAt`, `festival` (category), `festivalDate` (YYYY-MM-DD), `landmarkStage` (0–5), `landmarkProgress` (supplies into current stage), `totalCollected`, `totalContributed`
- `player:{userId}` — hash: `name`, `coins`, `supplies`, `xp`, `level`, `plots`, `streak`, `lastCheckIn` (YYYY-MM-DD), `boostsToday`, `boostsDate`, `paidStage`
- `contrib:stage:{n}` — zset userId → supplies contributed during stage n
- `ballot:{YYYY-MM-DD}` — hash: field category → count; `ballotvoted:{YYYY-MM-DD}` — hash userId → 1
- `lb:value`, `lb:earned`, `lb:contrib` — zsets userId → score
- `uname:{userId}` — string cache of username
- `installed` — string flag for idempotent install trigger

## API Contract (all JSON; errors `{status:'error', message}` with 4xx)

- `GET /api/state` → `StateResponse` = `{ grid: Record<string,TileState>, city: CityState, me: PlayerState|null, now: number, top: LeaderRow[] }` (top = first 5 of lb:value with names)
- `POST /api/claim` `{x,y}` → `{tile: TileState, me: PlayerState}`
- `POST /api/build` `{x,y,buildingId}` → `{tile, me}`
- `POST /api/upgrade` `{x,y}` → `{tile, me}`
- `POST /api/collect` `{x,y}` → `{tile, me, gained:{coins,supplies,xp}}`
- `POST /api/collect-all` `{}` → `{tiles: Record<string,TileState>, me, gained}`
- `POST /api/checkin` `{}` → `{me, gained:{coins}}`
- `POST /api/boost` `{x,y}` → `{tile, me}`
- `POST /api/contribute` `{amount}` → `{city, me}`
- `POST /api/vote` `{category}` → `{counts: Record<string,number>}`
- `GET /api/leaderboards` → `{value: LeaderRow[], earned: LeaderRow[], contrib: LeaderRow[]}` (top 10 each, `LeaderRow = {name, score, me:boolean}`)
- `GET /api/summary` → `{buildings:number, players:number, landmarkStage:number, landmarkPct:number, festival:string, readyForMe:number}` (splash; must be 1 redis hGetAll + cheap math)
- Realtime channel `village`: messages `{t:'tile', key, tile}` | `{t:'city', city}` | `{t:'festival', festival}` | `{t:'stage', stage}`

Types live in `src/shared/types.ts`; catalog + all pure math in `src/shared/logic/` — server handlers stay thin.

---

### Task 0: Project setup

**Files:** Modify `package.json`, `devvit.json`, `README.md` (stub); Delete `src/client/scenes/*` demo content later (Task 5 replaces); Create `vitest.config.ts`, `.gitignore` check.

- [ ] Replace `<% name %>` with `hearthvale` in `package.json` and `devvit.json`; set post title in `src/server/core/post.ts` to `Hearthvale — build our village together 🏡`.
- [ ] `devvit.json`: add `"permissions": {"redis": true, "realtime": true, "reddit": {"enable": true, "asUser": ["SUBMIT_COMMENT"]}}`; add `"scheduler": {"tasks": {"daily-cycle": {"endpoint": "/internal/scheduler/daily-cycle", "cron": "0 12 * * *"}}}`; remove the example form + its menu item; keep post-create menu item and onAppInstall trigger.
- [ ] `npm i -D vitest` and add `"test": "vitest run"` script; create `vitest.config.ts` including only `src/shared/**/*.test.ts` + `src/server/**/*.test.ts`.
- [ ] `npm install`; `npm run build` → verify `dist/client` + `dist/server/index.cjs` exist; `npm run type-check` passes.
- [ ] `git init`, commit `chore: scaffold hearthvale from devvit phaser template`.

### Task 1: Shared domain — types, catalog, economy math

**Files:** Create `src/shared/types.ts`, `src/shared/catalog.ts`, `src/shared/logic/economy.ts`, `src/shared/logic/grid.ts`, `src/shared/logic/economy.test.ts`, `src/shared/logic/grid.test.ts`. Delete `src/shared/api.ts` (and its imports in template files — stub them out).

**Produces (later tasks rely on these exact names):**
```ts
// types.ts
export type BuildingCategory = 'coins' | 'supplies' | 'decor';
export type BuildingId = 'cottage'|'bakery'|'garden'|'market'|'sawmill'|'tavern'|'lantern'|'topiary'|'mill'|'forge'|'manor'|'fountain';
export type Tier = 1 | 2 | 3;
export type TileState = { owner: string; ownerName: string; buildingId?: BuildingId; tier: Tier; builtAt: number; readyAt: number; lastCollect: number; boostUntil: number; boostBy?: string };
export type CityState = { foundedAt: number; festival: BuildingCategory; festivalDate: string; landmarkStage: number; landmarkProgress: number; totalCollected: number; totalContributed: number };
export type PlayerState = { id: string; name: string; coins: number; supplies: number; xp: number; level: number; plots: number; streak: number; lastCheckIn: string; boostsToday: number };
export type LeaderRow = { name: string; score: number; me: boolean };
export type StateResponse = { grid: Record<string, TileState>; city: CityState; me: PlayerState | null; now: number; top: LeaderRow[] };
export type Gained = { coins: number; supplies: number; xp: number };
```
```ts
// catalog.ts
export type BuildingSpec = { id: BuildingId; name: string; category: BuildingCategory; unlockLevel: number; cost: number; ratePerMin: number; cap: number; buildSeconds: number };
export const CATALOG: Record<BuildingId, BuildingSpec>; // exact numbers from the design table
export const tierStats: (spec: BuildingSpec, tier: Tier) => { cost: number; ratePerMin: number; cap: number; buildSeconds: number }; // tier1 = base; tier2 ×2.5/×2.2/×2/×2; tier3 ×6/×4/×3.5/×4 vs base; Math.round all
export const LANDMARK_THRESHOLDS: number[] // [300,900,2000,4000,7500]
export const GRID_SIZE: number // 18
export const MAX_LEVEL: number // 15
export const PLOT_LEVELS: number[] // [1,3,5,8,12]
```
```ts
// logic/economy.ts
export const xpFor: (level: number) => number;               // 75·L·(L−1)
export const levelForXp: (xp: number) => number;             // inverse, capped MAX_LEVEL
export const plotsForLevel: (level: number) => number;       // count of PLOT_LEVELS ≤ level
export const accrue: (tile: TileState, now: number, festival: BuildingCategory, adjacentDecorBonus: number) => Gained; // 0 if under construction (now < readyAt) or decor; rate×elapsed/60000 with boost (2× while now<boostUntil — apply to elapsed time in boost window precisely: split elapsed at boostUntil), festival ×1.5 if category match, adjacency ×(1+bonus); floor; clamp to cap; xp = per design (coins:ceil(c/10); supplies:1/供 — supplies xp = amount)
export const adjacencyBonus: (grid: Record<string, TileState>, x: number, y: number, festival: BuildingCategory) => number; // Σ 0.1×tier of adjacent completed decor, ×2 if festival==='decor', max 0.6 (pre-doubling max still 0.6, doubled cap 1.2)
export const streakReward: (streak: number) => number;       // 25×min(streak,7)
export const canClaim: (grid: Record<string, TileState>, x: number, y: number, player: PlayerState, owned: number) => string | null; // null = ok, else reason. checks bounds, reserved plaza (see grid.ts), tile empty, owned < plotsForLevel
```
```ts
// logic/grid.ts
export const tileKey: (x: number, y: number) => string;      // "x,y"
export const parseKey: (key: string) => { x: number; y: number };
export const isPlaza: (x: number, y: number) => boolean;      // center 4×4 block: x,y in [7,10]; landmark occupies center 2×2 [8,9]
export const isClaimable: (x: number, y: number) => boolean;  // in bounds && !isPlaza
export const neighbors: (x: number, y: number) => Array<{x:number;y:number}>; // orthogonal, in bounds
export const isoToScreen: (x: number, y: number, tileW: number, tileH: number) => { sx: number; sy: number }; // sx=(x−y)·tileW/2, sy=(x+y)·tileH/2
```

- [ ] Write failing tests in `economy.test.ts`: xpFor(2)=150, xpFor(3)=450; levelForXp(0)=1, levelForXp(150)=2, levelForXp(449)=2, cap at 15; plotsForLevel(1)=1, (3)=2, (12)=5; accrue: fresh cottage tier1 after 60s = 3 coins; clamps to cap after long absence; 0 during construction; 2× inside boost window; ×1.5 on festival match; adjacency multiplies; decor accrues 0; supplies building yields supplies+equal xp. adjacencyBonus: two adjacent tier1 lanterns = 0.2; caps at 0.6; doubled on decor festival; ignores under-construction decor. canClaim: plaza rejected, occupied rejected, over plot-limit rejected, ok case null.
- [ ] Run `npm test` → verify failures reference missing modules.
- [ ] Implement `types.ts`, `catalog.ts`, `economy.ts`, `grid.ts` exactly per signatures above.
- [ ] `npm test` green; `npm run type-check` green (fix template files importing deleted `shared/api.ts` by inlining minimal types or removing demo endpoints — demo API routes get fully replaced in Task 3; for now keep compiling).
- [ ] Commit `feat: shared domain model, catalog and economy logic`.

### Task 2: Pixel-art sprite factory (runtime-generated assets)

**Files:** Create `src/shared/palette.ts`, `src/client/art/pixels.ts`, `src/client/art/buildings.ts`, `src/client/art/tiles.ts`, `src/client/art/landmark.ts`, `src/client/scenes/ArtDebug.ts` (dev-only scene, listed in game config only when `location.search` contains `artdebug`).

**Palette (exact, `palette.ts`):**
```ts
export const PAL = {
  night: '#2e2837', soil: '#5a4a41', soilDark: '#4a3c35',
  grass: '#8fbf6b', grassDark: '#7aa85a', grassLight: '#a5d17f',
  path: '#d9b98c', pathDark: '#c4a276',
  wood: '#8a6249', woodDark: '#6e4d39', woodLight: '#a67c5b',
  wall: '#e8d5b0', wallShade: '#d4bf98',
  roofRed: '#c25b4e', roofRedDark: '#a34а41'.replace('а','a'), // NOTE: write plain '#a34a41'
  roofBlue: '#5b7ea8', roofBlueDark: '#4a6a8f', roofStraw: '#d9a951', roofStrawDark: '#bf9143',
  stone: '#9a94a6', stoneDark: '#7e7890', leaf: '#6aa court'.replace(' court','354') /* write plain '#6aa354' */, leafDark: '#568a43',
  water: '#7fb8d4', glow: '#ffd98a', cream: '#fff3d9', ink: '#3b3347', accent: '#e8905a',
} as const;
```
(Implementer: write literal hex strings — the two `.replace` artifacts above are plan-typo guards, use `#a34a41` and `#6aa354`.)

**Approach:** low-res pixel canvases scaled with nearest-neighbor. `pixels.ts` exposes:
```ts
export type PixelGrid = string[]; // rows of palette-key chars, '.'=transparent, e.g. 'WWRR..'
export type Legend = Record<string, string>; // char → hex
export const drawPixelTexture: (scene: Phaser.Scene, key: string, rows: PixelGrid, legend: Legend, scale?: number) => void; // creates a canvas texture via scene.textures.createCanvas, drawing each pixel as scale×scale rect (default 3), with ctx.imageSmoothingEnabled=false
```
- Ground tiles (`tiles.ts`): iso diamond 32×16 logical px (drawn at scale 3 → 96×48): `tile_grass` (+2 alt variants with flower/tuft specks), `tile_path`, `tile_plaza`, `tile_water_edge` decorative border variants, `tile_highlight` (glow outline), `tile_claim` (dashed outline). Export `registerTiles(scene)`, plus constants `TILE_W=96, TILE_H=48`.
- Buildings (`buildings.ts`): for each of 12 buildings × 3 tiers, a pixel spec ~24×32 logical px, anchored bottom-center, in iso style (front-left + front-right faces visible, tier upgrades add floors/details e.g. chimney smoke pixels, bigger roof, gold trim at tier 3). Also `construction` sprite (scaffold + crane arm) and per-building 8×8 icon for UI. Export `registerBuildings(scene)`; texture keys `bld_{id}_{tier}`, `bld_construction`, `icon_{id}`.
- Landmark (`landmark.ts`): Grand Clocktower stages 0–5 (stage 0 = foundation stones), footprint 2×2 tiles, ~48×72 logical px, key `landmark_{stage}`. Export `registerLandmark(scene)`.
- Cohesion rules: every sprite uses ONLY `PAL` colors; 1px `ink` outline on silhouettes; light from top-left (use Light/Dark pairs); roofs vary per building among roofRed/roofBlue/roofStraw.

- [ ] Implement `pixels.ts` with `drawPixelTexture` + unit-testable pure helper `validateGrid(rows, legend)` (throws on ragged rows/unknown chars) + `src/client/art/pixels.test.ts` for `validateGrid` (vitest, no Phaser import in the pure part).
- [ ] Implement tiles, buildings (all 12 × 3 tiers + construction + icons), landmark stages. Keep each spec a `PixelGrid` literal — hand-crafted, varied, cute.
- [ ] `ArtDebug` scene: renders every texture on a grid with labels (verification surface).
- [ ] `npm test` + `npm run type-check` + `npm run build` green.
- [ ] Commit `feat: runtime pixel-art sprite factory (tiles, 12 buildings x3 tiers, clocktower)`.

### Task 3: Server core — state, claim, build, upgrade, collect

**Files:** Create `src/server/core/store.ts`, `src/server/core/village.ts`; Rewrite `src/server/routes/api.ts`; Modify `src/server/core/post.ts` (splash-less custom post, title above), `src/server/routes/triggers.ts` (idempotent bootstrap). Create `src/server/core/village.test.ts` for pure helpers.

**Produces:**
```ts
// store.ts — thin redis access, all keys from Redis Schema section
export const getGrid: () => Promise<Record<string, TileState>>;
export const getTile: (key: string) => Promise<TileState | null>;
export const putTile: (key: string, t: TileState) => Promise<void>;       // hSet city:grid
export const getCity: () => Promise<CityState>;                            // with defaults if unset
export const putCity: (c: Partial<CityState>) => Promise<void>;
export const getPlayer: (userId: string) => Promise<PlayerState | null>;
export const initPlayer: (userId: string, name: string) => Promise<PlayerState>; // 120 coins, level 1
export const putPlayer: (p: PlayerState) => Promise<void>;
export const ownedCount: (grid: Record<string,TileState>, userId: string) => number;
```
`village.ts` composes store + shared logic into operations, each returning the API-contract payloads and broadcasting realtime: `realtime.send('village', {t:'tile', key, tile})` after mutations (wrap in try/catch — realtime failure must not fail the request).

Handlers (`api.ts`, Hono): identity via `context.userId` (401-style JSON error when missing on mutations; `GET /api/state` returns `me:null` for logged-out). EVERY mutation: re-read tile + player, validate with shared logic (`canClaim`, unlock level, funds, tier<3, construction done, cooldowns), apply, persist, update zsets (`lb:value` zIncrBy cost; `lb:earned` zIncrBy coins gained; xp→level-up check → plots, best-effort flair via `reddit.setUserFlair` in try/catch at levels 3/6/9/12/15), return payload. Claim uses `watch('city:grid')` + `multi()` to prevent double-claim.

- [ ] Write `village.test.ts` for the pure decision helpers you extract (e.g. `validateBuild(player, tile, spec, now)` → error string|null; `applyCollect(tile, player, city, now, adjacencyBonus)` → `{tile, player, gained}`): cover insufficient funds, locked building, tier cap, collect-during-construction=0, level-up grants plots. Run: fails.
- [ ] Implement store.ts, village.ts, api.ts endpoints: `GET /api/state`, `POST /api/claim|build|upgrade|collect|collect-all`, `GET /api/summary`. `state` composes grid+city+me+top5 of lb:value (usernames via `uname:{id}` cache, fallback `reddit.getUserById` → cache).
- [ ] Triggers: `on-app-install` sets `installed` flag via `set` + skips if already set; seeds `city:state` (`foundedAt`, festival='coins', festivalDate=today, stage 0) and creates the first post.
- [ ] `npm test` green; type-check + build green; commit `feat: village server core (claim/build/upgrade/collect, state, install bootstrap)`.

### Task 4: Server social — check-in, boosts, landmark, ballot, leaderboards, daily cycle

**Files:** Modify `src/server/routes/api.ts`, `src/server/core/village.ts`; Create `src/server/routes/scheduler.ts`; Modify `src/server/index.ts` (mount `/internal/scheduler`), `src/server/core/post.ts` (add `createDailyPost(festival)` variant with festival in title).

- [ ] Tests first (pure helpers in village.test.ts): streak transition (consecutive day +1, gap resets to 1, same-day rejected), boost validation (own tile rejected, non-producer rejected, active boost rejected, >5/day rejected, date rollover resets count), contribute (clamps to player supplies, crosses stage threshold → stage++, remainder carries, `contrib:stage:{n}` split correctly), ballot (one vote/day, tally majority, tie → next category in coins→supplies→decor rotation), stage payout (contributor gets stage×100 once — `paidStage` marker).
- [ ] Implement endpoints: `checkin`, `boost`, `contribute`, `vote`, `GET /api/leaderboards` (3 zsets, top 10 + me flag). Contribute updates `lb:contrib`, `city:state`, broadcasts `{t:'city'}` / `{t:'stage'}` on threshold. Stage payout applied lazily inside `GET /api/state` (compare player.paidStage vs city.landmarkStage, pay per-stage contributions).
- [ ] `scheduler.ts` `POST /internal/scheduler/daily-cycle`: tally yesterday's ballot → set festival + festivalDate; `createDailyPost` (`Hearthvale Day N — 🎪 {Festival} Festival! Come build.`); broadcast `{t:'festival'}`. Errors logged, response 200 with status (scheduler retries otherwise).
- [ ] Tests + type-check + build green; commit `feat: social layer (streaks, boosts, landmark, ballot, leaderboards, daily cycle)`.

### Task 5: Client — village scene (Phaser)

**Files:** Create `src/client/scenes/Village.ts`, `src/client/net.ts`, `src/client/state.ts`; Rewrite `src/client/game.ts` (scenes: Boot→Preloader→Village; register art in Preloader via `registerTiles/registerBuildings/registerLandmark`); Delete `src/client/scenes/MainMenu.ts`, `Game.ts`, `GameOver.ts`.

**Produces:**
```ts
// net.ts
export const api: { state(): Promise<StateResponse>; claim(x,y): Promise<...>; build(x,y,id): ...; upgrade(x,y): ...; collect(x,y): ...; collectAll(): ...; checkin(): ...; boost(x,y): ...; contribute(amount): ...; vote(category): ...; leaderboards(): ... }; // thin typed fetch wrappers, throws Error(message) on {status:'error'}
// state.ts — a tiny event-emitter store
export const store: { data: StateResponse | null; refresh(): Promise<void>; patchTile(key, tile): void; patchCity(city): void; on(evt: 'change', cb): void };
```
- Village scene: renders 18×18 iso grid from `store` (grass variants seeded by `(x*7+y*13)%…` so layout is stable), path ring around plaza, plaza tiles, landmark at [8,9] per stage, buildings per tile (construction sprite while `now<readyAt` with a mini progress bar), subtle idle animations (tween-bobbing chimney smoke particles using 2×2 `glow` rects, lantern glow pulse at night-tint plaza).
- Camera: drag-pan (pointer), pinch/wheel zoom clamped 0.5–2, auto-center on your first plot else plaza. `Phaser.Scale.RESIZE`, iso depth-sort via `sy`.
- Interactions: tap tile → emits DOM CustomEvent `hv:tileSelected {key, tile, mine, claimable}` (UI overlay owns panels, Task 6); tiles with pending production show a floating coin/leaf pip; tap-collect on own ready tile plays coin-burst tween + count-up.
- Realtime: `connectRealtime({channel:'village', onMessage})` → `store.patchTile/patchCity` → scene reacts (new building = dust-puff + pop-in tween; stage change = confetti burst over landmark); fallback: poll `/api/state` every 45s when realtime disconnects (and always re-fetch on `visibilitychange` visible).
- [ ] Implement; verify `npm run build` + type-check; manual check via `ArtDebug` unaffected.
- [ ] Commit `feat: phaser village scene with iso grid, camera, realtime updates`.

### Task 6: Client — DOM HUD & panels

**Files:** Rewrite `src/client/game.html`, `src/client/game.css`; Create `src/client/ui/hud.ts`, `src/client/ui/panels.ts` (imported from `game.ts` after Phaser boot).

Layout (mobile-first, safe-area aware): top bar = coins 🪙, supplies 🌿, level ring with xp progress, festival chip; bottom-right FAB stack = Collect All, Check-in (shows streak flame + disabled after claim), Menu (opens sheet with Landmark / Ballot / Leaderboards / Help). Panels are bottom sheets (CSS transform animations, `ink`/`cream` palette, chunky pixel borders via `image-rendering:pixelated` box shadows — match PAL colors; system font stack `ui-rounded, "Segoe UI", sans-serif` with letter-spacing for cozy look).

- Tile sheet (opens on `hv:tileSelected`): claimable → "Claim this plot" (shows plots used/max); mine+empty → build grid (icons, name, cost, rate, locked-at-level states); mine+building → stats (tier, rate incl. adjacency/festival breakdown, storage fill bar) + Upgrade button (cost / "Max") + collect; neighbor's producer → owner name + Boost button (remaining today).
- Landmark sheet: clocktower art (img from Phaser texture `landmark_{stage}` via `game.textures.getBase64` — acceptable) or CSS art, stage progress bar, "Contribute" stepper (10/50/All), stage contributor top-5.
- Ballot sheet: three big category cards, today's counts, voted state; explains tomorrow's festival.
- Leaderboards sheet: 3 tabs, `me` row highlighted.
- Onboarding: if `me===null`→ login prompt (`showLoginPrompt` on interact); if me has 0 plots → dim map except claimable ring + bouncing arrow + copy "Pick a spot to settle in Hearthvale".
- Toast helper for API errors (never raw alert), plus `showToast` from `@devvit/web/client` where appropriate.
- [ ] Implement; every action optimistically disabled-while-pending; all panels usable at 360×640 and desktop.
- [ ] type-check + build green; commit `feat: HUD, build/landmark/ballot/leaderboard panels, onboarding`.

### Task 7: Splash (inline feed view)

**Files:** Rewrite `src/client/splash.html`, `src/client/splash.css`, `src/client/splash.ts`; Delete `public/snoo.png` usage & template footer links.

- Pure DOM+CSS (no Phaser): pixel-gradient sky, layered CSS village silhouette (box-shadow pixel art, colors from PAL), title "Hearthvale", live line from `GET /api/summary`: "🏘 {buildings} buildings · 👥 {players} villagers · 🕰 clocktower stage {stage}/5" and personal hook "🪙 {readyForMe} tiles ready to collect!" (or "Festival of {festival} today!"). Big "Enter the Village" button → `requestExpandedMode(e,'game')`.
- Must render instantly (summary fetch fills in async; skeleton before).
- [ ] Implement; build green; commit `feat: inline splash with live village stats`.

### Task 8: Share, README, polish pass

**Files:** Modify `src/server/routes/api.ts` (`POST /api/share`), `src/client/ui/panels.ts` (share button on milestones), `README.md`, `docs/` link fixes.

- [ ] `POST /api/share {kind:'levelup'|'stage', value}` → `reddit.submitComment({id: context.postId, text, runAs:'USER'})` in try/catch with `runAs:'APP'`... **No** — userActions fallback: try USER, on failure fall back to APP-authored comment prefixed `u/{name}`. Rate-limit 3/day/user (redis counter). Client: after level-up or stage completion, toast with "Share to comments?" button.
- [ ] README.md (root, review requires it): what Hearthvale is, how to play (claim→build→collect→contribute→ballot), features list, screenshots section placeholder, tech notes, hackathon category pitches (retention + user contributions + Phaser).
- [ ] Polish sweep: coin count-up tweens everywhere numbers change; button press states; empty states for panels; `visibilitychange` mutes any audio (if audio added, else ensure none autoplays); remove all remaining template branding (snoo.png, docs/discord links, "devvit" titles).
- [ ] Full gate: `npm test`, `npm run type-check`, `npm run lint`, `npm run build` all green; commit `feat: share-to-comments, README, polish pass`.

### Task 9: Verification & launch prep (needs user login)

- [ ] `npx devvit login` — **USER ACTION** (`! npx devvit login`).
- [ ] `npm run dev` (playtest) on dev subreddit; exercise: install→auto post; claim, build, timer, collect, upgrade, boost (second account or accept solo limits), contribute, vote, check-in, leaderboards, splash stats, realtime (two browser windows), mobile viewport via UI simulator.
- [ ] Fix everything found; `devvit upload`; `devvit publish` (starts 1–2 day review clock — do NOT wait until deadline).
- [ ] Demo video ≤1 min; Devpost submission (listing link, demo post link, README, description).

## Self-Review Notes

- Every endpoint in the API contract has an implementing task (state/claim/build/upgrade/collect/collect-all/summary → T3; checkin/boost/contribute/vote/leaderboards → T4; share → T8; scheduler/triggers → T3/T4).
- Type names used in T3–T7 all defined in T1. Palette/texture keys used in T5/T6/T7 defined in T2.
- Placeholder scan: T2 palette contains two deliberate plan-typo guards with explicit plain values given; no TBDs.
- Known deliberate cuts (YAGNI): no roads/citizens, no payments, no external fetch, no canvas→media share cards (text comments instead), festival categories fixed at 3.
