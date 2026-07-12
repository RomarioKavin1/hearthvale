# Hearthvale — Demo Video Production Script

**Target:** 58 seconds · 1920×1080 · 30fps · Remotion (animation) + ElevenLabs (VO) + 3 real gameplay captures
**Tone:** playful storybook narrator with a wink — think cozy-game trailer, not tech demo.

---

## Asset manifest (all real, already in the repo)

| Use | Path |
|---|---|
| Terrain blocks | `public/sprites/grass-center.png`, `dirt-center.png`, `grass-path.png`, `grass-path-bend.png` |
| River + falls | `public/sprites/grass-river.png`, `grass-river-bend.png`, `water-fall.png`, `bridge.png` |
| House | `public/sprites/building-door.png` + `roof-gable-brown.png` (stack, roof at −45px, −90px) |
| Wheat field | `public/sprites/furrow-crop.png` → `furrow-crop-wheat.png` (swap = "growth") |
| Grove/decor | `public/sprites/tree-single.png`, `tree-pine.png`, `tree-multiple.png`, `rocks-grass.png`, `well.png` |
| Castle (Hall) | `public/sprites/castle-gate.png`, `castle-wall.png`, `castle-corner.png`, `castle-tower-base.png`, `castle-tower-top.png`, `castle-tower-center.png` |
| UI chrome | `public/ui/*` (parchment panel, brown button, red banner), `public/icons/icon-coin.png`, `icon-star.png`, `icon-trophy.png`, `icon-scroll.png` |
| Font | `public/fonts/fredoka.woff2` (all on-screen text) |
| Colors | `src/shared/palette.ts` — bg `night`, cards `cream`, text `ink`, gold `glow`, accent `accent` |
| Iso math | tile W/H = 128/64: `x=(col−row)*64`, `y=(col+row)*32` — same projection as the game |

**Real captures needed (record from a fresh world; I wipe on request):**
- `cap_sell.mp4` — Market sheet: tap wheat row → Sell 10 → "+50 coins" toast (≈6s)
- `cap_perfect.mp4` — ripe field sparkles gold → tap → "PERFECT" + double burst (≈4s)
- `cap_tour.mp4` — fresh open: tour highlights two tiles → tap → house rises (≈6s)

**Music:** any CC0 cozy folk loop (e.g. Kevin MacLeod "Wholesome" or similar license-safe pick), −18 LUFS under VO, duck −6dB during lines.
**SFX:** soft pops (block landings), coin chime (bursts), single "ta-da" (castle finale). Kenney "Interface Sounds"/"UI Audio" packs are CC0 if needed: kenney.nl/assets/interface-sounds.

---

## ElevenLabs VO

Voice: warm, bright, a little mischievous (e.g. "Hope" or "Matilda", stability ~0.45, style ~0.35, speed 1.02).
Render each numbered line as its own clip for easy timing. Total speech ≈ 48s.

1. (0:00) "Once upon a scroll… there was an empty little island."
2. (0:05) "This is Hearthvale — a village your *whole subreddit* builds together."
3. (0:11) "Plant a homestead anywhere you like. A wheat field beside it. Then… give it a minute."
4. (0:19) "Tap when it's ripe — and if you catch the golden sparkle? *Double* harvest. Nice reflexes."
5. (0:26) "Sell at the village market, where prices rise when the village runs short. Your wheat feeds someone else's windmill. That's the whole trick — nobody prospers alone."
6. (0:36) "Together, you raise the Village Hall. Every level needs resources *and* villagers — and pays everyone back with new land, perks… and a much bigger castle."
7. (0:46) "Daily weather. Festivals. Streaks. A quest journal. And a tour that holds your hand for exactly as long as you want it to."
8. (0:52) "Hearthvale. Build our village together — on Reddit, now."

---

## Scenes (Remotion compositions)

### S1 · "Empty island" — 0:00–0:05 · animated
Night-sky bg (`night` + tiny twinkling 2px `cream` dots, slow opacity loops). A lone 5×5 diamond of `grass-center` blocks assembles: each block spring-drops from +400px with 40ms stagger (soft pop SFX per landing, pitch rising). One `tree-single` sways in the corner (rotate ±2°). Caption (Fredoka, cream, bottom-center): *"once upon a scroll…"*

