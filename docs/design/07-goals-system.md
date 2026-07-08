# Hearthvale — Goals & Motivation System (design addendum)

**Date:** 2026-07-08 · **Trigger:** user playtest feedback — "confusing, lacking obvious goals/motivations"

## Diagnosis

The v2 economy is sound but *undirected*. Four gaps:

1. **No goal ladder.** After the 5-step tutorial there is never again a "do this next". Working builder games keep a quest chain alive for the entire first week of play.
2. **No aspiration telegraphing.** Levels gate everything (buildings, plots) but nothing shows what the NEXT level unlocks, so XP feels pointless.
3. **The collective goal is buried.** The Grand Keep — the game's centerpiece — lives inside a menu sheet. Out of sight, out of motivation.
4. **Rewards lack ceremony.** Progress happens silently; nothing celebrates milestones or pays them.

## Design: the Villager's Journal

One sequenced **quest chain** with explicit rewards. Exactly ONE active quest at a time, always visible as a compact banner on the main screen. The tutorial merges INTO it (steps 1–5 of the chain replace the tutorial card — one system, one visual language).

### Quest chain (v1 ladder, ~18 steps then repeatable)

| # | Quest | Metric | Reward |
|---|---|---|---|
| 1 | Settle your first plot | owned ≥ 1 | 20c |
| 2 | Build a Wheat Field | wheatfield built | 15c |
| 3 | Collect your first harvest | collects ≥ 1 | 25c |
| 4 | Sell 10 goods at the Market | soldUnits ≥ 10 | 30c |
| 5 | Check in at the Hearth | streak ≥ 1 | 50xp |
| 6 | Reach level 2 | level ≥ 2 | 40c |
| 7 | Claim a second plot | owned ≥ 2 | 30c |
| 8 | Build a Grove or Quarry | raw buildings ≥ 2 | 50c |
| 9 | Sell 60 goods | soldUnits ≥ 60 | 60c |
| 10 | Build a processor (Windmill/Sawmill/Kiln) | processor built | 80c |
| 11 | Process 15 goods | processedUnits ≥ 15 | 50c + 50xp |
| 12 | Boost a neighbor's building | boostsGiven ≥ 1 | 25c |
| 13 | Vote for tomorrow's festival | votesCast ≥ 1 | 25c |
| 14 | Strike a deal with the trader | tradesDone ≥ 1 | 40c |
| 15 | Upgrade any building to tier 2 | tier2 owned | 75c |
| 16 | Contribute 20 planks or bricks to the Keep | lifetimeContributed ≥ 20 | 100c |
| 17 | Earn 1,000 lifetime coins | lifetimeEarned ≥ 1000 | 100xp |
| 18 | Reach level 4 | level ≥ 4 | 150c |
| 19+ | Repeatable tiers: "Earn another 2,500c" / "Sell another 250 goods" / "Contribute another 100 to the Keep" (rotating, scaling ×1.6 per lap) | — | scaling |

Rewards are **claimed by tap** (banner flips to a gold "Claim" state) — the click is the dopamine. Claim validates server-side and advances the chain.

### Surfacing (main screen)

- **Journal banner** (top-left, under the top bar, above the map): quest title, progress `7/10`, reward chip. Tap → Journal sheet (completed ✓ list, active highlighted, next two teased greyed-out). Replaces the tutorial card entirely.
- **Keep pill** (top-center under the bar): tiny castle icon + "Stage 2 · 64%" progress bar — the collective goal permanently in view. Tap → Keep sheet.
- **Level ring tap** → level sheet: "Level 3 unlocks: Sawmill, Bakery · Level 4: Kiln, 3rd plot" — the aspiration list.
- Quest completion: confetti burst + toast + banner flip. Big, warm, obvious.

### New player-state counters (server-bumped, cheap hash fields)

`collects`, `soldUnits`, `processedUnits`, `boostsGiven`, `votesCast`, `tradesDone`, `questIndex`, `questLap`. All monotonic. Everything else derives from existing state (level, plots, buildings from grid, lifetimeEarned, lifetimeContributed, streak).

### Why this fixes it

- **Second-to-second:** the banner always answers "what do I do now".
- **Session-to-session:** the chain reaches ~2 weeks of play; repeatable tiers + daily rituals (check-in/trader/ballot are quests too) cover the rest.
- **Social pull:** quests 12–16 deliberately route players INTO the social systems (boost, vote, trade, Keep) they'd otherwise never find.
- **Judge experience:** a judge sees a goal in the first second, completes 3–4 quests in ten minutes, each with a reward pop. Momentum is legible.

## Scope guard

IN: quest chain + counters + claim endpoint + banner/sheet + keep pill + level-unlock sheet + tutorial retirement.
OUT: branching quests, achievements page, badge art, per-quest icons beyond existing sprites, weekly village goals beyond the Keep (post-hackathon).
