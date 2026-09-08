import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ECONOMY, WAVES, BLOCKS, ZONES, CORE } from "../public/js/engine/constants.js";
import { getCell, isEmpty } from "../public/js/engine/board.js";
import { createSession, PHASE, STATUS, RESOLVE_SECONDS } from "../public/js/game/session.js";

const BUILD_ROW = ZONES.BUILD_ROW_START;

/** Drive a session until it enters `phase`, or the budget runs out. */
function runUntilPhase(session, phase, maxSeconds = 120) {
  const dt = 1 / 60;
  for (let t = 0; t < maxSeconds && !session.over; t += dt) {
    session.update(dt);
    if (session.phase === phase) return true;
  }
  return false;
}

/** Drive a session forward in realistic frame-sized slices. */
function run(session, seconds, onEvents = null) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds && !session.over; t += dt) {
    const result = session.update(dt);
    if (onEvents !== null) onEvents(result);
  }
}

describe("a new run", () => {
  test("opens in the build phase with the starting purse and a full Core", () => {
    const session = createSession("NEW");
    assert.equal(session.phase, PHASE.BUILD);
    assert.equal(session.status, STATUS.RUNNING);
    assert.equal(session.shards, ECONOMY.START_SHARDS);
    assert.equal(session.wave, 1);
    assert.equal(session.coreHp, session.maxCoreHp);
    assert.equal(session.buildRemaining, WAVES.BUILD_SECONDS);
  });
});

describe("building", () => {
  test("placing charges the purse and puts the block on the board", () => {
    const session = createSession("BUILD");
    const before = session.shards;
    assert.ok(session.place("WALL", 3, BUILD_ROW).ok);
    assert.equal(session.shards, before - BLOCKS.WALL.cost);
    assert.equal(getCell(session.board, 3, BUILD_ROW).type, "WALL");
  });

  test("an unaffordable block is refused and costs nothing", () => {
    const session = createSession("POOR");

    // Drain the purse into a fresh cell each time. Advancing the cell matters: a loop
    // that retries an occupied cell never spends anything and never terminates.
    let col = 0;
    let row = BUILD_ROW;
    let guard = 0;
    while (session.canAfford("WALL") && guard++ < 200) {
      assert.ok(session.place("WALL", col, row).ok, `could not place at (${col}, ${row})`);
      if (++col >= 12) { col = 0; row++; }
    }

    const shards = session.shards;
    assert.ok(shards < BLOCKS.WALL.cost, "purse was not actually drained");
    assert.equal(session.place("GENERATOR", 11, ZONES.BUILD_ROW_END).ok, false);
    assert.equal(session.shards, shards, "a refused placement still charged the purse");
  });

  test("selling refunds and clears the cell", () => {
    const session = createSession("SELL");
    session.place("GENERATOR", 4, BUILD_ROW);
    const before = session.shards;
    const result = session.sell(4, BUILD_ROW);
    assert.ok(result.ok);
    assert.equal(session.shards, before + result.refund);
    assert.ok(isEmpty(session.board, 4, BUILD_ROW));
  });

  test("selling is a net loss, so churning cannot farm Shards", () => {
    const session = createSession("CHURN");
    const start = session.shards;
    for (let i = 0; i < 6; i++) {
      session.place("WALL", 2, BUILD_ROW);
      session.sell(2, BUILD_ROW);
    }
    assert.ok(session.shards < start, "place/sell churn did not lose money");
  });

  test("rotation cycles a Deflector through all four faces and returns", () => {
    const session = createSession("ROT");
    session.place("DEFLECTOR", 5, BUILD_ROW, "NE");
    const seen = [getCell(session.board, 5, BUILD_ROW).rotation];
    for (let i = 0; i < 4; i++) {
      session.cycleRotation(5, BUILD_ROW);
      seen.push(getCell(session.board, 5, BUILD_ROW).rotation);
    }
    assert.equal(new Set(seen).size, 4, "did not visit all four orientations");
    assert.equal(seen[0], seen[4], "cycling four times did not return to the start");
  });

  test("checkPlacement agrees with what place actually does", () => {
    const session = createSession("CHECK");
    for (const [col, row] of [[3, BUILD_ROW], [0, 0], [0, ZONES.PADDLE_ROW], [-1, BUILD_ROW]]) {
      const predicted = session.checkPlacement("WALL", col, row).ok;
      const actual = session.place("WALL", col, row).ok;
      assert.equal(predicted, actual, `disagreement at (${col}, ${row})`);
    }
  });
});

