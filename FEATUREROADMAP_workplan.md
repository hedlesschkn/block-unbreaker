# Block Unbreaker — Feature Roadmap & Workplan

Every feature, as a checkbox, in build order.

**The ordering rule that governs this document:** a complete, playable, *deployed*
single-player game exists at a public URL before one line of multiplayer code is written.
That milestone is **T2.12**. Nothing in Phase 3 starts before it is checked.

---

## How to pause and resume this

This plan is designed to be abandoned mid-flight and picked back up cold.

* **Task states** — `[ ]` not started · `[~]` in progress · `[x]` done
* **One task, one commit, one push, one PR.** The commit message names the task
  (`T2.3 — Deterministic physics core`). Never force-push.
* **To resume:** read the Progress table below, find the first unchecked task, check its
  dependencies are all `[x]`, and start. Everything needed to do the task is inside the
  task — you should not need the conversation that produced it.
* **To pause:** mark the current task `[~]`, commit whatever works, and write what's left
  in the task's **Notes** line.

### Progress

| Phase | Tasks | Done | Milestone |
|---|---|---|---|
| 0 — Foundation | 3 | 2 | Docs approved |
| 1 — Deploy skeleton | 2 | 0 | **Live URL exists** |
| 2 — Single player | 12 | 0 | **Playable game live** |
| 3 — Multiplayer | 11 | 0 | **Rooms live** |
| 4 — Stretch | 4 | 0 | — |

---

# Phase 0 — Foundation

### [x] T0.1 — Repository and initial commit
* **Depends on:** nothing
* **Files:** `.gitignore`, `README.md`
* **Do:** Create the public GitHub repo, push an initial commit.
* **Done when:** `https://github.com/hedlesschkn/block-unbreaker` exists with a commit on `main`. ✅

### [x] T0.2 — The three documents
* **Depends on:** T0.1
* **Files:** `README.md`, `ProductSpec.md`, `FEATUREROADMAP_workplan.md`
* **Do:** Write the README, the product spec and this workplan. No game code.
* **Done when:** All three exist on a branch, PR is open, and Tim has picked the first task. ✅

### [ ] T0.3 — Figma design reconciliation — **BLOCKS ALL UI WORK**
* **Depends on:** T0.2, and a Figma file URL from Tim
* **Files:** `ProductSpec.md` §8, plus a new `DESIGN.md` for extracted tokens
* **Do:** Read the Figma file via the Figma MCP (`get_metadata` to map the pages, then
  `get_design_context` per screen, `get_screenshot` for reference). Extract colours,
  type scale, spacing and component structure into `DESIGN.md`. Diff the real screens
  against ProductSpec §8 and rewrite §8 to match reality.
  **If a design cannot be built as drawn, raise it as a question — do not quietly change it.**
* **Done when:** `DESIGN.md` holds the real tokens, ProductSpec §8 matches the Figma file,
  and any un-buildable element has been raised with Tim explicitly.
* **Notes:** The Figma MCP has no file-listing tool — it needs a `figma.com/design/...`
  URL. Blocked until that arrives. **This does not block Phase 1 or engine work in
  Phase 2 (T2.1–T2.4), which are headless.**

---

# Phase 1 — Get something live

The goal is to prove the whole deploy pipeline works *before* there is any game to debug
alongside it. If deployment is broken, it should be broken while the app is ten lines long.

### [ ] T1.1 — Worker, wrangler config, static asset serving
* **Depends on:** T0.2
* **Files:** `wrangler.jsonc`, `package.json`, `src/index.js`, `public/index.html`
* **Do:** `npm init`, add `wrangler` as a dev dependency. Write `wrangler.jsonc` with:
  * `"compatibility_date": "2026-09-08"`
  * `"observability": { "enabled": true }`
  * `"assets": { "directory": "./public", "binding": "ASSETS", "not_found_handling": "single-page-application" }`
  * the `ROOM` Durable Object binding and a `migrations` array using **`new_sqlite_classes`**
    (declared now, implemented in Phase 3 — declaring it early means the migration is never
    a surprise later)

  `src/index.js` routes `/ws/*` to the DO and hands everything else to assets.
  `public/index.html` is a placeholder title screen.
* **Done when:** `npx wrangler dev` serves the page at localhost with no errors or warnings.

