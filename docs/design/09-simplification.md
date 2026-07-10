# The Great Simplification (S1)

**Date:** 2026-07-10 · **Trigger:** user playtest — "not entertaining, too complex. Think like a gamer, remove things."

## Diagnosis

The v2 economy is deep but the player-facing surface asks too much. To earn a coin a
player had to: collect goods into a private wallet, open the Market, read moving prices,
pick a good, pick a quantity, sell, then maybe visit the Trader and the festival Ballot.
Five taps and three sub-systems stand between "my field is ripe" and "I got paid". A first-
time visitor bounces before the loop ever closes.

The new player-facing loop is one gesture:

> **Tap a ripe building → coins pop instantly.**

The market simulation stays underneath (prices still move with supply, processors still pull
inputs from the shared stockpile); only the *manual* inventory/trading busywork is cut.

## What is cut, and why

1. **The private goods wallet + manual selling.** Raw producers (wheat / logs / stone) and
   the windmill (flour) now **auto-sell** their output the instant you collect: the units
   flow into the village stockpile and you are paid `sellValue(units, stockBefore, good)`
   coins on the spot. Prices still move exactly as a manual sale would move them, so the
   living market survives — the player just never has to operate it. Auto-sell coins now
   count as production income (they feed `lifetimeEarned` / the `lb:earned` board): this is
   a harvester's honest wage.
   - The **bakery** is unchanged (it already minted coins by buying flour from the stockpile).
   - The **sawmill / kiln** still deposit **planks / bricks** into the wallet — these are the
     only held goods now, because they are the Village Hall building material. They are shown
     as two small chips in the top bar (only when nonzero) and beside the Hall's contribute
     steppers.
   - The windmill no longer needs upfront coins to buy wheat: like the bakery it simply nets
     its flour revenue against the wheat it consumes (floored at 0), removing the confusing
     "your windmill made nothing because you were broke" failure mode.
   - `Wallet` stays a 6-good record internally (no store migration), but wheat/logs/stone/
     flour can never accumulate again; the UI only ever surfaces planks + bricks.

2. **The wandering Trader is retired.** One-swap-a-day added a daily chore and a whole sheet
   for a marginal payoff. The `/api/trade` endpoint now returns HTTP 410 ("The trader has
   left the village."); the sheet, menu entry, and net wrapper are gone. The golden-roof
   cosmetic rendering stays (harmless) — it simply has no new source.

3. **The festival Ballot is retired.** Voting for tomorrow's ×1.5 category was a second daily
   chore most players never found. The festival now **auto-rotates** each day
   (coins → raw → processed → decor) in the daily cycle — no tally, no vote. `/api/vote`
   returns 410. The `votesCast` counter is kept (cheap hash field, avoids migration) but no
   quest reads it anymore.

4. **Two top-bar chips become one "Today" chip.** Weather and festival were two separate
   chips competing for space; they merge into a single compact chip — icon + e.g.
   "Today: Rain · Craft ×1.5" — whose tooltip explains both effects.

5. **The Market sheet becomes a read-only "Village Market" info panel.** Price list with trend
   arrows, the "the village needs X" callout, stockpile bars, and a one-line explainer
   ("Your harvests sell here automatically — prices rise when the village runs short."). All
   sell/buy steppers are removed; `/api/sell` and `/api/buy` return 410. `sellValue` /
   `buyValue` / marginal maths stay in `shared/logic/market.ts` (auto-sell uses `sellValue`).
   The wallet drawer and coins-chip caret are gone.

## Quest chain (v3)

The chain shrinks from 18 to 16 (the vote and trader quests are removed) and two "sell"
quests become "harvest/earn" quests that the auto-sell loop feeds naturally:

- **q4** "Sell 10 goods" → **"Earn 60 coins from your harvests"** (`lifetimeEarned ≥ 60`).
- **q9** "Sell 60 goods" → **"Harvest 150 goods"** (`soldUnits ≥ 150`).
- Repeatable "Sell another 250 goods" → **"Harvest another 400 goods"** (same `soldUnits`).
- The `soldUnits` field is **reused** as the harvest counter: it is bumped by the number of
  units auto-sold on every collect (field name kept to avoid migration; display renamed).
- The vote quest (old q13) and trader quest (old q14) are deleted.

## Non-goals / kept

- The economy simulation, adjacency chains, weather multipliers, Village Hall progression,
  homestead settling, boosts, check-in streaks, leaderboards, quests, and paintable roofs all
  stay. xp still accrues on production *before* auto-sale. This change is purely a removal of
  player-facing operation, not of depth.
