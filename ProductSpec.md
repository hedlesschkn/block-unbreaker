# Block Unbreaker — Product Specification

Version 0.1 · 2026-09-08 · status: **approved for build, pending Figma sync**

---

## 1. What this is

A browser game that borrows the entire visual language of block breaker / Arkanoid —
a grid of coloured bricks, a bouncing ball, a paddle sliding along the bottom — and
reverses the player's role in it.

The player is the wall. The paddle is the opponent.

Underneath the arcade skin, the actual genre is **castle defense**: a build phase where
you spend currency on defensive structures, then a combat phase you cannot intervene in,
repeated in escalating waves.

### Design pillars

1. **The paddle is a competent enemy, not an obstacle.** It tracks the ball and returns
   almost everything. Beating it must feel like outwitting something, not out-waiting it.
2. **You never get direct control.** No aiming, no clicking the ball, no nudging. All your
   agency is spent before the wave starts. This is what makes it a defense game.
3. **Blocks are geometry first, armour second.** The interesting decisions are about
   *where the ball goes next*, not about hit points.
4. **Every rule is legible from the screen.** No hidden stats, no tooltips required to play.

---

## 2. The field

A fixed grid, rendered on one canvas, portrait-oriented.

```
        ┌────────────────────────────┐
 rows   │ ▓▓▓▓  C O R E   ▓▓▓▓       │  0–2   Core zone (pre-placed, not editable)
 0–2    ├────────────────────────────┤
        │                            │
 rows   │      buildable space       │  3–16  you place blocks here
 3–16   │                            │
        │                            │
        ├────────────────────────────┤
 rows   │                            │  17–19 no-build (paddle lane + launch space)
17–19   │        ▁▁▁▁▁▁▁▁            │
        └────────────────────────────┘
         ↑ gutter              gutter ↑
```

* **Grid** — 12 columns × 20 rows. One cell is one block.
* **Walls** — the left and right edges reflect the ball. The top edge reflects the ball.
* **The bottom edge does not reflect.** A ball that crosses it is gone. This is the only
  exit from the world, and getting balls through it is the entire game.
* **Gutters** — narrow dead columns at the far left and right of the paddle lane that the
  paddle physically cannot reach. Feeding balls into a gutter is the cleanest kill.

All dimensions are **tunable constants in one file**, not scattered magic numbers.

---

## 3. The game loop

Three phases, cycling once per wave.

### Build (default 30 s, skippable)

The board is frozen. The player spends **Shards** placing blocks from a palette. Placement
is grid-snapped, restricted to the buildable zone, and to empty cells. Blocks can be sold
back for 50% before the wave starts. A "Ready" button ends the phase early; when every
player in a room is ready, the wave begins immediately.

### Wave (runs until every ball is gone)

Balls launch. Physics runs. **The player cannot intervene.** They watch.

The wave ends when the ball count reaches zero — every ball either fell out of the bottom,
or was eaten by an Absorber, or was caught in a Bomb.

### Resolve

Shards are awarded, surviving Generators pay out, the wave counter increments, damage is
tallied, and the next Build phase opens. If the Core is gone, the run ends here instead.

---

## 4. Entities

### The Core

Eight blocks in the top zone — four columns by two rows — pre-placed, 10 HP each, not
player-editable and not repairable in v1. **When the last Core block breaks, the run is
over.** Core blocks are visually distinct (bright, pulsing) so the stakes are always
readable.

> Revised at T2.1, from nine blocks to eight. A 3×3 Core cannot be centred on a
> 12-column grid — an odd width always lands one column off centre, which would quietly
> bias every left-versus-right funnelling decision in a game whose entire skill
> expression is choosing a side to funnel toward. Four columns centre exactly. Raised
> rather than changed silently, per §11.

### The ball

A circle with a position and a velocity. It reflects off blocks and off the left, right
and top edges. It damages any block it strikes.

Speed is constant within a wave — reflections change direction, never magnitude — which
keeps the simulation stable and keeps the player's mental model simple.

### The enemy paddle

Slides horizontally along row 19. Its AI:

* tracks the ball's **predicted** landing x, not its current x
* moves at a capped speed, so it can be beaten by *distance*, not by trickery
* has a fixed width that shrinks slightly in later waves (its only concession)
* cannot enter the gutters

When it connects, the ball reflects upward with an angle determined by where on the paddle
it struck — the standard block-breaker "english". This is deliberate: it means the paddle's
return angle is *predictable*, and a good player learns to exploit it.

### Blocks

Every block occupies exactly one cell, has HP, and reflects the ball unless stated
otherwise. All costs and HP values below are **starting values, tuned in playtesting**.

