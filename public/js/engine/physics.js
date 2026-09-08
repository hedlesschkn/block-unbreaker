/**
 * Ball, paddle and collision. Pure and deterministic (ProductSpec §9).
 *
 * The simulation advances in fixed steps of SIM.TIMESTEP, and each step is sliced
 * into SIM.SUBSTEPS so a fast ball cannot skip through a block. `step()` advances
 * exactly one timestep and returns the events that happened in it — the Durable
 * Object loops it to resolve a whole wave at once, and the browser calls it from an
 * accumulator to render the same wave in real time. Same function, same results.
 *
 * ── Why there is no trigonometry in here ──
 *
 * Every reflecting surface in the game is either axis-aligned or at exactly 45°, and
 * both cases collapse to arithmetic:
 *
 *   - axis-aligned  → negate one velocity component
 *   - 45° diagonal  → swap the components (NW–SE) or swap and negate both (NE–SW)
 *
 * Both are exact in IEEE-754, so a Safari client and the workerd Durable Object agree
 * to the last bit. The only irrational operation anywhere is Math.sqrt, which the
 * standard *does* specify exactly. See the determinism contract in constants.js.
 */

import {
  GRID, ZONES, BALL, PADDLE, SIM,
  paddleTravel, paddleWidth, ballSpeed, ballCount
} from "./constants.js";
import {
  getCell, isEmpty, damage, detonate, BLOCK_DEFS, CORE_TYPE, inBounds, idx
} from "./board.js";

/** Event kinds emitted into the wave timeline. */
export const EVENT = Object.freeze({
  BALL_SPAWNED: "ball_spawned",
  WALL_BOUNCE: "wall_bounce",
  PADDLE_HIT: "paddle_hit",
  BLOCK_HIT: "block_hit",
  BLOCK_DESTROYED: "block_destroyed",
  CORE_HIT: "core_hit",
  BOMB_DETONATED: "bomb_detonated",
  BALL_ABSORBED: "ball_absorbed",
  BALL_EXITED: "ball_exited"
});

/** Which diagonal a Deflector's reflecting face lies on, keyed by its solid corner. */
const DIAGONAL = Object.freeze({
  SW: "NW_SE",
  NE: "NW_SE",
  SE: "NE_SW",
  NW: "NE_SW"
});

/** The paddle's vertical centre line. */
export const PADDLE_Y = ZONES.PADDLE_ROW + 0.5;

/** Balls spawn just above the paddle and are launched upward. */
const SPAWN_Y = ZONES.PADDLE_ROW - 0.5;

// ─── Vector helpers ──────────────────────────────────────────────────────────

/** Rescale a direction to an exact speed. Math.sqrt is bit-exact; see the header. */
function setSpeed(ball, speed) {
  const len = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (len === 0) {
    ball.vx = 0;
    ball.vy = -speed;
    return;
  }
  const scale = speed / len;
  ball.vx *= scale;
  ball.vy *= scale;
}

/**
 * Keep enough vertical motion that a ball cannot settle into a horizontal groove and
 * bounce sideways forever — boring to watch, and it burns the step budget.
 */
function enforceVerticalFloor(ball, speed) {
  const floor = speed * BALL.MIN_VERTICAL_FRACTION;
  if (Math.abs(ball.vy) >= floor) return;
  const sign = ball.vy === 0 ? 1 : Math.sign(ball.vy);
  ball.vy = floor * sign;
  setSpeed(ball, speed);
}

// ─── Construction ────────────────────────────────────────────────────────────

export function createBall(id, x, y, vx, vy, damageAmount = 1) {
  return { id, x, y, vx, vy, damage: damageAmount, alive: true };
}

/**
 * Launch the wave's balls.
 *
 * Positions and angles come from the seeded generator, so every client and the
 * Durable Object launch identically. `extra` carries sabotage balls (ProductSpec §7).
 */
export function launchBalls(wave, rng, extra = 0) {
  const speed = ballSpeed(wave);
  const travel = paddleTravel(wave);
  const count = ballCount(wave) + extra;
  const balls = [];

  for (let i = 0; i < count; i++) {
    const x = rng.float(travel.min, travel.max);
    const spread = rng.float(-BALL.LAUNCH_SPREAD, BALL.LAUNCH_SPREAD);
    const ball = createBall(i, x, SPAWN_Y, spread, -1);
    setSpeed(ball, speed);
    enforceVerticalFloor(ball, speed);
    balls.push(ball);
  }
  return balls;
}

// ─── Paddle AI ───────────────────────────────────────────────────────────────

/**
 * Where a descending ball will cross the paddle line, accounting for bounces off the
 * side walls by folding the path back into the field. Returns null for a ball that is
 * rising or stationary.
 *
 * Deliberately blind to blocks: the paddle cannot see that a Wall will deflect the
 * ball on the way down. That is a large part of what makes it beatable.
 */