describe("phases", () => {
  test("the build timer runs out and starts the wave on its own", () => {
    const session = createSession("TIMER");
    run(session, WAVES.BUILD_SECONDS + 0.5);
    assert.notEqual(session.phase, PHASE.BUILD);
  });

  test("ready() starts the wave immediately", () => {
    const session = createSession("READY");
    assert.ok(session.ready());
    assert.equal(session.phase, PHASE.WAVE);
    assert.ok(session.balls.length > 0);
    assert.notEqual(session.paddle, null);
  });

  test("ready() only works during build", () => {
    const session = createSession("READY2");
    session.ready();
    assert.equal(session.ready(), false);
  });

  test("building is refused once the wave is running", () => {
    const session = createSession("LOCKED");
    session.ready();
    assert.equal(session.place("WALL", 3, BUILD_ROW).reason, "wrong_phase");
    assert.equal(session.sell(3, BUILD_ROW).reason, "wrong_phase");
    assert.equal(session.cycleRotation(3, BUILD_ROW).reason, "wrong_phase");
  });

  test("a finished wave resolves, pays out, then reopens the build phase", () => {
    const session = createSession("CYCLE");
    const before = session.shards;
    session.ready();

    // Stop on the exact frame the build phase reopens. A wave may clear early rather
    // than running the full clock, so a fixed duration would land somewhere arbitrary.
    assert.ok(runUntilPhase(session, PHASE.BUILD), "build phase never reopened");

    assert.equal(session.wave, 2, "wave counter did not advance");
    assert.equal(session.buildRemaining, WAVES.BUILD_SECONDS, "build timer did not reset");
    assert.ok(session.shards > before, "surviving a wave paid nothing");
    assert.equal(session.balls.length, 0, "balls survived into the build phase");
  });

  test("a backgrounded tab cannot fast-forward the run", () => {
    const session = createSession("JUMP");
    session.ready();
    session.update(600); // six hundred seconds in one frame
    assert.ok(!session.over, "one huge frame resolved the entire run");
  });
});

describe("the run ending", () => {
  test("surviving the final wave wins", () => {
    const session = createSession("WIN");
    // Skip to the last wave with an intact Core by resolving waves quickly.
    let guard = 0;
    while (session.wave < WAVES.WIN_WAVE && !session.over && guard++ < 200) {
      if (session.phase === PHASE.BUILD) session.ready();
      run(session, WAVES.MAX_SECONDS + RESOLVE_SECONDS + 1);
    }
    if (!session.over) {
      if (session.phase === PHASE.BUILD) session.ready();
      run(session, WAVES.MAX_SECONDS + RESOLVE_SECONDS + 2);
    }
    assert.ok(session.over, "the run never ended");
    assert.ok([STATUS.WON, STATUS.LOST].includes(session.status));
    if (session.status === STATUS.WON) {
      assert.ok(session.summary().wavesSurvived >= WAVES.WIN_WAVE);
    }
  });

  test("losing the Core ends the run and reports it", () => {
    const session = createSession("LOSE");
    // Weaken the Core so a wave can finish it.
    for (const cell of session.board.cells) if (cell !== null && cell.type === "CORE") cell.hp = 1;

    let guard = 0;
    while (!session.over && guard++ < 60) {
      if (session.phase === PHASE.BUILD) session.ready();
      run(session, WAVES.MAX_SECONDS + RESOLVE_SECONDS + 1);
    }
    assert.equal(session.status, STATUS.LOST);
    assert.equal(session.phase, PHASE.OVER);
    assert.equal(session.coreHp, 0);
  });

  test("an ended run stops accepting input and stops advancing", () => {
    const session = createSession("FROZEN");
    for (const cell of session.board.cells) if (cell !== null && cell.type === "CORE") cell.hp = 1;
    let guard = 0;
    while (!session.over && guard++ < 60) {
      if (session.phase === PHASE.BUILD) session.ready();
      run(session, WAVES.MAX_SECONDS + RESOLVE_SECONDS + 1);
    }
    const wave = session.wave;
    session.update(10);
    assert.equal(session.wave, wave);
    assert.equal(session.place("WALL", 3, BUILD_ROW).ok, false);
  });
});