| Block | Cost | HP | Behaviour |
|---|---:|---:|---|
| **Wall** | 10 | 3 | Plain armour. Reflects, absorbs three hits, dies. The cheap filler. |
| **Deflector** | 25 | 6 | Occupies a cell as a diagonal. Reflects the ball 90° instead of 180°. Rotatable to any of four orientations. The aiming tool — this is how you build a funnel to the gutters. |
| **Absorber** | 40 | 1 | Destroys the ball that touches it, and is consumed doing so. One block, one ball. Your panic button. |
| **Bomb** | 30 | 1 | On destruction, detonates across the surrounding 3×3, destroying any ball inside it — **and any of your own blocks inside it.** High risk, high reward, terrible to place carelessly. |
| **Generator** | 50 | 2 | Pays **+5 Shards** at the end of every wave it survives. Fragile, expensive, and it has to be somewhere the ball can't reach. An economy engine you must also defend. |

Reserved for later waves of development (see roadmap Phase 4): **Magnet** (curves nearby
ball paths), **Tar** (halves ball speed while overlapping), **Repair Node** (heals adjacent
blocks between waves).

---

## 5. Economy

* Start each run with **120 Shards**.
* **+15** per ball eliminated through the bottom of the field (a "gutter kill").
* **+8** per ball eliminated by an Absorber or Bomb. Deliberately less — the game rewards
  the elegant solution over the brute-force one.
* **+20** flat per wave survived.
* **+5** per surviving Generator, per wave.
* Selling a block refunds **50%**, build phase only.

The asymmetry between gutter kills and absorb kills is the main tuning lever for pushing
players toward the interesting strategy.

---

## 6. Escalation

| Wave | Balls | Ball speed | Paddle |
|---|---|---|---|
| 1 | 1 | 1.00× | full width |
| 2–3 | 1 | +4% / wave | full width |
| 4–6 | 2 | +4% / wave | full width |
| 7–9 | 3 | +4% / wave | −5% width |
| 10–12 | 4 | +4% / wave | −10% width |
| 13+ | +1 every 3 waves | +4% / wave | −5% per 3 waves, floor 60% |

**A run is won by surviving wave 20.** Endless mode is a Phase 4 item.

Ball *variants* (Heavy: 2 damage per hit · Splitter: divides on first block contact ·
Ghost: ignores Deflectors) are specified but deferred to Phase 4, so that v1 escalation is
purely count-and-speed and therefore trivially balanceable.

---

## 7. Multiplayer

2–4 players per room. Everyone plays **their own board, at the same time**, from the
**same seed** — identical wave composition for everyone, so outcomes reflect building, not
luck.

* All boards advance through Build and Wave phases **together**. A wave starts when every
  living player is ready, or when the build timer expires.
* Opponent boards render as small live thumbnails alongside your own.
* **Last player with a standing Core wins.** If everyone survives wave 20, the tiebreak is
  total remaining Core HP, then waves survived.
* A player whose Core falls becomes a spectator and keeps watching the room finish.

### Sabotage — the "garbage lines" analogue

Gutter kills charge a **Sabotage meter**. When it fills, an **extra ball** is injected into
a random opponent's next wave. Absorber and Bomb kills do not charge it. This makes the
elegant strategy also the aggressive one, and gives the room a reason to interact.

---

## 8. Screens

Four screens, no routing library — one HTML document, sections toggled.

1. **Title** — the game name, an attract-mode board simulating itself in the background,
   `Play Solo` and `Play With Friends`.
2. **Room** — display name field, room code field, `Create Room` / `Join Room`, the player
   list with ready states, and the code shown large for reading aloud.
3. **Game** — the field canvas centre; block palette and Shard balance on one side; wave
   number, phase, phase timer, Core HP and the Sabotage meter on the other; opponent
   thumbnails below or beside. Solo play uses the same screen minus the opponent strip.
4. **Results** — waves survived, per-player finishing order, `Play Again` (same room,
   same players) and `Leave`.

> **Figma:** these four screens are the spec's own reading of the requirement. They must be
> reconciled against the Figma file before any UI is written — that reconciliation is
> task **T0.3** in the roadmap and it blocks all UI tasks. If a screen in the Figma file
> cannot be built as designed, that is raised as a question, not silently changed.

---

## 9. Technical architecture

### Stack

* **Cloudflare Workers**, free plan
* Static assets served via `assets` in `wrangler.jsonc`, `not_found_handling` set to
  `"single-page-application"`
* `compatibility_date` — `2026-09-08`
* `{"observability": {"enabled": true}}`
* **One SQLite-backed Durable Object per room**, declared with `new_sqlite_classes` in the
  migrations array, addressed by `env.ROOM.getByName(roomCode)`
* One **native WebSocket** per player, held by that room's Durable Object, accepted with
  `ctx.acceptWebSocket(server)` — never `server.accept()`
* Per-player identity stored via `ws.serializeAttachment()` / `ws.deserializeAttachment()`
* **No Socket.IO. No Express. No `ws`.** Workers cannot run a long-lived Node server.
* Plain HTML, CSS, JS. No React, no build step.

### The tick problem, and how this design answers it

