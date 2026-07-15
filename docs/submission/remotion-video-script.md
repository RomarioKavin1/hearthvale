# Hearthvale — "One Village, Seven Days" · Demo Video Production Script v2

**Target:** 58 seconds · 1920×1080 · 30fps · Remotion (fully animated, real game sprites) + ElevenLabs VO
**Tone:** playful storybook time-lapse — a nature documentary about a village, with a wink.
**Core idea:** ONE continuous island that visibly GROWS across the whole video. A day counter flips 1→7; every flip, the camera returns to find the village bigger and busier than you left it. The hooks (timers, ready-piles, streaks, the daily post, the mural, the castle) are all *shown as reasons the village changed while you were away* — never named as mechanics.

---

## Asset manifest (all real, in `public/`)

| Use | Files |
|---|---|
| Terrain | `sprites/grass-center.png`, `grass-corner.png`, `grass-slope.png`, `grass-slope-convex.png`, `dirt-center.png`, `cliff.png`, `cliff-top.png` |
| Paths & river | `grass-path.png`, `grass-path-bend.png`, `grass-path-split.png`, `grass-path-crossing.png`, `grass-river.png`, `grass-river-bend.png`, `grass-river-bridge.png`, `water-fall.png`, `bridge.png` |
| Houses (variety!) | `building-door.png`, `building-window.png`, `building-windows.png`, `building-door-windows.png`, `building-stack.png` + `-beige` variants × roofs: `roof-gable-*.png`, `roof-point-*.png`, `roof-round-*.png`, `roof-rounded-*.png`, `roof-slant-*.png` (brown/green/purple/beige) — no two houses alike |
| Windmill | `mill-tower-base.png` + `building-stack.png` (sail cross is drawn in-game; in Remotion recreate: 4 tapered rects in a foreshortened container, scaleX 0.72, slow rotate) |
| Sawmill | `building-corner.png` base + log stack (cylinders from `rocks-dirt.png` stand-ins or draw 3 stacked logs matching ink style) + the saw-blade texture look (ink outline disc w/ teeth, two-tone gray) |
| Castle (Hall) | `castle-gate.png`, `castle-gate-open.png`, `castle-wall.png`, `castle-corner.png`, `castle-center.png`, `castle-tower-base.png`, `castle-tower-top.png`, `castle-tower-center.png`, `castle-window.png` |
| Crest flags | `crest-tower-brown.png`, `crest-tower-green.png`, `crest-tower-purple.png`, `crest-tower-beige.png` |
| Farm & nature | `furrow.png`, `furrow-crop.png`, `furrow-crop-wheat.png`, `fence-wood.png`, `fence-wood-corner.png`, `tree-single.png`, `tree-pine.png`, `tree-pine-large.png`, `tree-multiple.png`, `rocks-grass.png`, `well.png` |
| Desert cameo | `sand-center.png`, `desert-dome.png`, `desert-tent.png`, `palm.png`, `palms.png` |
| Ready bubble | `ui/round_brown.png` circle + good icon inside (recreate the in-game marker: parchment circle, icon at 72%, 2px sine bob) |
| UI chrome | `ui/panel_brown.png`, `ui/button_brown.png`, `ui/button_red.png`, `ui/banner_hanging.png` |
| Icons | `icons/icon-coin.png`, `icon-star.png`, `icon-streak.png`, `icon-scroll.png`, `icon-trophy.png`, `icon-arrow-up.png`, `icon-arrow-down.png`, `icon-hammer.png` |
| Font / colors | `fonts/fredoka.woff2` · `src/shared/palette.ts` (`night` bg, `cream` text, `ink` shadow, `glow` gold) |
| Iso math | tile 128×64: `x=(col−row)*64`, `y=(col+row)*32`, painter sort by y — same projection as the game |