### S2 · Title reveal — 0:05–0:11 · animated
Camera (scale+translate) pulls back; the island doubles outward with more spring-drops: paths (`grass-path`) snake in tile-by-tile, a river of `grass-river` slides in from the top edge ending in `water-fall` off the rim, `bridge` drops last. Title "Hearthvale" (Fredoka 120px, cream, `ink` soft shadow) springs in with ±3° wobble; red UI banner (`public/ui` banner) unfurls under it: *"a village your subreddit builds together"*.

### S3 · Homestead + field — 0:11–0:19 · animated → capture
(0:11–0:15) On the island: a gold rounded-diamond outline pulses on two candidate tiles (the game's highlight look). A cursor-hand (`public/cursors` pointer) taps one → `building-door` + `roof-gable-brown` spring-stack (roof lands with a bounce, dust puff = 6 fading `cream` circles). Beside it `furrow-crop` pops in, then cross-fades to `furrow-crop-wheat` with three tiny `glow` sparkles.
(0:15–0:19) Cut to **cap_tour.mp4** in a rounded-corner browser frame, slight zoom-in over its duration.

### S4 · Perfect harvest — 0:19–0:26 · capture → animated flourish
**cap_perfect.mp4** full-bleed. On the tap moment: Remotion overlay bursts 12 `icon-coin.png` sprites outward with gravity + a giant "PERFECT" in Fredoka `glow` with 8° tilt, spring-scaled 0→1. Coin chime.

### S5 · The market loop — 0:26–0:36 · capture + animated diagram
(0:26–0:31) **cap_sell.mp4** in the browser frame; when the toast fires, three `icon-coin` arc into a corner counter that ticks 0→50 (rolling digits).
(0:31–0:36) Animated mini-diagram on parchment (`public/ui` panel): `furrow-crop-wheat` → arrow → market stall icon (use `building-window` + `roof-round-brown` stack) → arrow → windmill (`building-stack` + `roof-point-brown`) with its potential-output icon; arrows draw on with dash-offset animation; small caption *"your harvest powers their workshop"*.

### S6 · Raise the Hall — 0:36–0:46 · animated (the centerpiece)
Center stage on the island: the castle assembles level by level in 5 beats synced to VO — (1) `castle-gate` slams down (screen-shake 4px), (2) `castle-wall` ×2 + `castle-corner` ×2 snap in, (3) two `castle-tower-base` rise, (4) `castle-tower-top` caps drop with bounces, (5) `castle-tower-center` crowns it with a `glow` radial flash + "ta-da". Meanwhile the island EDGE expands one ring of grass blocks (the land-unlock), three houses with different roof colors (`roof-gable-green/purple/beige`) pop in around it, and 4 tiny villagers (16×22 rounded-rect bodies + circle heads — same construction as in-game) walk the path with 2-frame bobbing. Progress bar UI above the castle fills as it builds: *"Village Hall — Level 5"*.

### S7 · The daily drumbeat — 0:46–0:52 · animated icon montage
Four parchment cards flip in sequentially (3D rotateY), each with an icon + word: 🌧 rain-cloud (draw with `cream` circles) *"weather"* · `icon-star` *"festivals"* · `icon-streak` *"streaks"* · `icon-scroll` *"journal"*. Cards settle into a neat row, then tilt playfully.

### S8 · End card — 0:52–0:58 · animated
The full island (now busy: castle, houses, fields, villagers, smoke puffs from chimneys — 3-circle drift loops) does a slow 1.03× breathe. Title re-springs: **"Hearthvale"** / subtitle *"build our village together"* / bottom line in `glow`: *"now on Reddit → r/hearthvale_dev"*. Reddit-safe: no external URLs. Hold 2s, music resolves.

---

## Remotion build notes

- One `<Island>` component renders sprite `<Img>`s at iso positions with per-block `spring({frame - delay})` drops — reuse for S1/S2/S6/S8 with different tile manifests.
- Depth = painter's order: sort children by `y` (same as the game).
- All sprite files load from `public/` via `staticFile()` — zero new art needed.
- Captures: place in `public/captures/`, use `<OffthreadVideo>`, wrap in a `BrowserFrame` component (rounded 16px, `ink` chrome bar, traffic dots).
- Text: register Fredoka via `@remotion/fonts` + `staticFile('fonts/fredoka.woff2')`.
- VO: drop the 8 ElevenLabs clips in `public/vo/`, sequence with `<Audio>` at the timestamps above; music bed with `volume={interpolate(...)}` ducking.
- Render: `npx remotion render Main out/hearthvale-demo.mp4 --codec h264` → upload to YouTube (public/unlisted), <60s verified.
