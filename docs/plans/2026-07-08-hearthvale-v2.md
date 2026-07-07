# Hearthvale v2 Implementation Plan (mechanics + art rework)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Read docs/design/06-game-design-v2.md for the WHY of every mechanic.

**Goal:** Rework Hearthvale per design v2 — production chains, village market, population-gated expansion, Grand Keep, trader/weather — and re-skin with Kenney Sketch Town (CC0), removing all UI emojis.

**Architecture:** unchanged shell (Devvit Web, Hono, Redis, Phaser 4 + DOM HUD). Economy layer and renderer get major surgery; panels extend.

## Global Constraints (unchanged from v1 plan, plus)

- Commits: conventional, NO Co-Authored-By trailer; **push to origin after every task** (`git push`).
- NO emojis anywhere in game UI strings (docs/toasts CAN use plain words; icons are sprites).
- Sprites: Kenney Sketch Town + Expansion + Game Icons, CC0 — bundle only the files listed in the asset manifest; keep total added assets < 8 MB (downscale 256→128 px wide with sips if needed).
- Splash must NOT load the sprite atlas (keep its own lightweight CSS art, restyle to match the new look).
- All prior constraints: no casts, type aliases, named exports, pure logic in src/shared with vitest, thin handlers, validate everything server-side, lazy accrual (no ticking), realtime try/catch, gates green before every commit (`npm test`, type-check, lint, build).
- Credit line in README: "Art: Kenney (kenney.nl), CC0".

## Design Reference (single source of truth — numbers)

**Goods:** `wheat, logs, stone, flour, planks, bricks` (+ `coins`, `xp`). Wallet per player; **stockpile** per village (market holds it).

