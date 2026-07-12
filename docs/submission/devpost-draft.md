# Devpost Submission — FINAL copy-paste pack

Form: https://redditgameswithahook.devpost.com → "Enter a Submission"
Deadline: **July 15, 2026, 6:00pm Pacific = July 16, 6:30am IST**

## Form fields

| Field | Value |
|---|---|
| Project name | Hearthvale |
| Tagline | A cozy village your whole subreddit builds together. |
| App listing | https://developers.reddit.com/apps/hearthvale |
| Demo post | https://www.reddit.com/r/hearthvale_dev/comments/1ut69an/hearthvale_build_our_village_together/ |
| Test subreddit | https://www.reddit.com/r/hearthvale_dev (⚠️ make PUBLIC before submitting) |
| Video | [YOUR YOUTUBE LINK — ≤1 min, public] |
| Repo (optional) | https://github.com/RomarioKavin1/hearthvale (⚠️ only if flipped public) |
| Categories | Best App with a Hook · Best Use of Retention Mechanisms · Best Use of User Contributions (+ Phaser if the form allows) |

## Text description (paste as the main description)

### Inspiration

Every subreddit is already a village — people show up daily, tend their corner, and build something none of them could alone. Hearthvale makes that literal: one persistent world per subreddit that only grows if the community grows.

### What it does

Hearthvale is a shared, persistent village living inside a Reddit post. Every member settles a homestead on the *same* map, farms and crafts on real-time timers, and trades in a village market where prices move with scarcity — sell your wheat and it fills the stockpile that your neighbor's windmill grinds into flour. Nobody can do it alone by design: the Village Hall — a castle at the center of the map — needs both pooled resources AND population to level, and each level unlocks new land, village-wide perks, and a visibly bigger castle for everyone.

This is a game about interaction, not solo play. Your prices are set by what others sell. Your windmill starves unless someone farms. Your boosts help neighbors' plots. New land arrives only when new villagers do — so every player becomes a recruiter. And the game talks back into the subreddit: milestones post as comments, level-ups and Hall stages offer one-tap share-to-comments, top contributors win naming rights over Hall levels, level titles become user flair, and a daily auto-post drops the market report and weather into the feed so the comment section becomes the village's town square ("we need two more villagers!", "bricks are paying triple, someone build a kiln").

A spotlight-guided tour walks brand-new players from first tap to first sale; a 17-goal quest journal hands you the next objective for weeks; streaks, daily weather, rotating festivals, and golden "Perfect Harvest" windows (tap during the sparkle for double) give every single day a reason to come back.

Every subreddit's village is unmistakably its own: seeded terrain generation makes each map unique, moderators set the village's name and color theme from a mod menu, and players paint their roofs.

### The hook

Four things change while you're away: your timers finish, market prices move, the Hall inches forward, and the weather/festival roll over — and the daily post puts that delta directly in the feed. The deeper hook is collective: land, perks, and the castle itself are gated on the village acting together.

### How we built it

Devvit Web + Phaser 4 for the isometric world (Kenney's CC0 Sketch Town art, per-village seeded terrain), a Hono serverless backend with all state in per-installation Redis, realtime channels for live neighbor activity, and the scheduler for daily weather/festival posts. All production math is lazy (computed from timestamps — no ticking); the market uses marginal pricing (structurally arbitrage-proof — verified by a 210-case property test); ~250 unit tests cover the economy. We also built a local mock-server harness so the full game is playable outside Reddit for fast iteration.

### Challenges we ran into

Making a co-op economy legible in 30 feed-seconds. We cut two complete systems (a wandering trader, festival voting) after playtests showed complexity without joy, rebuilt onboarding three times (tutorial → quest journal → spotlight tour), and redesigned the collective goal into a single Clash-of-Clans-style Village Hall when players couldn't see what the village was working toward.

### Accomplishments we're proud of

A genuinely interdependent economy (specialize, trade through the stockpile, chase shortages) that a first-timer can enjoy without understanding it; a world that visibly grows with its community; and a hand-crafted look where no two villages are alike.

### What's next

A village orders board (co-op requests), seasonal events, cross-village visiting, and mod-configurable Hall perks.

### Built during the hackathon

Everything — the project was started and completed entirely inside the submission window (~80 commits: economy, multiplayer server, renderer, onboarding, art integration, and a local dev harness).

## Category pitches (if asked per category)

- **Best App with a Hook:** timers + moving prices + a collective castle + population-gated land = anticipation baked into every session, and a daily post that surfaces the overnight delta in the feed.
- **Best Use of Retention Mechanisms:** daily weather/festival rotation, check-in streaks, quest journal, leaderboards, flair titles, and a scheduler-driven daily post with the market report.
- **Best Use of User Contributions:** the village IS user-generated — every building, sale, contribution, Hall-level name, roof color, and the map's own growth come from players, and their milestones flow back into the thread as comments.
- **Best Use of Phaser:** a full isometric diorama renderer in Phaser 4 — seeded terrain composition, depth-sorted building stacking, ambient life (villagers with walk cycles, smoke, butterflies), camera fit, and a golden-window timing mechanic — all inside a Reddit webview.

## Pre-submit checklist

- [ ] r/hearthvale_dev set to PUBLIC (Mod Tools → Settings → Community type) — REQUIRED
- [ ] Video recorded (script: docs/submission/video-script.md), uploaded to YouTube, link pasted
- [ ] (Optional) GitHub repo → public, link pasted
- [ ] (Optional) Developer feedback survey filled (qualifies for the $200 Feedback prize; one per entrant)
- [ ] Form submitted before July 15, 6:00pm Pacific
- [ ] (Nice-to-have) If the app review email arrives before the deadline and time permits: upload 0.0.19 so the listing shows the corrected README, re-publish (streamlined minor-update review)
