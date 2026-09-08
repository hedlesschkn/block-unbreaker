# Block Unbreaker

**Block breaker, played from the wrong side.**

In the original, you control the paddle and destroy the wall. Here you *are* the wall.
You never touch the paddle and you never touch the ball. You place blocks, and then you
watch an enemy paddle at the bottom of the screen refuse to let the ball die — volleying
it back up into your defenses, over and over, until either your Core is rubble or you've
found a way to make the paddle miss.

It looks like Arkanoid. It plays like castle defense.

Two or more players can enter the same room code and play simultaneously, watching each
other's boards crumble live.

---

## Status

| | |
|---|---|
| **Stage** | **Single player complete and playable.** Multiplayer not started. |
| **Live URL** | *Not deployed yet — needs `npx wrangler login` (see below)* |
| **Repo** | https://github.com/hedlesschkn/block-unbreaker |
| **Tests** | 172, all passing (`npm test`) |

**To put it on the internet**, authenticate once and deploy:

```bash
npx wrangler login && npx wrangler deploy
```

`wrangler login` opens a browser to authorise your Cloudflare account — it is the one
step that cannot be automated. After that, `npm run deploy` is all it takes.

Read [FEATUREROADMAP_workplan.md](FEATUREROADMAP_workplan.md) for what is built and what is next.

---

## The core inversion

Everything in this game falls out of one rule swap.

> In block breaker, you lose when the ball gets past your paddle.
> In Block Unbreaker, **you win when the ball gets past the paddle** — and the paddle is
> not on your side.

That single change turns every familiar instinct inside out:

* A ball bouncing cleanly off your wall is **bad**. It means the ball survives.
* The enemy paddle is *good at its job*. It tracks the ball and returns almost everything.
* So you don't build a wall to block the ball. You build a **machine that aims it** —
  angling it into the gutters, past the paddle's reach, out of the world.
* Every block you place is both armour and geometry. The blocks that survive longest are
  rarely the ones that defend best.

Your **Core** sits at the top of the field. When it's gone, you're done.

---

## Requirements

* **Node.js 18+** (developed on v25)
* A **Cloudflare account** — the free Workers plan is enough, and always will be
* A browser with Canvas + WebSocket support (any browser from the last decade)

No database, no accounts, no login, no passwords. A display name and a room code.

---

## Run it locally

```bash
npm install
npm run dev
```

Then open the URL wrangler prints (usually `http://localhost:8787`).

`wrangler dev` serves the static game files *and* runs the Durable Object locally, so
multiplayer works on localhost. To test a room with yourself, open the URL in two
browser windows, create a room in one and join with the same code in the other.

## Deploy it

First time only — authenticate wrangler against your Cloudflare account:

```bash
npx wrangler login
```

Then, any time:

```bash
npm run deploy
```

Wrangler prints the live `*.workers.dev` URL. That's the whole deploy; there is no build
step, no bundler, and no server to keep running.

To watch logs from the live deployment:

```bash
npm run tail
```

## Test it

```bash
npm test
```

172 tests, no framework — just `node --test`. The engine is pure and headless, so the
physics, the board rules and a whole run can all be tested without a browser.

---

## How it's built

Plain HTML, CSS and JavaScript. No React, no framework, no build step. The whole game is
static files plus one Worker script.

* **Rendering** — a single `<canvas>`, hand-rolled draw loop
* **Physics** — a pure, deterministic, fixed-timestep module with a seeded PRNG. Given the
  same board and the same seed it produces byte-identical results on every machine. This is
  what makes fair multiplayer possible without streaming 60 physics frames per second
  across the internet.
* **Server** — one Cloudflare Worker serving static assets, plus one **Durable Object per
  room** holding the WebSocket connections and the authoritative game state
* **Persistence** — none beyond the lifetime of a room

[ProductSpec.md](ProductSpec.md) explains the architecture properly, including the one
place where a literal 60 Hz server tick is not possible on this platform and what we do
instead.

```
.
├── public/              static assets, served directly
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── engine/      deterministic simulation (no DOM, no globals)
│       ├── render/      canvas drawing
│       └── net/         websocket client
│   ├── game/            the run: phases, purse, wave counter
│   └── screens/         title, game, results, attract mode
├── src/
│   ├── index.js         the Worker: routes /ws, serves everything else
│   └── room.js          the Durable Object (a stub until Phase 3)
├── test/                node --test suites
├── tools/
│   └── balance.js       headless balance harness (not deployed)
├── wrangler.jsonc
├── README.md
├── ProductSpec.md
└── FEATUREROADMAP_workplan.md
```

---

## Documents

| File | What it's for |
|---|---|
| [README.md](README.md) | You are here. What it is, how to run it. |
| [ProductSpec.md](ProductSpec.md) | What the game does, screen by screen and rule by rule, and how the code is organised. |
| [FEATUREROADMAP_workplan.md](FEATUREROADMAP_workplan.md) | Every feature as a checkbox, in build order, with dependencies and a definition of done. Pausable and resumable. |

---

## Built by

**Tim Hebert** ([@hedlesschkn](https://github.com/hedlesschkn)), with Claude Code.

Visual design in Figma. Game design, architecture and implementation as documented above.
