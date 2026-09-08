import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { SIM, WAVES, ECONOMY, CORE, ZONES, waveConfig } from "../public/js/engine/constants.js";
import { createBoard, place, coreHp, isCoreDestroyed, serialize } from "../public/js/engine/board.js";
import { simulateWave, createWaveRunner, scoreWave, maxStepsForWave, OUTCOME } from "../public/js/engine/simulate.js";
import { EVENT } from "../public/js/engine/physics.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD_ROW = ZONES.BUILD_ROW_START;

/** A board with a few blocks on it, deterministic. */
function stockedBoard() {
  const board = createBoard();
  for (let col = 2; col < 10; col++) {
    place(board, "WALL", col, BUILD_ROW + 1, null, 999999);
    place(board, "DEFLECTOR", col, BUILD_ROW + 5, col % 2 === 0 ? "NW" : "NE", 999999);
  }
  return board;
}

describe("running a wave", () => {
  test("returns a complete result", () => {
    const result = simulateWave(createBoard(), waveConfig(1), "SEED");
    for (const key of ["events", "finalBoard", "outcome", "steps", "duration", "score", "coreHp", "survived"]) {
      assert.ok(key in result, `result is missing ${key}`);
    }
    assert.ok(Object.values(OUTCOME).includes(result.outcome));
  });

  test("does not mutate the board it was given", () => {
    const board = stockedBoard();
    const before = JSON.stringify(serialize(board));
    simulateWave(board, waveConfig(6), "NO-MUTATE");
    assert.equal(JSON.stringify(serialize(board)), before, "simulateWave modified its input board");
  });

  test("always terminates, at or under the wave clock", () => {
    for (const wave of [1, 5, 10, 20]) {
      const result = simulateWave(stockedBoard(), waveConfig(wave), `END-${wave}`);
      assert.ok(result.steps <= maxStepsForWave(), `wave ${wave} ran past the cap`);
      assert.ok(result.duration <= WAVES.MAX_SECONDS + SIM.TIMESTEP, `wave ${wave} ran ${result.duration}s`);
    }
  });

  test("opens with one BALL_SPAWNED per ball, at t=0", () => {
    const result = simulateWave(createBoard(), waveConfig(7), "SPAWN");
    const spawns = result.events.filter((e) => e.type === EVENT.BALL_SPAWNED);
    assert.equal(spawns.length, waveConfig(7).balls);
    for (const spawn of spawns) assert.equal(spawn.t, 0);
  });

  test("the timeline is ordered, oldest first", () => {
    const result = simulateWave(stockedBoard(), waveConfig(9), "ORDER");
    let last = -1;
    for (const event of result.events) {
      assert.ok(event.t >= last, `event at t=${event.t} came after t=${last}`);
      last = event.t;
    }
  });

  test("sabotage balls are added to the wave's own count", () => {
    const plain = simulateWave(createBoard(), waveConfig(1), "SAB");
    const sabotaged = simulateWave(createBoard(), { ...waveConfig(1), extraBalls: 3 }, "SAB");
    const count = (r) => r.events.filter((e) => e.type === EVENT.BALL_SPAWNED).length;
    assert.equal(count(sabotaged), count(plain) + 3);
  });
});

