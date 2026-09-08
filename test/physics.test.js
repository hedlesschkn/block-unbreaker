import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { GRID, ZONES, BALL, PADDLE, SIM, ballSpeed, paddleTravel, ballCount } from "../public/js/engine/constants.js";
import { createBoard, place, getCell, isEmpty, clone, CORE_TYPE } from "../public/js/engine/board.js";
import { BLOCKS } from "../public/js/engine/constants.js";

const BLOCKS_WALL_HP = BLOCKS.WALL.hp;
import { createRng } from "../public/js/engine/rng.js";
import {
  EVENT, PADDLE_Y, createBall, createState, createPaddleFor, launchBalls,
  predictLanding, chooseTarget, stepPaddle, step, ballsRemaining
} from "../public/js/engine/physics.js";

const BUILD_ROW = ZONES.BUILD_ROW_START;

/** Run a state until every ball is gone or the step cap is hit. */
function runToCompletion(state, cap = SIM.MAX_STEPS) {
  const events = [];
  while (ballsRemaining(state) > 0 && state.step < cap) events.push(...step(state));
  return events;
}

/** A state with one ball placed and aimed exactly. */
function oneBall(board, x, y, vx, vy, wave = 1) {
  const ball = createBall(0, x, y, vx, vy);
  const state = createState(board, [ball], wave);
  return { state, ball };
}

describe("launching", () => {
  test("launches the wave's ball count, plus any sabotage balls", () => {
    for (const wave of [1, 4, 7, 13]) {
      assert.equal(launchBalls(wave, createRng("S")).length, ballCount(wave), `wave ${wave}`);
    }
    assert.equal(launchBalls(1, createRng("S"), 2).length, ballCount(1) + 2);
  });

  test("every launched ball starts inside the field, moving upward, at wave speed", () => {
    const balls = launchBalls(10, createRng("LAUNCH"));
    for (const ball of balls) {
      assert.ok(ball.x > 0 && ball.x < GRID.COLS, `x=${ball.x}`);
      assert.ok(ball.vy < 0, "ball should launch upward");
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      assert.ok(Math.abs(speed - ballSpeed(10)) < 1e-9, `speed ${speed}`);
    }
  });

  test("the same seed launches identical balls", () => {
    const a = launchBalls(5, createRng("SEED-A"));
    const b = launchBalls(5, createRng("SEED-A"));
    assert.deepEqual(a, b);
  });

  test("different seeds launch differently", () => {
    assert.notDeepEqual(launchBalls(5, createRng("ONE")), launchBalls(5, createRng("TWO")));
  });
});

describe("walls and the exit", () => {
  test("the side walls reflect", () => {
    const { state, ball } = oneBall(createBoard(), 0.5, 10, -9, 0);
    for (let i = 0; i < 20 && ball.vx < 0; i++) step(state);
    assert.ok(ball.vx > 0, "ball should have bounced off the left wall");
    assert.ok(ball.x >= BALL.RADIUS);
  });

  test("the top reflects", () => {
    // Column 0 is clear of the Core, so this tests the ceiling and nothing else.
    const { state, ball } = oneBall(createBoard(), 0.5, 0.6, 0, -9);
    for (let i = 0; i < 20 && ball.vy < 0; i++) step(state);
    assert.ok(ball.vy > 0, "ball should have bounced off the ceiling");
  });

  test("the bottom does NOT reflect — it is the exit", () => {
    const { state, ball } = oneBall(createBoard(), 0.5, GRID.ROWS - 0.2, 0, 9);
    runToCompletion(state, 200);
    assert.equal(ball.alive, false);
    assert.equal(state.gutterKills, 1);
  });

  test("exiting emits BALL_EXITED", () => {
    const { state } = oneBall(createBoard(), 0.5, GRID.ROWS - 0.2, 0, 9);
    const events = runToCompletion(state, 200);
    assert.ok(events.some((e) => e.type === EVENT.BALL_EXITED));
  });

  test("a ball never escapes the side or top walls, however long it runs", () => {
    const board = createBoard();
    const balls = launchBalls(12, createRng("CONTAIN"));
    const state = createState(board, balls, 12);
    for (let i = 0; i < 4000 && ballsRemaining(state) > 0; i++) {
      step(state);
      for (const ball of state.balls) {
        if (!ball.alive) continue;
        assert.ok(ball.x >= 0 && ball.x <= GRID.COLS, `escaped sideways at x=${ball.x}`);
        assert.ok(ball.y >= 0, `escaped upward at y=${ball.y}`);
      }
    }
  });
});