### [ ] T1.2 — First deploy — **MILESTONE: live URL**
* **Depends on:** T1.1
* **Files:** `README.md` (fill in the live URL)
* **Do:** `npx wrangler deploy`. Confirm the `*.workers.dev` URL loads. Confirm
  `npx wrangler tail` streams logs.
* **Done when:** The URL is public, loads, is written into the README status table, and
  Tim has opened it.

---

# Phase 2 — The single-player game

Tasks T2.1–T2.4 are **headless and pure** — no DOM, no canvas, no Figma dependency. They
can be built and unit-tested with `node` alone, and they are the foundation everything else
sits on. Build them first and build them properly.

### [ ] T2.1 — Engine constants and seeded RNG
* **Depends on:** T1.1
* **Files:** `public/js/engine/constants.js`, `public/js/engine/rng.js`, `test/rng.test.js`
* **Do:** Put **every** tunable number from ProductSpec §2–§6 in `constants.js` — grid size,
  zone boundaries, block costs and HP, economy values, the escalation table, paddle speed
  and width. No magic numbers anywhere else in the codebase, ever.
  Implement a small seeded PRNG (mulberry32 or xorshift128). `Math.random` is banned in
  `engine/`.
* **Done when:** The same seed produces the same sequence across two separate `node` runs,
  proven by a test.

### [ ] T2.2 — Board model and block definitions
* **Depends on:** T2.1
* **Files:** `public/js/engine/board.js`, `test/board.test.js`
* **Do:** The grid data structure. Block type definitions (Wall, Deflector, Absorber, Bomb,
  Generator) with cost, HP and behaviour flags. `canPlace()`, `place()`, `sell()`,
  `damage()`, Core initialisation, and serialise/deserialise for the wire.
* **Done when:** Placement rules are enforced (zone, occupancy, affordability), Core
  destruction is detectable, and a board survives a serialise → deserialise round trip
  unchanged. Tests cover each rule.

### [ ] T2.3 — Deterministic physics core
* **Depends on:** T2.2
* **Files:** `public/js/engine/physics.js`, `test/physics.test.js`
* **Do:** Fixed-timestep circle-vs-AABB collision against the grid. Ball reflection off
  blocks, side walls and the top. Bottom edge = exit. Deflector diagonal reflection.
  Paddle AI (predicted-landing tracking, capped speed, positional return angle, gutters
  unreachable). Substep or sweep the ball so it cannot tunnel through a block at high speed.
  Deterministic collision ordering when two collisions land on the same step.
* **Done when:** No tunnelling at maximum wave speed; a ball fired into a Deflector funnel
  reliably reaches a gutter; identical inputs give identical outputs across runs. Tests
  cover reflection angles, tunnelling and determinism.

### [ ] T2.4 — `simulateWave()` — the pure entry point
* **Depends on:** T2.3
* **Files:** `public/js/engine/simulate.js`, `test/simulate.test.js`
* **Do:** `simulateWave(board, waveConfig, seed) → { events[], finalBoard, outcome }`.
  Runs the whole wave to completion, emitting a timestamped event timeline (ball spawned,
  block hit, block destroyed, bomb detonated, ball exited, core hit, wave ended). This one
  function is what the Durable Object calls in Phase 3 — **it must never touch the DOM,
  `Date.now()`, or `Math.random`.**
* **Done when:** A full wave resolves headlessly in `node`; two runs of the same seed
  produce identical timelines; a wave always terminates (add a hard step cap as a
  safety net).

### [ ] T2.5 — Canvas rendering
* **Depends on:** T2.4, **T0.3**
* **Files:** `public/js/render/canvas.js`, `public/js/render/sprites.js`, `public/css/game.css`
* **Do:** The draw loop, playing back a timeline in real time. Grid, blocks by type, Core,
  ball, paddle, gutters. Responsive scaling to viewport.
* **Done when:** A simulated wave plays back smoothly at 60 fps and looks like block breaker.

### [ ] T2.6 — Build phase UI
* **Depends on:** T2.5
* **Files:** `public/js/render/hud.js`, `public/js/screens/game.js`
* **Do:** Block palette with costs, select-and-place, ghost preview on hover, Deflector
  rotation (`R` or right-click), sell, invalid-placement feedback, Shard balance.
* **Done when:** A player can place, rotate and sell every block type with mouse and
  keyboard, and cannot place illegally.