describe("outcomes", () => {
  test("a wave the paddle can hold times out rather than hanging", () => {
    const result = simulateWave(createBoard(), waveConfig(1), "HOLD");
    assert.equal(result.outcome, OUTCOME.TIMED_OUT);
    assert.ok(result.survived, "timing out is not losing");
  });

  test("timed-out balls pay nothing — tanking must not be a strategy", () => {
    const result = simulateWave(createBoard(), waveConfig(1), "HOLD");
    assert.equal(result.score.gutterKills, 0);
    assert.equal(result.score.absorbKills, 0);
    assert.equal(result.score.gutter, 0);
    assert.equal(result.score.absorbed, 0);
  });

  test("absorbers clear a wave, and that counts as cleared", () => {
    const board = createBoard();
    // A full shelf of absorbers: every ball that rises into it is eaten.
    for (let col = 0; col < 12; col++) {
      place(board, "ABSORBER", col, BUILD_ROW + 2, null, 9999999);
      place(board, "ABSORBER", col, BUILD_ROW + 3, null, 9999999);
    }
    const result = simulateWave(board, waveConfig(1), "ABSORB");
    assert.equal(result.outcome, OUTCOME.CLEARED);
    assert.ok(result.score.absorbKills > 0);
    assert.ok(result.survived);
  });

  test("a wave that destroys the Core reports CORE_DESTROYED and did not survive", () => {
    // Start the Core at 1 HP a block so this resolves quickly.
    const board = createBoard();
    for (const cell of board.cells) if (cell !== null && cell.type === "CORE") cell.hp = 1;

    let result = null;
    for (let attempt = 0; attempt < 40 && (result === null || result.survived); attempt++) {
      result = simulateWave(board, waveConfig(12), `KILL-${attempt}`);
    }
    assert.equal(result.outcome, OUTCOME.CORE_DESTROYED);
    assert.equal(result.survived, false);
    assert.ok(isCoreDestroyed(result.finalBoard));
    assert.equal(result.coreHp, 0);
  });

  test("a lost wave pays no survival bonus and no Generator income", () => {
    const board = createBoard();
    for (const cell of board.cells) if (cell !== null && cell.type === "CORE") cell.hp = 1;
    place(board, "GENERATOR", 0, BUILD_ROW, null, 9999);

    let result = null;
    for (let attempt = 0; attempt < 40 && (result === null || result.survived); attempt++) {
      result = simulateWave(board, waveConfig(12), `LOSE-${attempt}`);
    }
    assert.equal(result.survived, false);
    assert.equal(result.score.survival, 0);
    assert.equal(result.score.generators, 0);
  });
});

describe("scoring", () => {
  test("itemises correctly and the total adds up", () => {
    const board = createBoard();
    place(board, "GENERATOR", 0, BUILD_ROW, null, 9999);
    place(board, "GENERATOR", 1, BUILD_ROW, null, 9999);

    const score = scoreWave(board, { gutterKills: 3, absorbKills: 2 }, true);
    assert.equal(score.gutter, 3 * ECONOMY.GUTTER_KILL);
    assert.equal(score.absorbed, 2 * ECONOMY.ABSORB_KILL);
    assert.equal(score.survival, ECONOMY.WAVE_SURVIVED);
    assert.equal(score.generators, 2 * ECONOMY.GENERATOR_YIELD);
    assert.equal(score.total, score.gutter + score.absorbed + score.survival + score.generators);
  });

  test("a gutter kill is worth more than an absorb kill", () => {
    const gutter = scoreWave(createBoard(), { gutterKills: 1, absorbKills: 0 }, true).total;
    const absorb = scoreWave(createBoard(), { gutterKills: 0, absorbKills: 1 }, true).total;
    assert.ok(gutter > absorb, "the reward gap that steers strategy has been lost");
  });

  test("a destroyed Generator stops paying", () => {
    const board = createBoard();
    assert.equal(scoreWave(board, { gutterKills: 0, absorbKills: 0 }, true).generators, 0);
  });
});