Server-authoritative games usually tick the whole simulation on the server. **Ball physics
needs roughly 60 updates per second, and a Durable Object cannot be woken 60 times a second
without destroying both the free tier and the room's ability to ever sleep.** Alarms are the
correct tool for a ~1 Hz tick; they are the wrong tool for a physics loop, and no amount of
scheduling discipline changes that.

So the simulation is not streamed. It is **computed whole, once, by the Durable Object.**

The physics engine is written as a **pure deterministic function**:

```js
simulateWave(board, waveConfig, seed) -> { events[], finalBoard, outcome }
```

Fixed timestep, seeded PRNG, no wall-clock reads, no `Math.random`, deterministic collision
ordering. The same three inputs produce the same output on every machine, every time.

That gives a clean division:

* At wave start the **Durable Object runs `simulateWave` itself** and broadcasts the
  resulting event timeline. It is the sole authority on what happened — it did not trust a
  client, it computed the answer.
* Each **client runs the identical function** purely to *render* the wave in real time. The
  client is a playback device. If a client's result ever diverges from the broadcast
  timeline, the client is wrong and re-syncs.
* A whole wave is a few thousand fixed steps over a few dozen objects — comfortably inside
  the CPU budget of a single invocation, and it happens once per wave rather than sixty
  times a second.

The **Alarms API** is then used for exactly what it is good at, and the constraint applies
to it literally:

* the build-phase countdown
* scheduling the wave transition
* the next alarm is always scheduled **at the end of the current tick**
* board state is **persisted on every tick**
* the alarm is **cancelled when the last player leaves**, so the room sleeps

There is no `setInterval` or `setTimeout` anywhere in the Durable Object.

**The one consequence worth knowing:** because a wave is resolved in one shot, players
cannot act mid-wave. That matches the design (Build is the only phase with agency), but it
means a future "place one emergency block mid-wave" feature would require re-simulating
from the interruption point. That is cheap and still deterministic — but it is a design
commitment being made now, deliberately, and it is worth naming before it surprises anyone.

### Message protocol

Every message over the socket is JSON with exactly `type` and `payload`.

**Client → server**

| type | payload |
|---|---|
| `join` | `{ name, roomCode }` |
| `place` | `{ blockType, col, row, rotation }` |
| `sell` | `{ col, row }` |
| `ready` | `{}` |
| `leave` | `{}` |

**Server → client**

| type | payload |
|---|---|
| `room_state` | full snapshot: players, phase, wave, boards |
| `player_joined` / `player_left` | `{ playerId, name }` |
| `board_update` | `{ playerId, board }` — after a validated placement |
| `phase_change` | `{ phase, wave, endsAt }` |
| `wave_start` | `{ seed, waveConfig, timeline }` |
| `wave_result` | `{ playerId, coreHp, shards, eliminated }` |
| `sabotage` | `{ fromPlayerId, toPlayerId }` |
| `game_over` | `{ standings }` |
| `error` | `{ code, message }` |

### What the Durable Object owns

Everything that can be argued about: room membership and identity, the authoritative board
for every player, Shard balances, the phase state machine, wave number, the per-wave seed,
the computed wave timeline, sabotage routing, and the final standings.

Placements are **validated server-side** — cell is empty, cell is in the buildable zone,
player can afford it, phase is Build. A client that asks for something illegal gets an
`error` and no state change.

### Code organisation

```
public/js/
  engine/          pure, deterministic, no DOM and no globals
    constants.js   every tunable number in the game
    rng.js         seeded PRNG
    board.js       grid, placement rules, block definitions
    physics.js     ball / paddle / block collision, fixed timestep
    simulate.js    simulateWave() — the pure entry point
  render/
    canvas.js      the draw loop
    sprites.js     block and ball drawing
    hud.js         palette, shards, wave, timers
  net/
    socket.js      websocket client, reconnect, message dispatch
  screens/         title / room / game / results
  main.js          wiring

src/
  index.js         the Worker: routes /ws/:roomCode, serves assets
  room.js          the Durable Object
```

`public/js/engine/` is importable by both the browser and the Worker and depends on
neither. That shared-purity rule is what the whole architecture rests on, and it is the
thing to protect in code review.

---

## 10. Explicitly out of scope

No accounts, no login, no passwords, no user database. No leaderboard, no ranked play, no
persistent statistics. No matchmaking — you get a room code and you tell your friends.
No mobile-specific build (the layout is responsive, but touch controls are not designed).
No spectator-only join. No replays saved beyond the current session.

---

## 11. Open questions

1. **Figma reconciliation (blocking for UI).** The four screens in §8 are inferred. The
   real designs need to be read before any UI work — task T0.3.
2. **Paddle difficulty is the whole game's balance.** A paddle that never misses makes the
   game unwinnable; one that misses often makes it trivial. Expect this to need real
   playtesting, and expect the answer to be "the paddle is fast but its return angle is
   exploitable" rather than "the paddle is slow".
3. **Bomb friendly-fire** may prove too punishing to ever be worth using. If so, the fix is
   to make it damage rather than destroy neighbours.