describe("block collision", () => {
  test("a ball rising into a block bounces back down and damages it", () => {
    const board = createBoard();
    place(board, "WALL", 5, BUILD_ROW + 2, null, 999);
    const { state, ball } = oneBall(board, 5.5, BUILD_ROW + 3.6, 0, -9);

    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      hit = step(state).some((e) => e.type === EVENT.BLOCK_HIT);
    }
    assert.ok(hit, "no block hit was registered");
    assert.ok(ball.vy > 0, "ball should be travelling downward after the bounce");
    assert.equal(getCell(board, 5, BUILD_ROW + 2).hp, BLOCKS.WALL.hp - 1);
  });

  test("hits chip a block by exactly one HP each, and the last one destroys it", () => {
    const board = createBoard();
    const cell = { col: 5, row: BUILD_ROW + 2 };
    place(board, "WALL", cell.col, cell.row, null, 999);
    const { state } = oneBall(board, 5.5, BUILD_ROW + 3.6, 0, -9);
    const events = runToCompletion(state, 3000);

    const hits = events.filter((e) => e.type === EVENT.BLOCK_HIT && e.col === cell.col && e.row === cell.row).length;
    const destroyed = events.some((e) => e.type === EVENT.BLOCK_DESTROYED && e.col === cell.col && e.row === cell.row);
    assert.ok(hits > 0, "the ball never reached the block");

    if (destroyed) {
      assert.equal(hits, BLOCKS_WALL_HP, "took the wrong number of hits to break");
      assert.ok(isEmpty(board, cell.col, cell.row));
    } else {
      assert.equal(getCell(board, cell.col, cell.row).hp, BLOCKS_WALL_HP - hits, "HP does not match hits taken");
    }
  });

  test("hitting the Core emits CORE_HIT rather than BLOCK_HIT", () => {
    const board = createBoard();
    const { state } = oneBall(board, 5.5, 3.6, 0, -9);
    let events = [];
    for (let i = 0; i < 60 && events.length === 0; i++) {
      events = step(state).filter((e) => e.type === EVENT.CORE_HIT || e.type === EVENT.BLOCK_HIT);
    }
    assert.ok(events.some((e) => e.type === EVENT.CORE_HIT), "expected a CORE_HIT");
    assert.ok(!events.some((e) => e.type === EVENT.BLOCK_HIT), "core hits must not double as block hits");
  });

  test("an Absorber eats the ball and is consumed", () => {
    const board = createBoard();
    place(board, "ABSORBER", 5, BUILD_ROW + 2, null, 999);
    const { state, ball } = oneBall(board, 5.5, BUILD_ROW + 3.6, 0, -9);
    const events = runToCompletion(state, 500);

    assert.equal(ball.alive, false);
    assert.ok(isEmpty(board, 5, BUILD_ROW + 2), "absorber should be consumed");
    assert.ok(events.some((e) => e.type === EVENT.BALL_ABSORBED));
    assert.equal(state.absorbKills, 1);
    assert.equal(state.gutterKills, 0, "an absorb is not a gutter kill");
  });

  test("a Bomb detonates, clears its 3x3, and kills a ball caught in it", () => {
    const board = createBoard();
    const row = BUILD_ROW + 4;
    place(board, "BOMB", 5, row, null, 9999);
    for (const c of [4, 6]) place(board, "WALL", c, row, null, 9999);

    // Pre-chip the bomb so a single connecting hit sets it off; this test is about the
    // blast, not about how many bounces it takes to break a 2 HP block.
    getCell(board, 5, row).hp = 1;

    const { state } = oneBall(board, 5.5, row + 1.6, 0, -9);
    const events = runToCompletion(state, 4000);

    assert.ok(events.some((e) => e.type === EVENT.BOMB_DETONATED), "bomb never detonated");
    assert.ok(isEmpty(board, 4, row), "friendly fire should have cleared the neighbour");
    assert.ok(isEmpty(board, 6, row), "friendly fire should have cleared the neighbour");
  });

  test("a ball cannot tunnel through an intact block at win-wave speed", () => {
    const board = createBoard();
    const row = BUILD_ROW + 6;
    for (let col = 0; col < GRID.COLS; col++) place(board, "WALL", col, row, null, 99999);

    // Aimed steeply upward, fast, straight at the barrier.
    const wave = 20;
    const ball = createBall(0, 5.5, row + 2.5, 0, -ballSpeed(wave));
    const state = createState(board, [ball], wave);

    for (let i = 0; i < 600; i++) {
      step(state);
      if (!ball.alive) break;
      // Getting above the barrier is legitimate only where the ball has actually
      // broken the block. Passing an intact one is tunnelling.
      if (ball.y < row) {
        const col = Math.floor(ball.x);
        assert.equal(
          getCell(board, col, row), null,
          `ball reached y=${ball.y} above an intact block at (${col}, ${row})`
        );
      }
    }
  });

  test("a ball fired into a dense field never ends up inside a block", () => {
    const board = createBoard();
    for (let row = BUILD_ROW; row <= BUILD_ROW + 6; row += 2) {
      for (let col = 1; col < GRID.COLS - 1; col += 2) place(board, "WALL", col, row, null, 999999);
    }
    const balls = launchBalls(15, createRng("DENSE"));
    const state = createState(board, balls, 15);

    for (let i = 0; i < 2000 && ballsRemaining(state) > 0; i++) {
      step(state);
      for (const ball of state.balls) {
        if (!ball.alive) continue;
        const cell = getCell(board, Math.floor(ball.x), Math.floor(ball.y));
        assert.equal(cell, null, `ball ended up inside a ${cell?.type} at (${ball.x}, ${ball.y})`);
      }
    }
  });
});

