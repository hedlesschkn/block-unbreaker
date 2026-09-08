/**
 * A single-player run: the phase machine, the purse, and the wave counter.
 *
 * Time enters only through `update(dt)` — the session never reads a clock itself.
 * That keeps it testable headlessly, and it is also the shape Phase 3 needs: the
 * Durable Object will drive the same transitions from the Alarms API rather than from
 * a browser's animation frames (ProductSpec §9).
 *
 * Randomness enters only through the seed, so a run is reproducible end to end.
 */

import { ECONOMY, WAVES, SIM, CORE, waveConfig } from "../engine/constants.js";
import {
  createBoard, place as placeBlock, sell as sellBlock, rotate as rotateBlock,
  canPlace, getCell, coreHp, BLOCK_DEFS, REJECT
} from "../engine/board.js";
import { ROTATIONS } from "../engine/constants.js";
import { createWaveRunner, OUTCOME } from "../engine/simulate.js";
import { deriveSeed } from "../engine/rng.js";

export const PHASE = Object.freeze({
  BUILD: "build",
  WAVE: "wave",
  RESOLVE: "resolve",
  OVER: "over"
});

export const STATUS = Object.freeze({
  RUNNING: "running",
  WON: "won",
  LOST: "lost"
});

/** How long the resolve card stays up before the next build phase opens. */
export const RESOLVE_SECONDS = 2.4;

export function createSession(seed = "SOLO") {
  let board = createBoard();
  let shards = ECONOMY.START_SHARDS;
  let wave = 1;
  let phase = PHASE.BUILD;
  let status = STATUS.RUNNING;

  let buildRemaining = WAVES.BUILD_SECONDS;
  let resolveRemaining = 0;
  let runner = null;
  let lastResult = null;
  let accumulator = 0;

  const history = [];
  let totalGutterKills = 0;
  let totalAbsorbKills = 0;

  /** Seed for a given wave. Each wave gets its own stream — see rng.deriveSeed. */
  function seedForWave(n) {
    return deriveSeed(seed, n);
  }

  function startWave() {
    runner = createWaveRunner(board, waveConfig(wave), seedForWave(wave));
    accumulator = 0;
    phase = PHASE.WAVE;
    return runner;
  }

  function finishWave() {
    const result = runner.result();
    lastResult = result;
    board = result.finalBoard;
    shards += result.score.total;
    totalGutterKills += result.score.gutterKills;
    totalAbsorbKills += result.score.absorbKills;

    history.push({
      wave,
      outcome: result.outcome,
      score: result.score,
      coreHp: result.coreHp,
      duration: result.duration
    });

    if (!result.survived) {
      status = STATUS.LOST;
      phase = PHASE.OVER;
      return result;
    }
    if (wave >= WAVES.WIN_WAVE) {
      status = STATUS.WON;
      phase = PHASE.OVER;
      return result;
    }

    wave += 1;
    phase = PHASE.RESOLVE;
    resolveRemaining = RESOLVE_SECONDS;
    return result;
  }

  return {
    // ── Reading state ──────────────────────────────────────────────────────
    get board() { return runner !== null && phase === PHASE.WAVE ? runner.board : board; },
    get shards() { return shards; },
    get wave() { return wave; },
    get phase() { return phase; },
    get status() { return status; },
    get over() { return phase === PHASE.OVER; },
    get balls() { return phase === PHASE.WAVE && runner !== null ? runner.balls : []; },
    get paddle() { return phase === PHASE.WAVE && runner !== null ? runner.paddle : null; },
    get coreHp() { return coreHp(this.board); },
    get maxCoreHp() { return CORE.COLS * CORE.ROWS * CORE.HP; },
    get buildRemaining() { return Math.max(0, buildRemaining); },
    get lastResult() { return lastResult; },
    get history() { return history.slice(); },
    get seed() { return seed; },
    get totals() {
      return { gutterKills: totalGutterKills, absorbKills: totalAbsorbKills, waves: history.length };
    },

    /** Can this block go here right now? Includes the phase check the board cannot see. */
    canAfford(type) {
      return shards >= BLOCK_DEFS[type].cost;
    },

    checkPlacement(type, col, row) {
      if (phase !== PHASE.BUILD) return { ok: false, reason: "wrong_phase" };
      return canPlace(board, type, col, row, shards);
    },

    // ── Build actions ──────────────────────────────────────────────────────

    place(type, col, row, rotation = ROTATIONS[0]) {
      if (phase !== PHASE.BUILD) return { ok: false, reason: "wrong_phase" };
      const result = placeBlock(board, type, col, row, rotation, shards);
      if (result.ok) shards -= result.cost;
      return result;
    },

    sell(col, row) {
      if (phase !== PHASE.BUILD) return { ok: false, reason: "wrong_phase" };
      const result = sellBlock(board, col, row);
      if (result.ok) shards += result.refund;
      return result;
    },

    /** Cycle a placed Deflector through its four orientations. Free. */
    cycleRotation(col, row) {
      if (phase !== PHASE.BUILD) return { ok: false, reason: "wrong_phase" };
      const cell = getCell(board, col, row);
      if (cell === null) return { ok: false, reason: REJECT.EMPTY_CELL };
      const next = ROTATIONS[(ROTATIONS.indexOf(cell.rotation) + 1) % ROTATIONS.length];
      return rotateBlock(board, col, row, next);
    },

    /** End the build phase early. */
    ready() {
      if (phase !== PHASE.BUILD) return false;
      startWave();
      return true;
    },

    // ── Time ───────────────────────────────────────────────────────────────

    /**
     * Advance the run.
     *
     * @param dt seconds elapsed. Clamped internally, so a backgrounded tab that
     *           returns after thirty seconds does not fast-forward a whole wave.
     * @returns  `{ events, waveStarted, waveFinished }`
     */
    update(dt) {
      const step = Math.min(dt, 0.25);
      const events = [];
      let waveStarted = false;
      let waveFinished = false;

      if (phase === PHASE.BUILD) {
        buildRemaining -= step;
        if (buildRemaining <= 0) {
          startWave();
          waveStarted = true;
        }
      } else if (phase === PHASE.WAVE) {
        accumulator += step;
        while (accumulator >= SIM.TIMESTEP && !runner.finished) {
          for (const event of runner.advance()) events.push(event);
          accumulator -= SIM.TIMESTEP;
        }
        if (runner.finished) {
          finishWave();
          waveFinished = true;
        }
      } else if (phase === PHASE.RESOLVE) {
        resolveRemaining -= step;
        if (resolveRemaining <= 0) {
          phase = PHASE.BUILD;
          buildRemaining = WAVES.BUILD_SECONDS;
        }
      }

      return { events, waveStarted, waveFinished };
    },

    /** Final tally for the results screen. */
    summary() {
      return {
        status,
        wavesSurvived: status === STATUS.LOST ? history.length - 1 : history.length,
        wavesAttempted: history.length,
        shards,
        coreHp: coreHp(board),
        maxCoreHp: CORE.COLS * CORE.ROWS * CORE.HP,
        gutterKills: totalGutterKills,
        absorbKills: totalAbsorbKills,
        seed
      };
    }
  };
}