describe("determinism", () => {
  test("the same seed gives an identical timeline and an identical final board", () => {
    const a = simulateWave(stockedBoard(), waveConfig(8), "IDENTICAL");
    const b = simulateWave(stockedBoard(), waveConfig(8), "IDENTICAL");
    assert.deepEqual(a.events, b.events);
    assert.deepEqual(serialize(a.finalBoard), serialize(b.finalBoard));
    assert.deepEqual(a.score, b.score);
    assert.equal(a.steps, b.steps);
    assert.equal(a.outcome, b.outcome);
  });

  test("different seeds give different waves", () => {
    const a = simulateWave(stockedBoard(), waveConfig(8), "ALPHA");
    const b = simulateWave(stockedBoard(), waveConfig(8), "BETA");
    assert.notDeepEqual(a.events, b.events);
  });

  /**
   * The architectural claim in ProductSpec §9, tested directly: a separate process —
   * standing in for the Durable Object — must reach exactly the result this process
   * does. If this ever fails, multiplayer desyncs.
   */
  test("a separate process reaches the identical result", () => {
    const script = `
      import { createBoard, place, serialize } from ${JSON.stringify(resolve(HERE, "../public/js/engine/board.js"))};
      import { simulateWave } from ${JSON.stringify(resolve(HERE, "../public/js/engine/simulate.js"))};
      import { waveConfig, ZONES } from ${JSON.stringify(resolve(HERE, "../public/js/engine/constants.js"))};
      const board = createBoard();
      for (let col = 2; col < 10; col++) {
        place(board, "WALL", col, ZONES.BUILD_ROW_START + 1, null, 999999);
        place(board, "DEFLECTOR", col, ZONES.BUILD_ROW_START + 5, col % 2 === 0 ? "NW" : "NE", 999999);
      }
      const r = simulateWave(board, waveConfig(8), "CROSS-PROCESS-WAVE");
      process.stdout.write(JSON.stringify({
        events: r.events, board: serialize(r.finalBoard), score: r.score,
        steps: r.steps, outcome: r.outcome, coreHp: r.coreHp
      }));
    `;
    const child = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024
    }));

    const mine = simulateWave(stockedBoard(), waveConfig(8), "CROSS-PROCESS-WAVE");
    assert.equal(child.steps, mine.steps);
    assert.equal(child.outcome, mine.outcome);
    assert.equal(child.coreHp, mine.coreHp);
    assert.deepEqual(child.score, mine.score);
    assert.deepEqual(child.board, serialize(mine.finalBoard));
    assert.deepEqual(child.events, mine.events);
  });
});

describe("the renderer's step-at-a-time runner", () => {
  test("lands on exactly the same result as the one-shot simulation", () => {
    const config = waveConfig(9);
    const oneShot = simulateWave(stockedBoard(), config, "RUNNER");

    const runner = createWaveRunner(stockedBoard(), config, "RUNNER");
    const events = [];
    let guard = 0;
    while (!runner.finished && guard++ < maxStepsForWave() + 10) events.push(...runner.advance());

    assert.ok(runner.finished, "runner never finished");
    const result = runner.result();
    assert.equal(result.steps, oneShot.steps);
    assert.equal(result.outcome, oneShot.outcome);
    assert.deepEqual(result.score, oneShot.score);
    assert.deepEqual(serialize(result.finalBoard), serialize(oneShot.finalBoard));

    // The one-shot timeline carries the spawn events; the runner emits them per step.
    const spawnless = oneShot.events.filter((e) => e.type !== EVENT.BALL_SPAWNED);
    assert.deepEqual(events, spawnless);
  });

  test("exposes live balls and paddle for drawing", () => {
    const runner = createWaveRunner(createBoard(), waveConfig(4), "LIVE");
    assert.equal(runner.balls.length, waveConfig(4).balls);
    assert.ok(typeof runner.paddle.x === "number");
    runner.advance();
    assert.ok(runner.balls.every((b) => typeof b.x === "number" && typeof b.y === "number"));
  });

  test("advancing past the end is a harmless no-op", () => {
    const runner = createWaveRunner(createBoard(), waveConfig(1), "OVERRUN");
    let guard = 0;
    while (!runner.finished && guard++ < maxStepsForWave() + 10) runner.advance();
    assert.deepEqual(runner.advance(), []);
    assert.deepEqual(runner.advance(), []);
    assert.ok(runner.finished);
  });
});

describe("cost", () => {
  test("a worst-case wave stays well inside a single Durable Object invocation", () => {
    const board = createBoard();
    for (let row = BUILD_ROW; row <= ZONES.BUILD_ROW_END; row++) {
      for (let col = 0; col < 12; col++) place(board, "WALL", col, row, null, 99999999);
    }
    const started = process.hrtime.bigint();
    simulateWave(board, waveConfig(20), "COST");
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 400, `a full wave took ${ms.toFixed(1)}ms`);
  });
});
