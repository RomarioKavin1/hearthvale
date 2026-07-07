# Hearthvale v2 — Game Design (mechanics rework)

**Date:** 2026-07-08 · **Status:** approved direction (user feedback: v1 mechanics "boring", art "not appealing", emojis out)

## 1. Diagnosis: why v1 is boring

v1 is a **parallel solo idle game**: every player runs an identical, self-contained loop (build → wait → collect). The social features (boost, contribute) are *optional garnish* — nothing another player does changes what YOU should do. In game-theory terms: **players' payoff functions are independent**, so there is no strategy, no negotiation, no emergent story. Timers alone are a retention tax, not a hook.

## 2. Design thesis

Make players **need each other asymmetrically**. Every mechanic below creates *interdependence* (my choice changes your best move), *scarcity* (meaningful choices), or *anticipation* (a reason tomorrow will be different from today).

## 3. Core systems

### 3.1 Production chains (interdependence)

Three chains, each: RAW → PROCESSED → SOLD/USED.

| Chain | Raw producer | Raw good | Processor | Processed good | Sink |
|---|---|---|---|---|---|
| Grain | Wheat Field | 🌾wheat | Windmill | flour | Bakery → bread (coins!) |
| Wood | Forester's Grove | logs | Sawmill | planks | Landmark stages + upgrades |
| Stone | Quarry | stone | Mason's Kiln | bricks | Landmark stages + upgrades |

(No emoji in the UI — icon sprites; table emoji here for doc readability only.)

- **Processors pull inputs from the VILLAGE STOCKPILE, not your private stash.** A windmill grinds whatever wheat villagers have sold into the stockpile; a village of only bakers starves.
- **Why it matters (game theory):** this is *comparative advantage*. A player can't run a full chain efficiently on ≤5 plots — specializing and trading strictly dominates going it alone (gains from trade). Co-op stops being a button and becomes the **economically rational strategy**. Specialist identities emerge ("I'm the flour guy") — identity drives return visits and comment-thread coordination ("we need another quarry on the east side!").
- **Free-rider counterweight:** processors pay the stockpile price for inputs automatically — sellers earn passively when their goods are consumed. Contribution is *paid*, not altruistic.

### 3.2 Village market with moving prices (strategy + legibility)

One market board per village. Each good has a price that moves with stockpile scarcity:
`price = base × clamp(1.9 − stock/target, 0.6, 1.8)` (tuned per good; recompute on trade).

- Sell raw goods to the stockpile at the current price; processors buy from it automatically.
- **Why it matters:** prices are a *coordination signal* readable at a glance ("planks are 1.8× — the village needs wood"). Classic supply/demand turns collecting into deciding: sell wheat now at 0.7×, or hold and build a windmill? It also self-balances the economy — whatever the village lacks becomes lucrative, recruiting players into the gap without any scripting.
- Daily "market report" line in the auto-post → feed content that changes daily.

### 3.3 Population-gated land expansion (scarcity + the virality engine)

The village starts as a **7×7 clearing**. New concentric rings unlock when the *villager count* crosses thresholds: 3 → 9×9, 6 → 11×11, 12 → 14×14, 20 → 18×18 (with river tiles and prime spots appearing in outer rings).

- Plot claims per player stay level-gated (1 + up to 4), so land is **genuinely scarce between unlocks**.
- **Why it matters (virality):** the ONLY way to get more land is *more villagers*. Existing players are mechanically incentivized to recruit — share the post, drag friends in, comment on crossposts. Each ring unlock is a celebration event (realtime confetti + auto-comment + fresh land rush). Scarcity → land-rush moments → FOMO → shares. This converts retention pressure into acquisition pressure, which is exactly what "apps that create recurring content see better growth" rewards.
- River/prime tiles give **location value** (see 3.4) so land rushes have real stakes.

### 3.4 Placement matters (spatial co-op)

- **Adjacency synergies:** Wheat next to Windmill +25% rate; Windmill next to Bakery +25%; same for wood/stone chains. Decor (well, trees kept as decor pieces) auras stay (+10%/tier).
- **River tiles:** +50% to any raw producer built adjacent (limited supply, appear in outer rings).
- **Why it matters:** placement becomes a spatial puzzle *between* players — your windmill is worth more next to MY wheat field, so neighbors negotiate placement in comments. Cheap system (one adjacency check we already have), big coordination surface.