export function predictLanding(ball) {
  if (ball.vy <= 0) return null;

  const time = (PADDLE_Y - ball.y) / ball.vy;
  if (time < 0) return null;

  const raw = ball.x + ball.vx * time;
  const lo = BALL.RADIUS;
  const hi = GRID.COLS - BALL.RADIUS;
  const span = hi - lo;
  if (span <= 0) return lo;

  // Mirror-fold the overshoot back into the field, as many times as needed.
  let p = (raw - lo) % (2 * span);
  if (p < 0) p += 2 * span;
  if (p > span) p = 2 * span - p;
  return lo + p;
}

/** Whichever descending ball arrives first is the one the paddle commits to. */
export function chooseTarget(balls) {
  let best = null;
  let soonest = Infinity;
  for (const ball of balls) {
    if (!ball.alive || ball.vy <= 0) continue;
    const time = (PADDLE_Y - ball.y) / ball.vy;
    if (time >= 0 && time < soonest) {
      soonest = time;
      best = ball;
    }
  }
  return best;
}

/** Slide the paddle toward its target, capped by MAX_SPEED and clamped to its lane. */
export function stepPaddle(paddle, balls, dt) {
  const target = chooseTarget(balls);
  let desired = paddle.x;

  if (target !== null) {
    const predicted = PADDLE.PREDICTS_LANDING ? predictLanding(target) : target.x;
    if (predicted !== null) desired = predicted;
  }

  const delta = desired - paddle.x;
  const maxMove = PADDLE.MAX_SPEED * dt;
  const before = paddle.x;
  paddle.x += Math.abs(delta) <= maxMove ? delta : Math.sign(delta) * maxMove;

  if (paddle.x < paddle.travel.min) paddle.x = paddle.travel.min;
  if (paddle.x > paddle.travel.max) paddle.x = paddle.travel.max;

  // Remembered so a return off a moving paddle can carry a little spin.
  paddle.motion = paddle.x - before;
}

// ─── Collision ───────────────────────────────────────────────────────────────

/** Reflect off a 45° face. Exact — no trigonometry. See the header. */
function reflectDiagonal(ball, diagonal) {
  const { vx, vy } = ball;
  if (diagonal === "NW_SE") {
    ball.vx = vy;
    ball.vy = vx;
  } else {
    ball.vx = -vy;
    ball.vy = -vx;
  }
}

/**
 * The deepest block overlap around the ball, or null.
 *
 * Cells are scanned in a fixed row-major order and compared by penetration depth,
 * with the flat cell index breaking exact ties. Determinism depends on this ordering
 * being stable, so do not reorder the loops.
 */
function findBlockCollision(board, ball) {
  const r = BALL.RADIUS;
  const minCol = Math.floor(ball.x - r);
  const maxCol = Math.floor(ball.x + r);
  const minRow = Math.floor(ball.y - r);
  const maxRow = Math.floor(ball.y + r);

  let best = null;

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!inBounds(col, row)) continue;
      const block = getCell(board, col, row);
      if (block === null) continue;

      // Overlap of the ball's bounding box with this cell, per axis.
      const depthX = Math.min(ball.x + r, col + 1) - Math.max(ball.x - r, col);
      const depthY = Math.min(ball.y + r, row + 1) - Math.max(ball.y - r, row);
      if (depthX <= 0 || depthY <= 0) continue;

      const depth = Math.min(depthX, depthY);
      if (best === null || depth > best.depth || (depth === best.depth && idx(col, row) < best.index)) {
        best = { col, row, block, depthX, depthY, depth, index: idx(col, row) };
      }
    }
  }
  return best;
}

/** Push the ball clear of a cell it is overlapping, along the shallower axis. */
function separate(ball, hit) {
  if (hit.depthX < hit.depthY) {
    ball.x += ball.x < hit.col + 0.5 ? -hit.depthX : hit.depthX;
  } else {
    ball.y += ball.y < hit.row + 0.5 ? -hit.depthY : hit.depthY;
  }
}

/**
 * Resolve one ball against one block: bounce it, damage the block, and handle
 * absorption and bomb chains. Appends to `events`.
 */
function resolveBlockHit(state, ball, hit, events) {
  const { board, speed } = state;
  const def = BLOCK_DEFS[hit.block.type];

  // Absorbers eat the ball instead of bouncing it, and are consumed doing so.
  if (def.destroysBall === true) {
    ball.alive = false;
    damage(board, hit.col, hit.row, 999);
    events.push({ t: state.step, type: EVENT.BALL_ABSORBED, ball: ball.id, col: hit.col, row: hit.row, x: ball.x, y: ball.y });
    events.push({ t: state.step, type: EVENT.BLOCK_DESTROYED, col: hit.col, row: hit.row, blockType: hit.block.type });
    state.absorbKills++;
    return;
  }

  separate(ball, hit);

  if (def.diagonal === true) {
    reflectDiagonal(ball, DIAGONAL[hit.block.rotation] ?? "NW_SE");
  } else if (hit.depthX < hit.depthY) {
    ball.vx = -ball.vx;
  } else {
    ball.vy = -ball.vy;
  }
  enforceVerticalFloor(ball, speed);

  const result = damage(board, hit.col, hit.row, ball.damage);
  events.push({
    t: state.step,
    type: result.wasCore ? EVENT.CORE_HIT : EVENT.BLOCK_HIT,
    col: hit.col,
    row: hit.row,
    blockType: hit.block.type,
    ball: ball.id
  });

  if (!result.destroyed) return;

  events.push({ t: state.step, type: EVENT.BLOCK_DESTROYED, col: hit.col, row: hit.row, blockType: result.type });

  if (result.explodes === true) {
    const blasted = detonate(board, hit.col, hit.row);
    events.push({ t: state.step, type: EVENT.BOMB_DETONATED, col: hit.col, row: hit.row, cells: blasted.length });

    // Any ball standing in the blast dies with it.
    const caught = new Set(blasted.map((c) => idx(c.col, c.row)));
    for (const other of state.balls) {
      if (!other.alive) continue;
      const oc = Math.floor(other.x);
      const orow = Math.floor(other.y);
      if (inBounds(oc, orow) && caught.has(idx(oc, orow))) {
        other.alive = false;
        state.absorbKills++;
        events.push({ t: state.step, type: EVENT.BALL_ABSORBED, ball: other.id, col: oc, row: orow, x: other.x, y: other.y });
      }
    }
  }
}

