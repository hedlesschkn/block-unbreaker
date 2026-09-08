/**
 * `simulateWave()` — the pure entry point the whole architecture rests on.
 *
 * Give it a board, a wave config and a seed; it plays the entire wave out and hands
 * back what happened. It touches no DOM, reads no clock, and calls no `Math.random`.
 * Given the same three inputs it returns the same answer on every machine, forever.
 *
 * That property is what lets the Durable Object be the sole authority without
 * streaming 60 physics frames a second to everybody (ProductSpec §9):
 *
 *   - the DO calls this at wave start and broadcasts the result. It did not trust a
 *     client; it computed the answer itself.
 *   - each browser calls the identical function and steps it in real time to render.
 *     A client that disagrees with the broadcast is wrong, and re-syncs.
 *
 * Cost is bounded: a wave is at most WAVES.MAX_SECONDS of fixed steps over a few
 * dozen objects, resolved once per wave rather than sixty times a second.
 */

import { SIM, WAVES, ECONOMY, ballSpeed } from "./constants.js";
import { clone, coreHp, isCoreDestroyed, generatorYield } from "./board.js";
import { createRng } from "./rng.js";
import { EVENT, launchBalls, createState, step, ballsRemaining } from "./physics.js";

/** How a wave finished. */
export const OUTCOME = Object.freeze({
  /** Every ball was eliminated. The normal ending. */
  CLEARED: "cleared",
  /** The Core fell. The run is over. */
  CORE_DESTROYED: "core_destroyed",
  /** The wave clock expired with balls still in play. They pay nothing. */
  TIMED_OUT: "timed_out"
});

/** Steps a wave may run before the clock cuts it off. */
export function maxStepsForWave() {
  return Math.min(SIM.MAX_STEPS, Math.round(WAVES.MAX_SECONDS / SIM.TIMESTEP));
}

/**
 * Shards earned by a finished wave. ProductSpec §5.
 *
 * Survival and Generator income are only paid when the Core is still standing —
 * there is no consolation prize for the wave that ended your run.
 */
export function scoreWave(board, tally, survived, outcome = OUTCOME.CLEARED) {
  const gutter = tally.gutterKills * ECONOMY.GUTTER_KILL;
  const absorbed = tally.absorbKills * ECONOMY.ABSORB_KILL;

  // Outlasting the clock is not the same as beating the wave.
  const survivalRate = outcome === OUTCOME.TIMED_OUT ? ECONOMY.TIMEOUT_SURVIVAL_FRACTION : 1;
  const survival = survived ? Math.round(ECONOMY.WAVE_SURVIVED * survivalRate) : 0;
  const generators = survived ? generatorYield(board) : 0;

  return {
    gutterKills: tally.gutterKills,
    absorbKills: tally.absorbKills,
    gutter,
    absorbed,
    survival,
    generators,
    total: gutter + absorbed + survival + generators
  };
}

/**
 * Run a whole wave.
 *
 * @param {object} board       Starting board. NOT mutated — it is cloned first.
 * @param {object} waveConfig  `{ wave }`, plus optional `{ extraBalls }` from sabotage.
 * @param {number|string} seed The wave seed, chosen and broadcast by the Durable Object.
 *
 * @returns {{
 *   events: object[],      timestamped timeline, oldest first
 *   finalBoard: object,    the board after the wave
 *   outcome: string,       one of OUTCOME
 *   steps: number,         fixed steps elapsed
 *   duration: number,      seconds of game time
 *   score: object,         Shards earned, itemised
 *   coreHp: number,        Core HP remaining
 *   survived: boolean
 * }}
 */
export function simulateWave(board, waveConfig, seed) {
  const wave = waveConfig.wave;
  const extraBalls = waveConfig.extraBalls ?? 0;

  // Clone so a caller can re-run the same wave from the same starting board — which
  // the renderer does on every replay, and the DO does when verifying a client.
  const working = clone(board);

  const rng = createRng(seed);
  const balls = launchBalls(wave, rng, extraBalls);
  const state = createState(working, balls, wave);

  const events = balls.map((ball) => ({
    t: 0,
    type: EVENT.BALL_SPAWNED,
    ball: ball.id,
    x: ball.x,
    y: ball.y,
    vx: ball.vx,
    vy: ball.vy
  }));

  const cap = maxStepsForWave();
  let outcome = OUTCOME.CLEARED;

  while (state.step < cap) {
    if (ballsRemaining(state) === 0) break;

    for (const event of step(state)) events.push(event);

    // The run can end mid-wave. Stop immediately rather than simulating rubble.
    if (isCoreDestroyed(working)) {
      outcome = OUTCOME.CORE_DESTROYED;
      break;
    }
  }

  if (outcome === OUTCOME.CLEARED && ballsRemaining(state) > 0) {
    outcome = OUTCOME.TIMED_OUT;
    // Balls left at the bell are simply removed. They were never killed, so they pay
    // nothing — see WAVES.MAX_SECONDS.
    for (const ball of state.balls) ball.alive = false;
  }

  const survived = outcome !== OUTCOME.CORE_DESTROYED;

  return {
    events,
    finalBoard: working,
    outcome,
    steps: state.step,
    duration: state.step * SIM.TIMESTEP,
    score: scoreWave(working, state, survived, outcome),
    coreHp: coreHp(working),
    survived
  };
}

/**
 * A resumable wave, for the renderer.
 *
 * Same simulation, surrendered one step at a time so the browser can draw between
 * steps. Seeded and stepped identically to `simulateWave`, so replaying a wave this
 * way lands on exactly the same final board.
 */
export function createWaveRunner(board, waveConfig, seed) {
  const wave = waveConfig.wave;
  const rng = createRng(seed);
  const working = clone(board);
  const balls = launchBalls(wave, rng, waveConfig.extraBalls ?? 0);
  const state = createState(working, balls, wave);
  const cap = maxStepsForWave();

  let outcome = null;

  return {
    state,
    board: working,
    get balls() {
      return state.balls;
    },
    get paddle() {
      return state.paddle;
    },
    get finished() {
      return outcome !== null;
    },
    get outcome() {
      return outcome;
    },

    /** Advance one fixed step. Returns that step's events. */
    advance() {
      if (outcome !== null) return [];

      if (ballsRemaining(state) === 0) {
        outcome = OUTCOME.CLEARED;
        return [];
      }
      if (state.step >= cap) {
        outcome = OUTCOME.TIMED_OUT;
        for (const ball of state.balls) ball.alive = false;
        return [];
      }

      const events = step(state);
      if (isCoreDestroyed(working)) outcome = OUTCOME.CORE_DESTROYED;
      else if (ballsRemaining(state) === 0) outcome = OUTCOME.CLEARED;
      return events;
    },

    /** The same result shape `simulateWave` returns, once finished. */
    result() {
      const survived = outcome !== OUTCOME.CORE_DESTROYED;
      return {
        finalBoard: working,
        outcome: outcome ?? OUTCOME.CLEARED,
        steps: state.step,
        duration: state.step * SIM.TIMESTEP,
        score: scoreWave(working, state, survived, outcome ?? OUTCOME.CLEARED),
        coreHp: coreHp(working),
        survived
      };
    }
  };
}
