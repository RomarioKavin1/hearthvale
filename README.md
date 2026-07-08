# Hearthvale

A cozy village your whole subreddit builds together — and it only works if you build it together.

Hearthvale is a shared, persistent village that lives inside a single Reddit post. Everyone in the subreddit settles plots on the same island, but nobody can run the whole economy alone. Wheat has to become flour before it becomes coins. Planks and bricks have to be crafted before the village can raise its Keep. The market pays the most for whatever the village is short of right now. So people specialize — one player floods the stockpile with logs, another runs the sawmill, a third donates planks to the Keep — and the town grows out of everyone's small daily choices. Part village-builder, part market, part town square.

## What it is

- **A shared village.** One island, one economy, everyone plays on the same map in real time.
- **Production chains.** Raw goods become processed goods become coins or buildings. Wheat → flour → bread. Logs → planks. Stone → bricks.
- **A living market.** Every good has a price that moves with supply. Sell what's scarce, and the whole village can read at a glance what it needs next.
- **The Grand Keep.** A five-stage castle the community raises together with planks and bricks — the shared goal no single player can finish.

## How to play

1. **Settle.** Claim an open plot and place a building. A wheat field, a forester's grove, or a quarry is a good first move — the village always needs raw goods.
2. **Produce.** Buildings fill up on timers while you're away. Come back and collect. Raw producers make wheat, logs, or stone.
3. **Sell or process.** Sell raw goods into the village stockpile at the current market price, or build a processor — a windmill, sawmill, or kiln — that pulls those goods out of the stockpile and turns them into flour, planks, or bricks. Sellers earn automatically whenever a processor buys what they stocked.
4. **Place with care.** A windmill next to a wheat field earns more; so does a sawmill by a grove or a kiln by a quarry. Raw producers on a river tile do best of all. Decorations spread a smaller bonus to their neighbours.
5. **Build the Keep together.** Contribute planks and bricks to the Grand Keep. Each finished stage pays out a pot split by how much you contributed, buffs everyone's production, and lets the top contributor name the stage.
6. **Check the trader and the weather.** Every day brings new weather that shifts what's worth producing and a wandering trader with a fresh set of swaps — sometimes a rare cosmetic.
7. **Vote and check in.** Cast a daily vote for tomorrow's festival, and keep a check-in streak going for growing coin bonuses.

## Features

- **12 buildings across three production chains** — grain, wood, and stone — plus a bakery, cottages, a manor, and decor pieces.
- **A moving market** — prices rise as the stockpile runs low and fall as it fills, so the village's needs are always legible.
- **Population-gated expansion** — the island starts as a small clearing and unlocks new rings of land only as more villagers join. More land means recruiting more people.
- **The Grand Keep** — five stages built from planks and bricks, with pro-rata coin payouts, a village-wide production buff per stage, and naming rights for top contributors.
- **A wandering trader** — one swap offer per day, occasionally a rare cosmetic roof.
- **Daily weather** — sunny, rain, clear, or a rare harvest moon, each nudging production in a different direction.
- **Community festivals** — a daily ballot picks which category gets a ×1.5 bonus tomorrow.
- **Check-in streaks and neighbour boosts** — reward showing up and helping other players' plots.
- **Demolish and rebuild** — clear any building for a 50% coin refund, so no plot is ever a dead end.
- **Leaderboards and flair** — village value, lifetime earnings, and Keep contributions, with titles to match.
- **Per-subreddit customization** — moderators name their village and pick a colour theme (meadow, autumn, twilight, or pale) from a mod menu form, and any player can paint their building roofs one of four colours.
- **Mobile-first** — designed for the phone-sized Reddit feed, with a comfortable touch HUD.

## The hook

Hearthvale is built to bring people back, because four things change between sessions without you lifting a finger:

- **Your timers finish**, so there's always something ready to collect.
- **Prices move**, so what was cheap to sell yesterday might be the village's most wanted good today.
- **The stockpile and the Keep advance**, because other people kept playing while you were gone.
- **The weather and the trader roll over**, so every new day genuinely plays differently.

The daily post puts that change right in the feed — a market report, the day's weather, and a nudge that the trader has restocked. And because more land only unlocks with more villagers, the village grows fastest when players bring friends in.

## Tech

- **Devvit Web** — the whole game runs inside a Reddit post, client and server.
- **Phaser 4** — the isometric village diorama.
- **Redis** — the persistent village, market, stockpile, players, and leaderboards.
- **Realtime channels** — live tile, market, and city updates across everyone viewing the post.
- **Scheduler** — a daily cron rolls the weather, refreshes the trader, rotates the festival, and posts the day's village update.

## Credits

- **Art:** Kenney (kenney.nl) — CC0.
- **Font:** Fredoka (OFL).

## Playing / installing

Install Hearthvale on your subreddit and it creates the village post automatically. Moderators can also use the "Create a new post" menu action to start a fresh village at any time. Open the post, sign in with your Reddit account, and settle your first plot.
