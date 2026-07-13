# Design: Expression pack — Village Mural, Villager Outfits, Village Crest

**Date:** 2026-07-13 · **Trigger:** user — "subreddits should build their own simple murals… see a difference in every subreddit" + more customization.

## 1. The Village Mural (headline — a mini r/place in every village)

- **Canvas:** 24×16 pixels. **Palette:** 12 fixed colors (drawn from PAL + the 4 roof hues + white/black-ish ink). Stored as redis hash `mural`: field `"x,y"` → color index 0-11; absent = parchment blank.
- **Painting:** every player gets **12 pixels per UTC day** (counter `muralToday`/`muralDate` on player). `POST /api/mural {x, y, c}` paints ONE pixel immediately (r/place feel), validates bounds/color/budget, broadcasts `{t:'mural', x, y, c}`. Overwriting others' pixels is allowed (that's the game). Monotonic counter `muralPixels` on player for quests.
- **In the world:** a wooden mural board stands on the plaza ring tile just north-east of the Hall — composed from existing sprites (side posts + a frame) with the mural itself rendered as a live Phaser canvas-texture (each pixel ≈ 4×4 screen px at zoom 1; updates in place on realtime message). Tapping the board opens the Mural sheet.
- **Mural sheet:** zoomed grid editor — palette row (12 swatches), tap-to-paint cells, live updates from other players, "N pixels left today" counter, and a subtle grid. No erase (paint over with blank color = one of the 12 is "parchment").
- **Journal:** insert one quest after the check-in rung: "Leave your mark — paint 3 mural pixels" (metric `muralPixels` ≥ 3, reward 30c).
- **Why:** the single most Reddit-native expression mechanic possible (r/place is the site's defining collective act); guarantees every subreddit's village LOOKS different at a glance; creates comment-thread coordination ("we're drawing the sub's logo").

## 2. Villager outfits (personal identity)

- Player picks an **outfit color** (8 choices) — their walker wears it. Walkers map deterministically: the k-th house's owner's outfit colors walker k (fallback: current variant scheme).
- Stored on player (`outfit: 0-7`, default hash-of-id). Set from a small "My villager" section at the top of the Journal sheet (8 swatch buttons + a live preview of the walker sprite).
- `POST /api/outfit {c}` — free, once whenever.
- **Why:** "the little one in red is me" — parasocial glue, zero economy impact.

## 3. Village crest (mod identity, visible from the feed)

- Mod "Village settings" form gains: **crest emblem** (6 options: star/trophy/scroll/home/hammer/coin — existing icons) + **banner color** (4: red/green/blue/gold).
- Rendered: a pennant flag on the Hall (pole + colored triangle + small emblem) — visible at every Hall level; splash shows a small crest chip beside the village name; stored on city (`crest`, `crestColor`).
- **Why:** subreddit-level branding that shows up in the feed screenshotted moments.

## Scope guard

IN: the three above. OUT: path styles, building plaques, seasonal decor sets, mural size upgrades (post-hackathon). No new assets required — all composed from existing sprites/icons/palette.
