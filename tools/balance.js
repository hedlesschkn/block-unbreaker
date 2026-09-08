/**
 * Balance harness (task T2.11). Not shipped — `tools/` is outside `public/`.
 *
 * Plays many complete runs headlessly under several fixed strategies and reports what
 * happened. The point is to replace opinion with numbers: the design targets are
 *
 *   passive   a player who does nothing should die EARLY          (~wave 4-7)
 *   walls     naive armour should get somewhat further            (~wave 8-12)
 *   funnel    the intended two-stage strategy should be strong    (~wave 15-20)
 *
 * and, across the board, Shards should end up SPENT rather than hoarded. A pile of
 * unspent currency means the game is not asking enough of the player.
 *
 * Usage:  node tools/balance.js [runsPerStrategy]
 */

import { ZONES, WAVES, BLOCKS, GRID } from "../public/js/engine/constants.js";
import { getCell } from "../public/js/engine/board.js";
import { createSession, PHASE, STATUS } from "../public/js/game/session.js";
import { OUTCOME } from "../public/js/engine/simulate.js";

const DT = 1 / 60;
const BUILD_ROW = ZONES.BUILD_ROW_START;
const LAST_ROW = ZONES.BUILD_ROW_END;

// ─── Strategies ──────────────────────────────────────────────────────────────
// Each is given the session at the start of every build phase and spends what it likes.

const STRATEGIES = {
  /** Places nothing, ever. The floor: this should not get far. */
  passive() {},

  /** Naive armour: stack walls directly under the Core. */
  walls(session) {
    for (let row = BUILD_ROW; row <= BUILD_ROW + 3; row++) {
      for (let col = 3; col <= 8; col++) {
        if (!session.canAfford("WALL")) return;
        session.place("WALL", col, row);
      }
    }
  },

  /** The intended strategy: a two-stage funnel feeding both gutters. */
  funnel(session) {
    // Stage two first — tip flattened balls down into the gutters. Cheapest to reach
    // and the half that actually scores.
    const stageTwo = [
      [1, LAST_ROW, "NW"], [10, LAST_ROW, "NE"],
      [1, LAST_ROW - 1, "NW"], [10, LAST_ROW - 1, "NE"]
    ];
    // Stage one — flatten descending balls out toward the walls.
    const stageOne = [
      [4, LAST_ROW - 4, "NE"], [7, LAST_ROW - 4, "NW"],
      [3, LAST_ROW - 6, "NE"], [8, LAST_ROW - 6, "NW"]
    ];

    for (const [col, row, rot] of [...stageTwo, ...stageOne]) {
      if (getCell(session.board, col, row) !== null) continue;
      if (!session.canAfford("DEFLECTOR")) return;
      session.place("DEFLECTOR", col, row, rot);
    }

    // Then armour the Core with whatever is left.
    for (let row = BUILD_ROW; row <= BUILD_ROW + 2; row++) {
      for (let col = 3; col <= 8; col++) {
        if (!session.canAfford("WALL")) return;
        if (getCell(session.board, col, row) === null) session.place("WALL", col, row);
      }
    }
  },

  /**
   * A FULL-WIDTH wall shield. The partial shield in `walls` leaves columns 0-2 and
   * 9-11 open, and balls simply travel up the outside and drop onto the Core from
   * above — so it tests bad positioning, not whether armour works.
   */
  shield(session) {
    for (let row = BUILD_ROW; row <= BUILD_ROW + 5; row++) {
      for (let col = 0; col < GRID.COLS; col++) {
        if (!session.canAfford("WALL")) return;
        if (getCell(session.board, col, row) === null) session.place("WALL", col, row);
      }
    }
  },

  /**
   * A full-width row of Deflectors angled outward, to throw everything toward the side
   * walls, plus stage-two deflectors in the bottom corners to tip it into the gutters.
   * This is the strategy the design is supposed to reward.
   */
  sweep(session) {
    const mid = GRID.COLS / 2;
    for (let col = 0; col < GRID.COLS; col++) {
      const row = BUILD_ROW + 2;
      if (getCell(session.board, col, row) !== null) continue;
      if (!session.canAfford("DEFLECTOR")) break;
      session.place("DEFLECTOR", col, row, col < mid ? "NE" : "NW");
    }
    for (const [col, row, rot] of [[0, LAST_ROW, "NW"], [11, LAST_ROW, "NE"],
                                   [0, LAST_ROW - 2, "NW"], [11, LAST_ROW - 2, "NE"]]) {
      if (getCell(session.board, col, row) !== null) continue;
      if (!session.canAfford("DEFLECTOR")) break;
      session.place("DEFLECTOR", col, row, rot);
    }
    for (let col = 0; col < GRID.COLS; col++) {
      if (!session.canAfford("WALL")) return;
      if (getCell(session.board, col, BUILD_ROW) === null) session.place("WALL", col, BUILD_ROW);
    }
  },

  /**
   * Shield first, then Deflectors in the outer columns to tip the shield's returns
   * into the gutters. Tests whether Deflectors COMPLEMENT armour even though they
   * cannot replace it.
   */
  shieldPlusDeflectors(session) {
    // Backbone: two full-width wall rows.
    for (let row = BUILD_ROW; row <= BUILD_ROW + 1; row++) {
      for (let col = 0; col < GRID.COLS; col++) {
        if (!session.canAfford("WALL")) return;
        if (getCell(session.board, col, row) === null) session.place("WALL", col, row);
      }
    }
    // Scoring: outer-column deflectors angled toward the gutters.
    for (let row = LAST_ROW; row >= LAST_ROW - 4; row--) {
      for (const [col, rot] of [[0, "NW"], [11, "NE"]]) {
        if (getCell(session.board, col, row) !== null) continue;
        if (!session.canAfford("DEFLECTOR")) break;
        session.place("DEFLECTOR", col, row, rot);
      }
    }
    // Then deepen the shield with whatever is left.
    for (let row = BUILD_ROW + 2; row <= BUILD_ROW + 5; row++) {
      for (let col = 0; col < GRID.COLS; col++) {
        if (!session.canAfford("WALL")) return;
        if (getCell(session.board, col, row) === null) session.place("WALL", col, row);
      }
    }
  },

  /** Buys Generators first, then funnels. Tests whether economy play is viable. */
  economy(session) {
    for (const [col, row] of [[0, BUILD_ROW + 6], [11, BUILD_ROW + 6], [0, BUILD_ROW + 7], [11, BUILD_ROW + 7]]) {
      if (getCell(session.board, col, row) !== null) continue;
      if (!session.canAfford("GENERATOR")) break;
      session.place("GENERATOR", col, row);
    }
    STRATEGIES.funnel(session);
  }
};