/** Side and top walls. The bottom is not a wall — it is the exit. */
function resolveWalls(state, ball, events) {
  const r = BALL.RADIUS;
  let bounced = false;

  if (ball.x < r) {
    ball.x = r;
    ball.vx = Math.abs(ball.vx);
    bounced = true;
  } else if (ball.x > GRID.COLS - r) {
    ball.x = GRID.COLS - r;
    ball.vx = -Math.abs(ball.vx);
    bounced = true;
  }

  if (ball.y < r) {
    ball.y = r;
    ball.vy = Math.abs(ball.vy);
    bounced = true;
  }

  if (bounced) events.push({ t: state.step, type: EVENT.WALL_BOUNCE, ball: ball.id, x: ball.x, y: ball.y });
}

/**
 * The paddle. Returns the ball upward with an angle set by where it struck — the
 * standard block-breaker "english", and the thing a good player learns to exploit.
 */
function resolvePaddle(state, ball, events) {
  const paddle = state.paddle;
  const r = BALL.RADIUS;
  const halfW = paddle.width / 2;
  const halfH = PADDLE.HEIGHT / 2;

  if (ball.vy <= 0) return;
  if (ball.y + r < PADDLE_Y - halfH || ball.y - r > PADDLE_Y + halfH) return;
  if (ball.x + r < paddle.x - halfW || ball.x - r > paddle.x + halfW) return;

  ball.y = PADDLE_Y - halfH - r;

  let offset = Math.max(-1, Math.min(1, (ball.x - paddle.x) / halfW));

  // Never return a ball perfectly vertically — see PADDLE.MIN_RETURN_TILT.
  if (Math.abs(offset) < PADDLE.MIN_RETURN_TILT) {
    const bias = paddle.motion === 0 ? 1 : Math.sign(paddle.motion);
    offset = PADDLE.MIN_RETURN_TILT * bias;
  }

  ball.vx = offset * PADDLE.MAX_RETURN_SPREAD;
  ball.vy = -1;
  setSpeed(ball, state.speed);
  enforceVerticalFloor(ball, state.speed);

  events.push({ t: state.step, type: EVENT.PADDLE_HIT, ball: ball.id, x: ball.x, offset });
}

// ─── The step ────────────────────────────────────────────────────────────────

/** Everything a wave needs to run. `board` is mutated; clone it first if you care. */
export function createState(board, balls, wave) {
  return {
    board,
    balls,
    paddle: createPaddleFor(wave),
    wave,
    speed: ballSpeed(wave),
    step: 0,
    gutterKills: 0,
    absorbKills: 0
  };
}

/** Paddle sized and lane-limited for a wave. */
export function createPaddleFor(wave) {
  const travel = paddleTravel(wave);
  return {
    x: (travel.min + travel.max) / 2,
    width: paddleWidth(wave),
    motion: 0,
    travel
  };
}

/**
 * Advance the simulation by exactly one SIM.TIMESTEP.
 * Returns the events produced during it, oldest first.
 */
export function step(state) {
  const events = [];
  const dt = SIM.TIMESTEP;
  const slice = dt / SIM.SUBSTEPS;

  stepPaddle(state.paddle, state.balls, dt);

  for (let s = 0; s < SIM.SUBSTEPS; s++) {
    for (const ball of state.balls) {
      if (!ball.alive) continue;

      ball.x += ball.vx * slice;
      ball.y += ball.vy * slice;

      resolveWalls(state, ball, events);

      // Out of the bottom of the world: the kill the whole game is built around.
      if (ball.y - BALL.RADIUS > GRID.ROWS) {
        ball.alive = false;
        state.gutterKills++;
        events.push({ t: state.step, type: EVENT.BALL_EXITED, ball: ball.id, x: ball.x });
        continue;
      }

      resolvePaddle(state, ball, events);

      const hit = findBlockCollision(state.board, ball);
      if (hit !== null) resolveBlockHit(state, ball, hit, events);
    }
  }

  state.step++;
  return events;
}

/** Are there any balls still in play? */
export function ballsRemaining(state) {
  return state.balls.filter((b) => b.alive).length;
}
