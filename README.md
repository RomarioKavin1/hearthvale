# Hearthvale 🏡

A cozy pixel village your whole subreddit builds together — one plot at a time.

Hearthvale is a shared, persistent village that lives inside a single Reddit post. Every member of the subreddit settles their own plots on the same isometric map, raises cottages and gardens and workshops, and watches the whole town fill in around them in real time. Buildings produce coins and supplies on timers you come back to collect, neighbours boost each other's plots, and everyone pours supplies into one collective landmark — the Grand Clocktower — that the community raises together, stage by stage. It is part village-builder, part idle game, part town square.

## How to play

1. **Settle a plot.** Tap any open patch of grass to claim your first plot.
2. **Build.** Place a cottage, garden, bakery or workshop. Each one earns coins or supplies over time.
3. **Collect.** Buildings fill up while you're away — tap a ready one, or hit Collect All, to gather what they made.
4. **Boost your neighbours.** Spend a daily boost on someone else's building to double its output for 30 minutes (and earn a little coin yourself).
5. **Raise the clocktower.** Contribute supplies to the shared landmark. Every stage the village completes pays out coins to the people who helped build it.
6. **Vote for tomorrow's festival.** Cast a daily vote — the winning category's buildings produce ×1.5 all of the next day.
7. **Check in daily.** A daily check-in builds a streak, and longer streaks pay bigger coin bonuses.

## Features

- **12 buildings, three tiers each** — cottages, farms, bakeries, workshops and more, upgradeable from ★ to ★★★.
- **Adjacency bonuses** — place decorations next to producers to raise their output.
- **Community festivals** — a daily ballot decides which category gets a ×1.5 production bonus tomorrow.
- **A collective landmark** — the Grand Clocktower rises in five stages, with coin payouts to every contributor when a stage completes.
- **Leaderboards** — village value, lifetime earnings and clocktower contributions.
- **Daily streaks** — reward players for coming back day after day.
- **A live, shared village** — plots, builds and boosts from other players appear in real time.
- **Mobile-first** — designed for the phone-sized Reddit feed first, with a comfortable touch HUD.

## The hook

Hearthvale is built to bring people back. Buildings ripen on timers, so there's always something waiting to collect. A new festival is voted in every day, changing what's worth building. Daily check-ins grow a streak that's a little painful to break. And the clocktower is a goal no single player can finish alone — it only rises when the whole subreddit keeps showing up. Retention, daily ritual, and a shared long-term goal, all in one post.

## Tech

- **Devvit Web** — the whole game runs inside a Reddit post, client and server.
- **Phaser 4** — the isometric village scene.
- **Runtime-generated pixel art** — every sprite is drawn from code at load time, so the app ships with zero binary image assets.
- **Redis** — the persistent village, players, ballots and leaderboards.
- **Realtime channels** — live tile, city and festival updates across everyone viewing the post.
- **Scheduler** — a daily cron rotates the festival and posts the day's village update.

## Playing / installing

Install Hearthvale on your subreddit and it creates the village post automatically. Moderators can also use the "Create a new post" menu action to start a fresh village post at any time. Open the post, sign in with your Reddit account, and settle your first plot.

## Screenshots

<!-- screenshots: added after playtest -->