### [ ] T2.7 — Phase state machine and economy
* **Depends on:** T2.6
* **Files:** `public/js/screens/game.js`, `public/js/engine/economy.js`
* **Do:** Build → Wave → Resolve cycling. Build timer with skip. Shard awards per
  ProductSpec §5. Generator payouts.
* **Done when:** Waves cycle indefinitely, Shard totals match the spec exactly, and the
  timer/skip both work.

### [ ] T2.8 — Escalation, win and loss
* **Depends on:** T2.7
* **Files:** `public/js/engine/constants.js`, `public/js/screens/game.js`
* **Do:** The wave table from ProductSpec §6. Core destruction → game over. Surviving
  wave 20 → win.
* **Done when:** A full run can be lost *and* won, and both end on the Results screen.

### [ ] T2.9 — Title, Game and Results screens
* **Depends on:** T2.8, **T0.3**
* **Files:** `public/index.html`, `public/js/screens/*`, `public/css/*`
* **Do:** All screens per the reconciled ProductSpec §8. Section toggling, no router.
  Attract-mode board on the title screen.
* **Done when:** Title → Game → Results → Title works end to end and matches Figma.

### [ ] T2.10 — Audio and game feel
* **Depends on:** T2.9
* **Files:** `public/js/render/fx.js`, `public/audio/*`
* **Do:** WebAudio blips for bounce, break, bomb, gutter kill, core hit. Screen shake on
  Core damage, particles on block destruction, a satisfying gutter-kill flourish. Mute toggle.
* **Done when:** The game feels good to lose at. Audio can be muted and the setting sticks.

### [ ] T2.11 — Balance pass
* **Depends on:** T2.10
* **Files:** `public/js/engine/constants.js`
* **Do:** Actually play it. Tune paddle speed and width, block costs, ball speed ramp and
  the gutter-kill/absorb-kill reward gap until wave 20 is hard but fair, and until funnelling
  to the gutters is clearly the strongest strategy.
* **Done when:** Tim can reach roughly wave 10 on a first attempt and wave 20 is a real
  achievement. Any constant changed is noted in the commit.

### [ ] T2.12 — Deploy single player — **MILESTONE: playable game live**
* **Depends on:** T2.11
* **Files:** `README.md`
* **Do:** `npx wrangler deploy`. Play the live build start to finish. Update the README.
* **Done when:** A stranger with the URL can play a complete run in their browser.
  **Phase 3 does not begin until this box is checked.**

---

# Phase 3 — Multiplayer

### [ ] T3.1 — Durable Object skeleton
* **Depends on:** **T2.12**
* **Files:** `src/room.js`, `src/index.js`, `wrangler.jsonc`
* **Do:** The `Room` class, SQLite-backed, declared in `migrations` with
  `new_sqlite_classes`. Routed from the Worker via `env.ROOM.getByName(roomCode)`.
  State schema for players, boards, phase, wave and seed.
* **Done when:** A DO instance is created per room code and persists across requests, proven
  in `wrangler dev`.

### [ ] T3.2 — WebSocket transport and identity
* **Depends on:** T3.1
* **Files:** `src/room.js`, `public/js/net/socket.js`
* **Do:** Accept sockets with **`ctx.acceptWebSocket(server)`** — never `server.accept()`.
  Store per-player identity with `ws.serializeAttachment()` / `ws.deserializeAttachment()`.
  JSON `{type, payload}` on every message, both directions. Client-side dispatch and
  reconnect with backoff.
* **Done when:** Two browser windows connect to one room and exchange messages. Hibernation
  is verified: a socket survives the DO going to sleep and waking.

### [ ] T3.3 — Room codes, create and join
* **Depends on:** T3.2
* **Files:** `public/js/screens/room.js`, `src/index.js`, `src/room.js`
* **Do:** Generate readable 4–6 character codes (no ambiguous `0/O`, `1/I`). Create and join
  flows, display name capture, capacity limit of 4, clear errors for full/nonexistent rooms.
* **Done when:** Two people on different machines reach the same room from a spoken code.

### [ ] T3.4 — Lobby, presence and ready state
* **Depends on:** T3.3, **T0.3**
* **Files:** `public/js/screens/room.js`, `src/room.js`
* **Do:** Live player list, join/leave broadcasts, ready toggles, start when all ready.
* **Done when:** Presence is accurate within a second, and the game starts only when
  everyone is ready.