### 3.5 The Grand Keep (public good, sharpened)

Landmark becomes the **Grand Keep** (castle set, 5 stages: foundation → walls → gate → towers → banners). Stages consume **planks + bricks** (processed goods only — ties the public good to the chains).

- Contributions are public: stage plaque lists top-3 contributors; #1 gets **naming rights** for the stage (word-list picker).
- Stage payout is **proportional to contribution share** (pot = stage × 400 coins split pro-rata, min 25 per contributor) — no flat free-rider payout.
- Completed stages give **village-wide production +3% each** (max +15%) — a true public good everyone enjoys.
- **Why it matters:** this is a textbook public-goods game, solved the way real communities solve it (Ostrom): visible reputation + proportional reward + collective benefit. The tension between "sell planks at 1.8×" and "donate planks for the Keep" is a real strategic dilemma every day.

### 3.6 The Wandering Trader + daily weather (variable-reward hook)

Daily scheduler already rotates festivals; add:
- **Wandering Trader** (appears on the plaza, 1 offer/day/player, offers rotate daily): swap deals ("6 logs → 4 bricks"), rare decor pieces, discounted building permits. Occasionally (15%) a **rare cosmetic** (golden roof variant).
- **Weather** (daily, affects everyone): Sunny +10% all · Rain +30% wheat/logs, −construction speed · Harvest Moon (rare) +50% everything for 2h at a scheduled time (posted in advance — an *appointment mechanic*).
- **Why it matters:** variable-ratio rewards (trader rares) are the strongest known return trigger; weather makes every day *feel* different with zero content authoring; Harvest Moon creates synchronized "everyone online together" moments — communal joy, screenshot-able.

### 3.7 Kept from v1 (already built, still good)

Check-in streaks · festival ballot (now with weather interplay) · boosts (now also grant the booster 1 random raw good) · leaderboards (value/earned/contributed) · flair titles · share-to-comments · daily auto-post (now includes market report + weather + trader teaser).

## 4. The hook, stated plainly

Between sessions, FOUR things change without you: your timers finish, **prices move**, **the stockpile/Keep progress**, and **weather/trader roll over**. Any of them can create "I should check" — and the daily post puts that delta in the feed. Within a session, the loop is decide (what's scarce?) → place/build (where's synergy?) → sell-or-donate (market vs Keep) → coordinate (comments). Decisions, not just collection.

## 5. Art direction v2 (user feedback: v1 sprites + emojis rejected)

- **Kenney Sketch Town + Expansion (CC0)** — hand-drawn isometric diorama blocks, 256×352 sprites on wooden-stilt bases. Colorful, cohesive, professional; zero license risk.
- World = floating diorama island (grass blocks with visible stilt undersides at the edges — built-in charm).
- Buildings composed as **terrain block + building base (2 wall colors) + roof (6 shapes × 4 colors)** → each catalog entry gets a distinct, recognizable silhouette; tiers change roof color/shape + add details (balcony, stack floor).
- Rivers/paths use the full routing tile sets; crops use furrow sprites; Keep uses the castle set; trees/rocks/fences/well as decor.
- **All UI emojis replaced** with sprite icons (Kenney game-icons pack + tiny renders of the goods themselves for resource chips).
- Palette-derived UI stays (cream cards/ink text) but headers/chips get sprite icons.

## 6. Scope guard (8 days to deadline)

IN: 3 chains (6 buildings) + bakery/market/keep + expansion rings + trader + weather + adjacency + re-skin + de-emoji.
OUT (explicitly): player-to-player direct trades (market mediates), negative externalities, animals/pets, seasons beyond festivals, cross-subreddit anything, payments.
Buildings total: 6 chain + bakery + 3 decor + cottage (coins trickle + population) + manor ≈ 12 (same count as v1 — catalog rework, not expansion).

## 7. Migration note

Dev subreddit state will be wiped (fresh install) — no live players yet, no migration needed. `supplies` resource → replaced by per-good wallet {wheat, logs, stone, flour, planks, bricks}.