// ─── Running ─────────────────────────────────────────────────────────────────

function playRun(strategyName, seed) {
  const session = createSession(seed);
  const strategy = STRATEGIES[strategyName];
  let guard = 0;
  let peakShards = 0;

  while (!session.over && guard++ < 400) {
    if (session.phase === PHASE.BUILD) {
      strategy(session);
      peakShards = Math.max(peakShards, session.shards);
      session.ready();
    }
    // Run until the phase changes back to build, or the run ends.
    let frames = 0;
    while (!session.over && session.phase !== PHASE.BUILD && frames++ < 20000) session.update(DT);
    if (frames >= 20000) break;
  }

  const summary = session.summary();
  const outcomes = session.history.reduce((acc, h) => {
    acc[h.outcome] = (acc[h.outcome] ?? 0) + 1;
    return acc;
  }, {});

  return { ...summary, peakShards, outcomes };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function report(name, runs) {
  const waves = runs.map((r) => r.wavesSurvived);
  const wins = runs.filter((r) => r.status === STATUS.WON).length;
  const cleared = runs.reduce((n, r) => n + (r.outcomes[OUTCOME.CLEARED] ?? 0), 0);
  const timedOut = runs.reduce((n, r) => n + (r.outcomes[OUTCOME.TIMED_OUT] ?? 0), 0);
  const totalWaves = cleared + timedOut + runs.reduce((n, r) => n + (r.outcomes[OUTCOME.CORE_DESTROYED] ?? 0), 0);

  return {
    strategy: name,
    medianWave: median(waves),
    minWave: Math.min(...waves),
    maxWave: Math.max(...waves),
    winRate: `${((wins / runs.length) * 100).toFixed(0)}%`,
    wavesCleared: `${((cleared / Math.max(1, totalWaves)) * 100).toFixed(0)}%`,
    medianEndShards: median(runs.map((r) => r.shards)),
    medianGutterKills: median(runs.map((r) => r.gutterKills))
  };
}

const RUNS = Number(process.argv[2] ?? 24);

console.log(`Block Unbreaker — balance report  (${RUNS} runs per strategy, win at wave ${WAVES.WIN_WAVE})\n`);

const rows = [];
for (const name of Object.keys(STRATEGIES)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(playRun(name, `BAL-${name}-${i}`));
  rows.push(report(name, runs));
}
console.table(rows);

console.log("\nTargets: passive dies ~4-7 · walls ~8-12 · funnel ~15-20 · end Shards should be LOW.");