### [ ] T3.5 — Server-authoritative boards
* **Depends on:** T3.4
* **Files:** `src/room.js`, `public/js/net/socket.js`, `public/js/screens/game.js`
* **Do:** Move board ownership into the DO. Validate every `place`/`sell` server-side —
  zone, occupancy, affordability, phase. Reject illegal requests with `error` and no state
  change. Broadcast `board_update`.
* **Done when:** A hand-crafted illegal message over the socket cannot alter a board.
  Try it deliberately.

### [ ] T3.6 — Synchronised waves
* **Depends on:** T3.5
* **Files:** `src/room.js`, `public/js/screens/game.js`
* **Do:** The DO picks the seed, runs `simulateWave()` for each player's board itself, and
  broadcasts `wave_start` with the seed and timeline. Clients play the timeline back. Every
  player gets the same wave composition.
* **Done when:** Two clients see identical wave composition, and each client's local
  playback matches the DO's authoritative timeline exactly.

### [ ] T3.7 — Alarm-driven phase clock
* **Depends on:** T3.6
* **Files:** `src/room.js`
* **Do:** Drive the build countdown and wave transitions with the **Alarms API**. Schedule
  the next alarm **at the end of each tick**. **Persist state on every tick.** **Cancel the
  alarm when the last player leaves.** No `setInterval`, no `setTimeout`, anywhere in the DO.
* **Done when:** A room advances phases correctly with all clients backgrounded; a room with
  no players schedules no further alarms and goes quiet. Verify via `wrangler tail`.

### [ ] T3.8 — Opponent boards
* **Depends on:** T3.7
* **Files:** `public/js/render/canvas.js`, `public/js/screens/game.js`
* **Do:** Render each opponent's board as a live thumbnail with their name and Core HP.
* **Done when:** Opponent boards update live during a wave without dropping the main
  board's frame rate.

### [ ] T3.9 — Sabotage
* **Depends on:** T3.8
* **Files:** `src/room.js`, `public/js/engine/constants.js`, `public/js/render/hud.js`
* **Do:** Gutter kills charge the meter; a full meter injects an extra ball into a random
  opponent's next wave. Routed by the DO. Visible incoming/outgoing feedback.
* **Done when:** Sabotage lands on the correct opponent, both players see it clearly, and
  Absorber/Bomb kills do not charge the meter.

### [ ] T3.10 — Disconnects, reconnects and cleanup
* **Depends on:** T3.9
* **Files:** `src/room.js`, `public/js/net/socket.js`
* **Do:** Handle `webSocketClose` and `webSocketError`. Reconnect into an in-progress game
  with the same identity. Eliminated players become spectators. Empty rooms cancel their
  alarm and release state.
* **Done when:** Killing a tab mid-wave and reopening it rejoins the same game in the right
  state, and an abandoned room leaves nothing running.

### [ ] T3.11 — Deploy multiplayer — **MILESTONE: rooms live**
* **Depends on:** T3.10
* **Files:** `README.md`
* **Do:** Deploy. Play a real 2+ player game across different machines and networks.
* **Done when:** Two people in different places finish a game together on the live URL.

---

# Phase 4 — Stretch

Not scheduled. Pull from here once Phase 3 is checked.

### [ ] T4.1 — Additional block types
Magnet (curves nearby ball paths), Tar (halves ball speed while overlapping), Repair Node
(heals adjacent blocks between waves). Files: `engine/board.js`, `engine/physics.js`,
`engine/constants.js`, `render/sprites.js`.

### [ ] T4.2 — Ball variants
Heavy (2 damage), Splitter (divides on first block contact), Ghost (ignores Deflectors),
introduced at waves 5/10/15. Files: `engine/physics.js`, `engine/simulate.js`, `constants.js`.

### [ ] T4.3 — Endless mode
Continue past wave 20 with unbounded escalation and a personal-best kept in `localStorage`.

### [ ] T4.4 — Touch controls
Tap-to-place, pinch-to-zoom, a layout that works in portrait on a phone.

---

## Standing rules for every task

1. One task per branch, one PR per task, commit message names the task. **Never force-push.**
2. `public/js/engine/` stays pure: no DOM, no `Date.now()`, no `Math.random`, no globals.
   Both the browser and the Worker import it.
3. Every tunable number lives in `constants.js`.
4. No Socket.IO, no Express, no `ws`, no React, no build step.
5. No `setInterval` or `setTimeout` inside the Durable Object. Ever.
6. If a Figma design cannot be built as drawn, **say so** — don't quietly redesign it.
