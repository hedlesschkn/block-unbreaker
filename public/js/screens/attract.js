/**
 * The title screen's attract mode: a real game simulating itself behind the wordmark.
 *
 * It runs the actual engine on a pre-built board rather than an animation, so what a
 * new player watches is genuinely the game — including balls dropping down the gutters,
 * which is the one idea the whole design rests on.
 */

import { ZONES, waveConfig, SIM } from "../engine/constants.js";
import { createBoard, place } from "../engine/board.js";
import { createWaveRunner } from "../engine/simulate.js";
import { createRenderer } from "../render/canvas.js";

/** A board that shows off the two-stage funnel rather than a random scatter. */
function showcaseBoard() {
  const board = createBoard();
  const R = ZONES.BUILD_ROW_START;

  for (let col = 3; col <= 8; col++) place(board, "WALL", col, R + 1, null, 1e9);
  place(board, "GENERATOR", 5, R + 3, null, 1e9);
  place(board, "GENERATOR", 6, R + 3, null, 1e9);
  place(board, "BOMB", 8, R + 5, null, 1e9);
  place(board, "ABSORBER", 3, R + 5, null, 1e9);

  // Stage one: flatten descending balls out toward the walls.
  for (const col of [4, 7]) place(board, "DEFLECTOR", col, R + 7, col === 4 ? "NE" : "NW", 1e9);
  // Stage two: tip the flattened balls down into the gutters.
  place(board, "DEFLECTOR", 1, ZONES.BUILD_ROW_END, "NW", 1e9);
  place(board, "DEFLECTOR", 10, ZONES.BUILD_ROW_END, "NE", 1e9);

  return board;
}

export function createAttract(canvas) {
  const renderer = createRenderer(canvas);
  let runner = null;
  let running = false;
  let last = 0;
  let accumulator = 0;
  let round = 0;

  function reset() {
    round += 1;
    runner = createWaveRunner(showcaseBoard(), waveConfig(6), `ATTRACT-${round}`);
    renderer.clearTrails();
    accumulator = 0;
  }

  function frame(now) {
    if (!running) return;
    const dt = last === 0 ? 0 : Math.min((now - last) / 1000, 0.1);
    last = now;

    accumulator += dt;
    while (accumulator >= SIM.TIMESTEP && !runner.finished) {
      runner.advance();
      accumulator -= SIM.TIMESTEP;
    }
    if (runner.finished) reset();

    renderer.draw({ board: runner.board, balls: runner.balls, paddle: runner.paddle, ghost: null }, now);
    requestAnimationFrame(frame);
  }

  function onResize() { renderer.resize(); }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      reset();
      renderer.resize();
      window.addEventListener("resize", onResize);
      requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      window.removeEventListener("resize", onResize);
    }
  };
}