describe("deflectors", () => {
  test("throws the ball out along its diagonal, away from its solid corner", () => {
    // A Deflector is a KICKER, not a mirror: the outgoing direction is fixed by the
    // rotation and does not depend on how the ball arrived. That is what makes it
    // aimable, and it is why deflector strategies work at all — see the note in
    // physics.js and the T2.11 balance findings.
    const expected = {
      SW: { x: 1, y: -1 }, SE: { x: -1, y: -1 },
      NW: { x: 1, y: 1 },  NE: { x: -1, y: 1 }
    };

    for (const [rotation, dir] of Object.entries(expected)) {
      const board = createBoard();
      place(board, "DEFLECTOR", 5, BUILD_ROW + 2, rotation, 999);
      const speed = ballSpeed(1);
      const ball = createBall(0, 5.5, BUILD_ROW + 3.6, 0, -speed);
      const state = createState(board, [ball], 1);

      let hit = false;
      for (let i = 0; i < 80 && !hit; i++) hit = step(state).some((e) => e.type === EVENT.BLOCK_HIT);
      assert.ok(hit, `${rotation}: never struck the deflector`);

      assert.equal(Math.sign(ball.vx), dir.x, `${rotation}: wrong horizontal direction`);
      assert.equal(Math.sign(ball.vy), dir.y, `${rotation}: wrong vertical direction`);
      // A 45° throw: equal parts across and down.
      assert.ok(Math.abs(Math.abs(ball.vx) - Math.abs(ball.vy)) < 1e-9, `${rotation}: not a 45° throw`);
    }
  });

  test("all four rotations deflect, and none passes the ball through", () => {
    for (const rot of ["NE", "SE", "SW", "NW"]) {
      const board = createBoard();
      place(board, "DEFLECTOR", 5, BUILD_ROW + 2, rot, 999);
      const { state, ball } = oneBall(board, 5.5, BUILD_ROW + 3.6, 0, -9);
      const before = { vx: ball.vx, vy: ball.vy };

      let deflected = false;
      for (let i = 0; i < 60 && !deflected; i++) {
        deflected = step(state).some((e) => e.type === EVENT.BLOCK_HIT);
      }
      assert.ok(deflected, `${rot} never registered a hit`);
      assert.notDeepEqual({ vx: ball.vx, vy: ball.vy }, before, `${rot} did not change the velocity`);
    }
  });

  test("deflection preserves speed exactly", () => {
    const board = createBoard();
    place(board, "DEFLECTOR", 5, BUILD_ROW + 2, "NE", 999);
    const speed = ballSpeed(1);
    const { state, ball } = oneBall(board, 5.3, BUILD_ROW + 3.6, 1, -8.94);
    for (let i = 0; i < 80; i++) step(state);
    if (ball.alive) {
      const now = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      assert.ok(Math.abs(now - speed) < 1e-6, `speed drifted from ${speed} to ${now}`);
    }
  });
});

