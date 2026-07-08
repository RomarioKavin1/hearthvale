# Design delta: Homesteads + Village Hall (v3 core loop)

**Date:** 2026-07-08 · **Trigger:** user playtest — wants CoC-style town-hall progression, house-first settling, one legible village goal.

## 1. Homestead-first settling

- A player's FIRST claim auto-builds a **House** (new building id `house`) on that tile, free (no coin cost). The House is the player's anchor: 1 coin/min trickle, counts as population, not demolishable (error: "Your house is your home."), max tier 3 (upgrades give +1 coin/min and +2% to YOUR other buildings per tier — personal perk).
- Every SUBSEQUENT claim must be within **Chebyshev radius 2 of your House** (shared helper `nearHouse(grid, userId, x, y)`); error: "Build closer to your house (within 2 tiles)." → players form visible homestead clusters; neighborhoods emerge.
- Existing `cottage` id is REPLACED by `house` (cottage removed from catalog; art reuses the cottage composition). Migration: dev world is wiped (fresh install); no live players.
- Journal quest 1 becomes "Found your homestead" (claim → house auto-built), quest 2 unchanged (wheat field).

## 2. Village Hall (merges Keep + expansion + perks)

The castle in the plaza is now the **Village Hall**. ONE progression number: **Village Level 0→5**.

Upgrade to level N requires BOTH (shown as two bars on the Hall sheet):
- **Resources contributed** (planks+bricks, same KEEP_STAGE_COSTS as today)
- **Population** ≥ threshold: [2, 4, 8, 14, 22] for levels 1..5

On level-up (server detects both conditions met on contribute OR on claim that crosses population):
- **Land ring unlocks** (replaces raw population gating): bounds by village level: L0 [5,11], L1 [4,13], L2 [3,14], L3 [1,16], L4+ [0,17]. `ringBounds(villageLevel)` — expansion.ts reworked; locked-tile toast becomes "Upgrade the Village Hall to unlock this land."
- **Perks** (cumulative, shown on the Hall sheet): L1 +3% village production & Trader offers 3→4; L2 +6% & market sell cap 500→750; L3 +9% & +1 max plot for everyone; L4 +12% & boost limit 5→7/day; L5 +15% & golden Hall banner cosmetic on the map. (Implement the numeric perks via existing constants routed through a `hallPerks(level)` helper; visual banner via castle stage-5 sprite treatment.)
- Contributor pot per level unchanged (level × 400 pro-rata, min 25) + stage naming unchanged.

UI: the "Keep pill" becomes the **Hall pill**: "Hall L2 · resources 64% · villagers 6/8". The Hall sheet shows both bars, perks at next level ("Next: +6% production, bigger market batches"), contribute steppers, plaque. Daily post mentions hall level.

## 3. Why this is better

- ONE goal ladder for the village (CoC town-hall legibility) instead of two parallel systems (keep stages + invisible population rings).
- Population requirement makes recruiting explicit ("we need 2 more villagers to level up!") — the pill shows it permanently.
- Homesteads make the map read socially (clusters = people) and give claims spatial meaning.

## Numbers summary

- HALL_POPULATION: [2, 4, 8, 14, 22] (level 1..5)
- Ring by hall level: [5,11] / [4,13] / [3,14] / [1,16] / [0,17] (L4 and L5 share max bounds)
- House: free on first claim, 1 coin/min base, cap 60, build 10s, tier mult standard; personal aura +2%/tier to owner's other buildings (implemented in adjacency? NO — flat multiplier on owner's accrue potential via `houseBonus(ownerHouseTier)`; applied server-side with stage buff).
- Radius: Chebyshev ≤ 2 from own house tile.
