# Devpost Submission Draft — Hearthvale

**Submission form fields** (https://redditgameswithahook.devpost.com — deadline July 16, 6:30am IST)

- **App listing:** https://developers.reddit.com/apps/hearthvale
- **Demo post:** [newest post on r/hearthvale_dev — grab the direct post URL] (make subreddit PUBLIC first: Mod Tools → Settings → Community type → Public)
- **Video:** [YouTube link, ≤ 1 min]
- **Repo (optional):** flip github.com/RomarioKavin1/hearthvale to public if desired
- **Categories:** Best App with a Hook · Best Use of Retention Mechanisms · Best Use of User Contributions

---

## Inspiration

Every subreddit is already a village — people show up daily, tend their corner, and build something none of them could alone. We wanted a game where that's literal: one persistent world per subreddit that only grows if the community grows.

## What it does

Hearthvale gives every subreddit its own floating-island village. You found a homestead, farm and craft on real-time timers, and sell into a village market where prices move with scarcity — your wheat literally feeds your neighbor's windmill. Everyone contributes planks and bricks to raise the Village Hall: each level needs both resources AND population, and pays back with land expansions, village-wide perks, and a castle that visibly grows at the center of the map. A guided tour walks new players from first tap to first sale; a quest journal hands you the next goal for your first two weeks; streaks, daily weather, festivals, and golden "perfect harvest" windows give every day a reason to come back.

## The hook

Four things change while you're away: your timers finish, market prices move, the Hall inches forward, and the weather/festival roll over — and the daily auto-post puts that delta in the feed. The deeper hook is social: land only unlocks when more villagers join, so every player becomes a recruiter, and every subreddit's village (terrain, economy, hall progress, even its name and theme — mods customize both) is unmistakably theirs.

## How we built it

Devvit Web + Phaser 4 for the isometric world (Kenney's CC0 Sketch Town art, seeded terrain generation so every village's map is unique), a Hono serverless backend with all state in per-installation Redis, realtime channels for live neighbor activity, and the scheduler for daily weather/festival posts. All production math is lazy (computed from timestamps — no ticking), the market uses marginal pricing (structurally arbitrage-proof), and 249 unit tests cover the economy. We also built a local mock-server harness so the whole game is playable outside Reddit for fast iteration.

## Challenges

Making a co-op economy legible in 30 feed-seconds. We cut two full systems (a trader, festival voting) after playtests showed they added complexity without joy, rebuilt onboarding three times (tutorial → journal → guided spotlight tour), and redesigned the collective goal into a single Clash-of-Clans-style Village Hall when players couldn't see what the village was working toward.

## Accomplishments

A real interdependent economy (specialize, trade through the stockpile, chase shortages) that a first-timer can enjoy without understanding; a world that visibly grows with its community; and a game that looks hand-crafted — no two villages alike.

## What's next

Village orders board (Hay-Day-style co-op requests), seasonal events, cross-village visiting, and more Hall levels with mod-configurable perks.

## Built during the hackathon

Everything — first commit June 17-equivalent [adjust: repo history starts July 7], ~60 commits, all systems, art integration, and onboarding built within the submission window.

---

### Category pitches (if the form asks)

- **Hook:** timers + moving prices + collective Hall + population-gated land = anticipation between every session.
- **Retention:** daily weather/festival/streak/quests + auto-posted daily thread with the market report.
- **User contributions:** the village IS user-generated — every building, sale, contribution, Hall level name, roof color, and the map's growth come from players; milestones post back into the thread as comments.