describe("the paddle", () => {
  test("predicts where a descending ball will land", () => {
    const ball = createBall(0, 2, PADDLE_Y - 4, 0, 4);
    assert.ok(Math.abs(predictLanding(ball) - 2) < 1e-9);
  });

  test("folds a prediction that would leave the field back off the walls", () => {
    const ball = createBall(0, 6, PADDLE_Y - 1, 40, 1);
    const landing = predictLanding(ball);
    assert.ok(landing >= 0 && landing <= GRID.COLS, `predicted ${landing}, outside the field`);
  });

  test("ignores rising balls", () => {
    assert.equal(predictLanding(createBall(0, 5, 10, 0, -5)), null);
    assert.equal(chooseTarget([createBall(0, 5, 10, 0, -5)]), null);
  });

  test("commits to whichever descending ball arrives first", () => {
    const near = createBall(1, 3, PADDLE_Y - 1, 0, 5);
    const far = createBall(2, 8, PADDLE_Y - 10, 0, 5);
    assert.equal(chooseTarget([far, near]).id, 1);
  });

  test("returns a ball that reaches it, and sends it back upward", () => {
    const board = createBoard();
    const state = createState(board, [], 1);
    const ball = createBall(0, state.paddle.x, PADDLE_Y - 1, 0, ballSpeed(1));
    state.balls.push(ball);

    let returned = false;
    for (let i = 0; i < 200 && !returned; i++) {
      returned = step(state).some((e) => e.type === EVENT.PADDLE_HIT);
    }
    assert.ok(returned, "the paddle failed to return a ball aimed straight at it");
    assert.ok(ball.vy < 0, "ball should be travelling upward after the return");
    assert.ok(ball.alive);
  });

  test("returns the ball at wave speed regardless of where it struck", () => {
    for (const offset of [-1.2, -0.5, 0, 0.6, 1.3]) {
      const board = createBoard();
      const state = createState(board, [], 1);
      const ball = createBall(0, state.paddle.x + offset, PADDLE_Y - 1, 0, ballSpeed(1));
      state.balls.push(ball);
      for (let i = 0; i < 200; i++) {
        if (step(state).some((e) => e.type === EVENT.PADDLE_HIT)) break;
      }
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      assert.ok(Math.abs(speed - ballSpeed(1)) < 1e-9, `offset ${offset}: speed ${speed}`);
    }
  });

  test("striking off-centre tilts the return, striking the middle sends it straight", () => {
    function returnVx(offset) {
      const state = createState(createBoard(), [], 1);
      const ball = createBall(0, state.paddle.x + offset, PADDLE_Y - 1, 0, ballSpeed(1));
      state.balls.push(ball);
      for (let i = 0; i < 200; i++) {
        if (step(state).some((e) => e.type === EVENT.PADDLE_HIT)) return ball.vx;
      }
      return null;
    }
    // Not exactly zero by design: PADDLE.MIN_RETURN_TILT stops a centred hit rallying
    // vertically forever. It should still be far smaller than an edge hit.
    assert.ok(Math.abs(returnVx(0)) < Math.abs(returnVx(1.2)) / 2, "a centred hit should come back much straighter than an edge hit");
    assert.notEqual(returnVx(0), 0, "a perfectly vertical return would deadlock the rally");
    assert.ok(returnVx(1.2) > 1, "a right-side hit should come back to the right");
    assert.ok(returnVx(-1.2) < -1, "a left-side hit should come back to the left");
  });

  test("never leaves its lane, so the gutters stay unreachable", () => {
    const wave = 1;
    const travel = paddleTravel(wave);
    const board = createBoard();
    const balls = launchBalls(wave, createRng("LANE"));
    const state = createState(board, balls, wave);

    for (let i = 0; i < 3000 && ballsRemaining(state) > 0; i++) {
      step(state);
      assert.ok(state.paddle.x >= travel.min - 1e-9, `paddle at ${state.paddle.x} below its lane`);
      assert.ok(state.paddle.x <= travel.max + 1e-9, `paddle at ${state.paddle.x} above its lane`);
    }
  });

  test("cannot save a ball dropped down the gutter — the game must be winnable", () => {
    const board = createBoard();
    const state = createState(board, [], 1);
    // Straight down the extreme left edge, past the paddle's reach.
    const ball = createBall(0, BALL.RADIUS, ZONES.BUILD_ROW_END, 0, ballSpeed(1));
    state.balls.push(ball);
    runToCompletion(state, 1000);

    assert.equal(ball.alive, false);
    assert.equal(state.gutterKills, 1, "a ball down the gutter must not be returned");
  });
});