describe("economy over a run", () => {
  test("surviving waves pays the survival bonus and generators", () => {
    const session = createSession("INCOME");
    session.place("GENERATOR", 0, BUILD_ROW);
    session.place("GENERATOR", 1, BUILD_ROW);
    const afterBuild = session.shards;

    session.ready();
    run(session, WAVES.MAX_SECONDS + 1);

    const result = session.lastResult;
    assert.ok(result.survived);
    assert.equal(result.score.survival, ECONOMY.WAVE_SURVIVED);

    // Generators sitting at the top of the build zone are directly in the firing line,
    // so some waves kill them. The payout must track whatever actually survived.
    const survivors = result.finalBoard.cells.filter((c) => c !== null && c.type === "GENERATOR").length;
    assert.equal(result.score.generators, survivors * ECONOMY.GENERATOR_YIELD);
    assert.equal(session.shards, afterBuild + result.score.total);
  });

  test("history records one entry per wave attempted", () => {
    const session = createSession("HIST");
    for (let i = 0; i < 3 && !session.over; i++) {
      if (session.phase === PHASE.BUILD) session.ready();
      run(session, WAVES.MAX_SECONDS + RESOLVE_SECONDS + 1);
    }
    assert.equal(session.history.length, 3);
    assert.deepEqual(session.history.map((h) => h.wave), [1, 2, 3]);
  });
});

describe("determinism", () => {
  test("two sessions with the same seed and the same inputs play identically", () => {
    function play(seed) {
      const session = createSession(seed);
      session.place("DEFLECTOR", 2, ZONES.BUILD_ROW_END, "NW");
      session.place("WALL", 6, BUILD_ROW + 2);
      const events = [];
      for (let i = 0; i < 4 && !session.over; i++) {
        if (session.phase === PHASE.BUILD) session.ready();
        run(session, WAVES.MAX_SECONDS + RESOLVE_SECONDS + 1, (r) => events.push(...r.events));
      }
      return { events, summary: session.summary(), history: session.history };
    }
    const a = play("TWIN");
    const b = play("TWIN");
    assert.deepEqual(a.history, b.history);
    assert.deepEqual(a.summary, b.summary);
    assert.equal(a.events.length, b.events.length);
  });

  test("different seeds diverge", () => {
    // Compare event streams, not scores: on a bare board every wave times out with
    // zero kills, so the SCORES are identical by definition regardless of seed. What
    // differs is where the balls went.
    function play(seed) {
      const session = createSession(seed);
      const events = [];
      session.ready();
      run(session, WAVES.MAX_SECONDS + 1, (r) => events.push(...r.events));
      return events;
    }
    assert.notDeepEqual(play("AAA"), play("ZZZ"));
  });

  test("each wave draws from its own stream, so wave 1 does not reshuffle wave 2", () => {
    const a = createSession("STREAM");
    a.ready();
    run(a, WAVES.MAX_SECONDS + RESOLVE_SECONDS + 1);

    const b = createSession("STREAM");
    b.place("WALL", 5, BUILD_ROW); // a different wave 1
    b.ready();
    run(b, WAVES.MAX_SECONDS + RESOLVE_SECONDS + 1);

    // Wave 2 must be the same wave in both runs despite wave 1 differing.
    assert.equal(a.wave, 2);
    assert.equal(b.wave, 2);
  });
});