**No screen captures needed** — fully animated from sprites (smoother, and the growth arc needs staged control a capture can't give). If you want one touch of realness, an optional 3s capture of the real post can replace the first half of S7.

**Music:** CC0 cozy folk loop, gentle tempo rise across the video (or two loops crossfaded: sparse → full band at S4), −18 LUFS, duck −6dB under VO.
**SFX:** soft pops (tiles/buildings landing), coin chimes, page-flip whoosh (day counter), single deep "thoom" (castle gate), "ta-da" (level-up), tiny brush stroke (mural pixels).

---

## ElevenLabs VO

Voice: warm, bright, a little mischievous ("Hope" or "Matilda"; stability ~0.45, style ~0.35, speed 1.02). Render each line as its own clip. Total speech ≈ 47s.

1. (0:00) "This is nowhere in particular. Population: one very optimistic redditor."
2. (0:06) "This is Hearthvale — plant something, wander off, and let time do the work."
3. (0:13) "Because when you come back… the village has been busy. Crops ripe. Mills turning. Little piles of *ready* everywhere."
4. (0:22) "Day three: neighbors. Real ones — from your subreddit. Her wheat feeds his windmill. His planks raise her bakery. Nobody prospers alone."
5. (0:32) "And when the whole sub pitches in — the castle grows. New land. New perks. Room for more neighbors."
6. (0:40) "Day five, someone started painting the town mural. It's the sub's logo. …We *think* it's the sub's logo."
7. (0:46) "By day seven it has a rhythm all its own — and every morning, the village news lands right in the feed."
8. (0:52) "Hearthvale. Watch your subreddit become a village."

---

## The spine: `<Island day={n}>` + `<DayChip>`

One Remotion component renders the island from a **per-day tile manifest** (day1 … day7). Each transition springs the NEW tiles/buildings in (drop from +400px, 40ms stagger, pop SFX) while everything existing persists — the village never resets, it only accumulates. A parchment **day chip** (`ui/round_brown.png` + Fredoka "Day 3") sits top-left and flips with a page-whoosh at each jump. The camera (scale+translate interpolation, gentle ease) slowly pulls back all video long as the island outgrows the frame — the single continuous shot IS the pitch.

A tiny sun/moon arc in the corner sweeps once per "day" so time visibly passes even within scenes.

---

## Scenes

### S1 · Day 1 — "nowhere in particular" · 0:00–0:06
Night-blue `night` bg, drifting 2px `cream` star dots. A 6×6 grass diamond assembles (spring drops, rising-pitch pops). ONE house (door + `roof-gable-brown`), one `furrow.png` plot, one `tree-single` swaying ±2°, one tiny villager (16×22 rounded body + circle head, 2-frame bob) standing very alone. Day chip flips to "Day 1". Caption bottom: *"population: 1"*.

### S2 · Title + time does the work · 0:06–0:13
Title **"Hearthvale"** (Fredoka 110px, cream, ink shadow) springs in with ±3° wobble; `banner_hanging.png` unfurls beneath: *"a village your subreddit builds together"*. Behind it, the sun arc sweeps: the furrow cycles `furrow.png` → `furrow-crop.png` → `furrow-crop-wheat.png` (cross-fades + 3 gold sparkles), and the villager walks off-screen (goes to bed — window light dims). Title drifts up and out.

### S3 · Day 2 — the return · 0:13–0:22 · **the anticipation hook, shown**
Day chip flips to "Day 2", morning light (bg warms slightly). The camera finds the SAME island but now: the wheat is golden, and THREE ready-bubbles (parchment circle + wheat/coin icons, 2px sine bob) hover over field, house, and the new well. Cursor-hand glides in, taps each bubble: coin bursts (8 `icon-coin` with gravity), counter top-right rolls up. Last tap lands on a gold sparkle → giant **"PERFECT"** (Fredoka, `glow`, 8° tilt, spring 0→1) + double burst. A windmill (`mill-tower-base` + stack + foreshortened sail cross) springs up beside the field, sails easing into a slow spin.

### S4 · Day 3 — neighbors · 0:22–0:32 · **the interdependence hook, shown**
Day chip → "Day 3". The island edge EXPANDS one ring (spring-drop grass). Four houses land, each visibly different (`roof-point-green`, `roof-round-purple`, `roof-slant-beige`, `roof-gable-green` on varied bases) + fences + a path snaking between them (`grass-path` pieces draw in tile-by-tile). Two villagers in different outfit colors walk the path. Then a 3s overlay: a dotted `glow` arc animates wheat-icon from HER field → HIS windmill, then plank-icon from his sawmill (log stack + ink saw blade visible) → her rising bakery (scaffold = `structure-low` → building pops). Small captions at each arc end: *"her wheat"* / *"his planks"*.

### S5 · Day 4 — the castle · 0:32–0:40 · **the collective-goal hook, shown**
Day chip → "Day 4". Center stage: contribution bar (parchment `panel_brown`, hammer icon) fills to full → **"ta-da"**. The Hall assembles in 4 beats: `castle-gate` slams (4px screen shake, "thoom") → walls+corners snap in → two `castle-tower-base` rise with `castle-tower-top` caps bouncing on → `castle-tower-center` keep crowns it, `crest-tower-green` pennant pops on top with a flag-wave wiggle. Simultaneously the island expands ANOTHER ring and two more houses + `tree-pine-large` cluster drop in at the new edge. Caption: *"Village Hall — Level 3 · new land unlocked"*.

### S6 · Day 5 — the mural · 0:40–0:46 · **the expression hook, shown**
Day chip → "Day 5". Camera pushes in on the mural board by the Hall (wood posts + parchment canvas). Pixels paint in one by one (brush-tick SFX, ~30 of them, accelerating) forming a crude smiling sun / upvote-ish doodle. Two villagers stand watching it, heads bobbing. Caption: *"the town mural — 12 pixels per villager per day"*. (That's the only mechanic number in the video; it earns its place.)

### S7 · Day 6→7 — the rhythm · 0:46–0:52 · **the daily-drumbeat hook, shown**
Quick two-beat montage on parchment cards flipping in (3D rotateY, snappy):
1. `icon-streak` + flame-orange "12-day streak" counter ticking up;
2. market card: wheat row with `icon-arrow-up` ticking price 5→7, plank row `icon-arrow-down`;
3. journal card: `icon-scroll` + a quest line checking off (`icon-check` stamps in);
4. then the cards sweep aside for a mini Reddit-feed frame (rounded card, upvote arrows) where a post slides in: *"Hearthvale Daily — market report & weather"* with tiny castle thumbnail. Day chip flips 6 → 7 during the sweep.

### S8 · Day 7 — pull-back finale · 0:52–0:58
The full island — now ~14 buildings, castle with crest flying, mural board, windmill spinning, walkers strolling, chimney smoke (3-circle drift loops), river + waterfall at the rim, one desert-corner cameo (sand tiles + `palm` + `desert-dome`) hinting no two villages match — does a slow 1.03× breathe as the camera finishes its pull-back. Warm dusk grade. Title re-springs: **"Hearthvale"** / *"build our village together"* / bottom `glow` line: *"now on Reddit → r/hearthvale_dev"*. Population counter in the day chip rolls 1 → 23. Hold 2s, music resolves.

---

## Remotion build notes

- `<Island manifest={DAYS[n]}>`: one component, seven manifests; each entry `{col, row, sprites[], enterFrame}` — spring on `frame - enterFrame`, painter-sort children by screen y. The camera is a single `interpolate(frame, [0, durationInFrames], [1.6, 0.85])` scale + translate on the island group with per-scene keyframe nudges (use easing `Easing.inOut(Easing.cubic)` — NO linear moves anywhere).
- Day chip: `<Sequence>` per day with a rotateX page-flip (spring) on change.
- Sprites via `staticFile('sprites/…')`; ready bubbles = `ui/round_brown.png` + icon child + `Math.sin(frame/16)*2` y-offset.
- Windmill sails: container with `scaleX: 0.72` + `rotate: frame * 0.5deg` inside — matches the in-game iso cheat.
- Villagers: two rounded rects + circle head, `translateY: frame % 16 < 8 ? 0 : 1` bob, position interpolated along path waypoints.
- Text: Fredoka via `@remotion/fonts` + `staticFile('fonts/fredoka.woff2')`.
- VO: 8 clips in `public/vo/`, `<Audio>` at the timestamps; music `volume={interpolate(...)}` with ducking envelopes at each VO in/out.
- Render: `npx remotion render Main out/hearthvale-demo.mp4 --codec h264` → upload to YouTube (public or unlisted), confirm <60s.

## Why this cut works (for your eyes, not the video)

Every retention mechanic appears as *cause of visible change*, never as a feature bullet: timers = S2/S3 (things ripened while away), collection dopamine = S3 (bubbles + PERFECT), social interdependence = S4, collective progression + land unlock = S5, creative ownership = S6, streak/quests/market pulse + feed re-entry = S7, and the growth arc itself = the whole video. The only mechanic stated aloud is the mural's 12 pixels — because it's charming, not because it's a spec.