describe("stability", () => {
  test("speed stays constant through a long, busy wave", () => {
    const board = createBoard();
    for (let row = BUILD_ROW; row <= BUILD_ROW + 4; row++) {
      for (let col = 2; col < 10; col++) place(board, "WALL", col, row, null, 999999);
    }
    const wave = 8;
    const state = createState(board, launchBalls(wave, createRng("SPEED")), wave);
    const expected = ballSpeed(wave);

    for (let i = 0; i < 3000 && ballsRemaining(state) > 0; i++) {
      step(state);
      for (const ball of state.balls) {
        if (!ball.alive) continue;
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        assert.ok(Math.abs(speed - expected) < 1e-6, `speed drifted to ${speed} at step ${i}`);
      }
    }
  });

  test("no ball settles into a horizontal groove", () => {
    const board = createBoard();
    const wave = 3;
    const state = createState(board, launchBalls(wave, createRng("GROOVE")), wave);
    const floor = ballSpeed(wave) * BALL.MIN_VERTICAL_FRACTION;

    for (let i = 0; i < 2000 && ballsRemaining(state) > 0; i++) {
      step(state);
      for (const ball of state.balls) {
        if (!ball.alive) continue;
        assert.ok(Math.abs(ball.vy) >= floor - 1e-6, `vy=${ball.vy} fell below the floor`);
      }
    }
  });

  test("a bare board leaves the Core exposed — nothing between ball and castle", () => {
    // Rewritten at T2.11. This used to assert that a bare board rallies forever, but
    // widening the gutters and multiplying Core damage changed the outcome: an empty
    // field now resolves, usually by wrecking the Core. That is the point — an
    // undefended castle should not be a viable way to play.
    const state = createState(createBoard(), launchBalls(1, createRng("BARE")), 1);
    let coreHits = 0;
    for (let i = 0; i < 6000 && ballsRemaining(state) > 0; i++) {
      coreHits += step(state).filter((e) => e.type === EVENT.CORE_HIT).length;
    }
    assert.ok(coreHits > 0, "a bare board took no Core damage at all");
  });

  test("sends the ball down regardless of how it arrived — the funnel primitive", () => {
    // The kicker's whole point: a downward-facing Deflector sends the ball DOWN however
    // it was travelling. As a mirror it could not do this, which is why funnels did not
    // work before T2.11.
    const speed = ballSpeed(1);
    const approaches = [
      { vx: -speed * 0.97, vy: speed * 0.24 },   // shallow drift, leftward
      { vx: 0, vy: -speed },                     // straight up
      { vx: speed * 0.7, vy: -speed * 0.7 }      // rising diagonally
    ];

    for (const approach of approaches) {
      const board = createBoard();
      const cell = { col: 3, row: BUILD_ROW + 4 };
      place(board, "DEFLECTOR", cell.col, cell.row, "NW", 999); // solid NW → throws down-right

      const ball = createBall(0, cell.col + 2.0, cell.row + 0.5, approach.vx, approach.vy);
      const state = createState(board, [ball], 1);

      let deflected = false;
      for (let i = 0; i < 160 && !deflected; i++) {
        deflected = step(state).some((e) => e.type === EVENT.BLOCK_HIT);
      }
      if (!deflected) continue; // some approaches miss; the ones that connect must obey
      assert.ok(ball.vy > 0, `expected a downward exit, got vy=${ball.vy}`);
      assert.ok(ball.vx > 0, `expected a rightward exit, got vx=${ball.vx}`);
    }
  });
});

describe("determinism", () => {
  test("two runs of the same wave produce identical events", () => {
    function run(seed) {
      const board = createBoard();
      for (let col = 2; col < 10; col++) {
        place(board, "WALL", col, BUILD_ROW + 1, null, 999999);
        place(board, "DEFLECTOR", col, BUILD_ROW + 4, "SW", 999999);
      }
      const state = createState(board, launchBalls(6, createRng(seed)), 6);
      return runToCompletion(state, 4000);
    }
    assert.deepEqual(run("DETERMINISM"), run("DETERMINISM"));
  });

  test("two runs of the same wave leave identical boards", () => {
    function run() {
      const board = createBoard();
      for (let col = 2; col < 10; col++) place(board, "BOMB", col, BUILD_ROW + 2, null, 999999);
      const state = createState(board, launchBalls(9, createRng("BOARD")), 9);
      runToCompletion(state, 4000);
      return board.cells;
    }
    assert.deepEqual(run(), run());
  });

  test("a different seed produces a different wave", () => {
    function run(seed) {
      const state = createState(createBoard(), launchBalls(6, createRng(seed)), 6);
      return runToCompletion(state, 4000).length;
    }
    assert.notEqual(run("AAA"), run("ZZZ"));
  });

  test("physics.js calls nothing outside the determinism contract", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = (await readFile(new URL("../public/js/engine/physics.js", import.meta.url), "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const banned of ["Math.random", "Date.now", "performance.now", "Math.sin", "Math.cos",
      "Math.tan", "Math.atan2", "Math.pow", "Math.exp", "Math.log", "Math.hypot"]) {
      assert.ok(!src.includes(banned), `physics.js must not call ${banned}`);
    }
  });
});