**Market pricing:** `price(good) = round(base × clamp(1.9 − stock/target, 0.6, 1.8))` recomputed on every trade/consumption. Bases: wheat 3, logs 4, stone 5, flour 9, planks 12, bricks 15. Targets: raw 120, processed 60. Players SELL to stockpile at price; processors AUTO-BUY at price (they pay coins from the building owner's future revenue — see processors). Players may also BUY from stockpile at `price × 1.25` (round up) when stock > 0.

**Catalog v2** (id, name, role, unlockLevel, cost coins, per-minute, cap, buildSeconds — tier stats same multipliers as v1):
| id | name | role | lvl | cost | rate/min | cap | build s |
|---|---|---|---|---|---|---|---|
| cottage | Cottage | coins 2/min + counts population | 1 | 40 | 2 | 60 | 20 |
| wheatfield | Wheat Field | raw wheat 3/min | 1 | 60 | 3 | 90 | 30 |
| grove | Forester's Grove | raw logs 2.5/min | 1 | 80 | 2.5 | 75 | 40 |
| quarry | Quarry | raw stone 2/min | 2 | 150 | 2 | 60 | 90 |
| windmill | Windmill | flour: consumes 2 wheat → 1 flour, 1.5/min output | 2 | 220 | 1.5 | 45 | 120 |
| sawmill | Sawmill | planks: 2 logs → 1 plank, 1.2/min | 3 | 300 | 1.2 | 36 | 150 |
| kiln | Mason's Kiln | bricks: 2 stone → 1 brick, 1/min | 4 | 400 | 1 | 30 | 180 |
| bakery | Bakery | coins: 1 flour → 12 coins, 1/min | 3 | 350 | 1 | 40u coins-equiv cap 480 | 150 |
| well | Old Well | decor aura +10%/tier | 2 | 120 | 0 | 0 | 15 |
| trees | Tree Grove (decor) | decor aura +10%/tier | 1 | 60 | 0 | 0 | 10 |
| fountain | Stone Fountain | decor aura +10%/tier | 6 | 700 | 0 | 0 | 60 |
| manor | Manor | coins 45/min flat prestige | 9 | 1600 | 45 | 1350 | 480 |

**Processors** (windmill/sawmill/kiln/bakery): on collect, compute potential output = rate×elapsed (capped). Actual output limited by stockpile inputs: consume `2 × output` input units from stockpile, paying `inputPrice × units` coins **deducted from the collect's coin value or the owner's balance** — bakery outputs coins directly (12/flour); goods processors output goods into the OWNER'S wallet. If stockpile lacks inputs → output only what's covered (starvation visible in UI). Consumption moves prices.

**Adjacency v2:** decor auras (+0.1×tier each, cap +0.6) PLUS chain synergy: wheatfield↔windmill, windmill↔bakery, grove↔sawmill, quarry↔kiln each +0.25 when orthogonally adjacent (stacking with decor, total bonus cap +1.0). River-adjacent raw producers +0.5. Festival ×1.5 unchanged (categories now: `coins | raw | processed | decor`— ballot updated).

**Expansion:** active grid starts 7×7 (IMPLEMENTATION: keep the 18×18 coordinate space; a tile is UNLOCKED iff within the current ring bounds). Ring bounds by distinct-owner count: <3 → [5,11]; ≥3 → [4,13]; ≥6 → [3,14]; ≥12 → [1,16]; ≥20 → [0,17]. Keep/plaza occupies [8,9]² as before (always unlocked). **River:** fixed serpentine path of ~14 tiles in the [1,16] and [0,17] rings (deterministic from a hardcoded list in shared/rivermap.ts). Locked tiles render as clouds/undergrowth (cliff/dirt sprites) and reject claims with "the village must grow first (N more villagers)".

**Grand Keep:** 5 stages; stage costs (planks, bricks): (30,15) / (60,40) / (120,80) / (200,140) / (320,220). Contribute EITHER good from wallet. Pot per stage = stage × 400 coins split pro-rata by contributed units (min 25/contributor), paid lazily as v1. Stage buffs +3% village-wide production each. Stage naming rights to top contributor (word-list picker, stored on city state, shown on plaque).

**Trader:** daily seed → 3 global offers (deterministic per day): each `{give: {good,qty}, get: {good,qty}}` generated from a table with ±rarity; 15% chance one offer slot is a rare cosmetic (golden roof for a named building tier — cosmetic flag on tile). 1 accept per player per day.

**Weather:** daily roll (seeded): sunny(45%) +10% all · rain(30%) +30% wheat+logs, buildSeconds ×1.25 · clear(20%) no effect · harvestmoon(5%) +50% all. Shown in HUD chip + daily post. Multipliers apply in accrue.

**Redis additions:** `city:stockpile` hash good→qty; `city:market` hash good→lastPrice; `wallet` merged into player hash (6 numeric fields); `trader:{date}` hash offers json + `traderdone:{date}:{userId}`; city:state gains `weather`, `weatherDate`, `stageNames` (json), `ringBounds` cache, `population` (distinct owners cache).

**API changes:** `/api/state` response gains `stockpile`, `prices`, `weather`, `trader` (today's offers + accepted flag), `ring` bounds; `POST /api/sell {good, qty}`; `POST /api/buy {good, qty}`; `POST /api/trade {offerIndex}`; contribute becomes `{good: 'planks'|'bricks', qty}`; vote categories updated. All other endpoints keep shapes (collect gains may include goods: extend `Gained` = {coins, xp, goods: Partial<Record<Good, number>>}).

---

### Task V0: Asset pipeline (Kenney sprites into repo)
Packs already downloaded at `/private/tmp/claude-501/-Users-romariokavin-Documents-RandomClaudeSessions/617541b3-325e-4547-a90f-40637f5d21b7/scratchpad/kenney/` (kenney_sketch-town, kenney_sketch-town-expansion, kenney_game-icons, also miniature packs — IGNORE miniature packs).
- Select ONLY `_N` direction sprites needed (grass/dirt terrain set incl. full path+river routing, slopes/cliff edges; building bases center/door/window/windows/stack ×2 colors; all 6 roof shapes ×4 colors (+corner variants NOT needed); castle_* for Keep stages; tree_single/multiple/pine, rocks, well, fence_wood basic, furrow set, bridge, structure_arch) → ~110 files.
- Downscale ALL to 128px wide (sips -Z or --resampleWidth 128; preserve aspect → 128×176) into `public/sprites/`, kebab-named. Total must be < 8 MB (report actual).
- Game-icons: pick ~14 white icons for UI (coin/star/gear/etc per manifest below) into `public/icons/` at 64px + we also use goods mini-sprites for resource chips: crop 40×40 center crops? NO — simpler: goods chips use small PNGs cut from sprites via sips crop is fiddly → use the full sprite scaled down in an <img> (they have transparent bg) — fine, list them in the manifest.
- Create `src/client/art/manifest.ts`: `export const SPRITES: Record<SpriteKey, string>` mapping semantic keys (terrain_grass, terrain_path_bend, river_straight, base_door_red, roof_gable_green, keep_stage_3, decor_well, icon_coin, good_wheat …) → `/sprites/...` paths, with a type-safe SpriteKey union. Building composition map: `export const BUILDING_ART: Record<BuildingId, {base: SpriteKey; roof: SpriteKey; tierRoof: Record<Tier, SpriteKey>}>` — distinct silhouette per catalog v2 id (12 ids: cottage,wheatfield,grove,quarry,windmill,sawmill,kiln,bakery,well,trees,fountain,manor — wheatfield uses furrow sprites not base+roof; grove/trees use tree sprites; quarry uses rocks+dirt; document special cases).
- Delete NOTHING yet (old art files removed in V3). Gates green (manifest compiles), commit `feat: bundle kenney sketch-town sprite pipeline (CC0)`, push. Report actual MB added.

### Task V1: Shared domain v2
Files: rewrite `src/shared/catalog.ts` (catalog v2 table above + Good type + market bases/targets + expansion thresholds + keep costs + trader table + weather table), extend `src/shared/types.ts` (Good, Wallet, Stockpile, Prices, Weather, TraderOffer, Gained v2, CityState v2 fields, PlayerState wallet fields, festival categories v2), new `src/shared/logic/market.ts` (priceFor(stock,base,target), sellValue, buyValue), `src/shared/logic/expansion.ts` (ringBounds(population), isUnlocked(x,y,population), riverTiles list + isRiver), extend `economy.ts` (accrue v2: role-aware output incl. processor potential [pure — stockpile passed in], adjacency v2 with chain synergy + river, weather multiplier), `src/shared/logic/trader.ts` (offersForDay(seedDate), weatherForDay(seedDate) — deterministic PRNG from date string, e.g. mulberry32(hash(date))).
TDD: tests for every formula with hand-computed values (price at stock 0/target/2×target; clamps; ring bounds at 2/3/6/12/20 owners; processor starvation math; chain adjacency stacking cap +1.0; weather determinism same-day; trader offer determinism). Update existing v1 tests to v2 catalog (many will change — that's expected; keep test intent).
Commit `feat: v2 shared domain — goods, market, chains, expansion, trader, weather`, push.

### Task V2: Server v2
Rewrite affected parts of `store.ts` (stockpile/market/wallet/trader keys), `village.ts` (collect v2 with processor stockpile pull + price movement + weather; sell/buy/trade ops; claim expansion gating; contribute v2 goods+pro-rata pot+naming; population cache update on claim; ring-unlock detection → broadcast `{t:'ring', bounds}` + celebration comment via app account), `api.ts` (new endpoints, state v2), `scheduler.ts` (weather roll + trader refresh + market report/weather in daily post title/body), types in shared VillageMessage (+`{t:'market', prices, stockpile}` broadcast on trades, throttled: only broadcast if price changed).
TDD on pure helpers (extracted as v1 did). Wipe-safe: fresh install seeds v2 city state.
Commit `feat: v2 server — market, chains, expansion, keep, trader, weather`, push.

### Task V3: Scene v2 (Sketch Town renderer)
Rewrite `Village.ts` rendering internals + `art/` (delete pixels.ts/buildings.ts/tiles.ts/landmark.ts runtime-gen; keep ArtDebug repurposed to grid-preview all manifest sprites): preload manifest PNGs in Preloader (loading bar); terrain = grass blocks (256-scaled iso 2:1 — TILE_W/H from sprite aspect: top face of Sketch Town blocks is 2:1 at y-offset; document the anchor math), path ring + plaza, river tiles (routing from rivermap), locked tiles = dirt_low + cliff edge at ring boundary (+ subtle desaturation), buildings per BUILDING_ART composition (stack base+roof as two sprites in a container, tier variations), keep = castle composition per stage on plaza, furrow crops for wheatfield with growth states (2 states: growing/ready via furrow vs furrow_cropWheat), construction = structure_low scaffold sprite, decor trees/well/fountain sprites, boost/ready pips as icon sprites (no drawn rects). Depth sort by sy unchanged. Ring-unlock event: camera pans out + new ring pops in with staggered tweens.
Keep ALL interaction/net/store logic — this is a renderer swap. Gates green (this is the riskiest visual task — self-review hard against manifest keys), commit `feat: sketch-town diorama renderer`, push.

### Task V4: HUD v2 + de-emoji
`ui/` rework: ALL emojis replaced with `<img>` sprite icons (manifest icon_*/good_* keys). Top bar: coins + level ring + weather chip + festival chip. NEW wallet drawer (6 goods with counts). NEW Market sheet (price list with trend arrows [sprite arrows], sell qty steppers per good, buy at markup, stockpile bars, "what the village needs" callout = most expensive good). Trader sheet (3 offer cards, accept once/day, rare glow). Keep sheet v2 (stage costs in planks/bricks, contribute steppers per good, pro-rata pot explainer, plaque with stage names + top contributors, naming picker for eligible top contributor). Tile sheet v2 (chain info: inputs/outputs, starvation warning when stockpile lacks inputs, synergy hints "adjacent to Windmill +25%"). Ballot categories v2. Onboarding copy v2 (chain-aware: suggests wheatfield first). Ring-unlock toast + "N villagers until more land" line in menu.
Commit `feat: v2 HUD — market, trader, wallet, keep, no emojis`, push.

### Task V5: Splash + daily post + README v2
Splash: restyle CSS scene to sketch-town palette (warm paper/ink look), stats line v2 (villagers, keep stage, today's weather + hottest good price — extend /api/summary), CTA unchanged. Daily post body: market report + weather + trader teaser. README: v2 mechanics, art credit "Kenney (kenney.nl) — CC0", updated how-to-play. Remove dead splash focus-visible + rgba shadow minors from v1 review.
Commit `feat: v2 splash, daily post, README`, push.

### Task V6: Gates + final review + playtest
Full suite, whole-branch review of v2 diff (fable), fix wave, `devvit upload` new version, fresh install to r/hearthvale_dev, browser verification pass (user assists with the Enter click if needed).
