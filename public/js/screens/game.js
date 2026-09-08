/**
 * The game screen: input, the animation loop, and the wiring between the session, the
 * renderer and the HUD.
 *
 * Controls, kept to what a player can discover in five seconds:
 *   1-5 / click palette  select a block
 *   click empty cell     place it
 *   click your deflector rotate it
 *   right-click a block  sell it
 *   R                    pre-rotate the block about to be placed
 *   Space                ready up
 */

import { GRID, ROTATIONS, BLOCKS, ECONOMY } from "../engine/constants.js";
import { getCell, BLOCK_DEFS } from "../engine/board.js";
import { createRenderer } from "../render/canvas.js";
import { createHud } from "../render/hud.js";
import { PALETTE } from "../render/palette.js";
import { createSession, PHASE, STATUS } from "../game/session.js";
import { EVENT } from "../engine/physics.js";
import { OUTCOME } from "../engine/simulate.js";

export function createGameScreen(root, { onFinished }) {
  const canvas = root.querySelector("#field");
  const renderer = createRenderer(canvas);

  let session = null;
  let hud = null;
  let hover = null;          // { col, row } under the cursor, or null
  let pendingRotation = ROTATIONS[0];
  let running = false;
  let lastFrame = 0;
  let coreFlash = 0;

  // ── Input ────────────────────────────────────────────────────────────────

  function cellFromEvent(event) {
    const box = canvas.getBoundingClientRect();
    const { col, row } = renderer.pxToCell(event.clientX - box.left, event.clientY - box.top);
    const c = Math.floor(col);
    const r = Math.floor(row);
    if (c < 0 || c >= GRID.COLS || r < 0 || r >= GRID.ROWS) return null;
    return { col: c, row: r };
  }

  canvas.addEventListener("mousemove", (event) => { hover = cellFromEvent(event); });
  canvas.addEventListener("mouseleave", () => { hover = null; });

  canvas.addEventListener("click", (event) => {
    if (session === null || session.phase !== PHASE.BUILD) return;
    const cell = cellFromEvent(event);
    if (cell === null) return;

    const existing = getCell(session.board, cell.col, cell.row);

    // Clicking a placed Deflector turns it. Discoverable, and it is the block whose
    // orientation you most often want to change after seeing the wave run.
    if (existing !== null && BLOCK_DEFS[existing.type].rotatable === true) {
      session.cycleRotation(cell.col, cell.row);
      renderer.burst(cell.col, cell.row, PALETTE.blocks.DEFLECTOR.top, 5, 0.6);
      return;
    }

    const result = session.place(hud.selected, cell.col, cell.row, pendingRotation);
    if (result.ok) {
      renderer.burst(cell.col, cell.row, PALETTE.blocks[hud.selected].top, 7, 0.7);
    } else {
      explainRefusal(result.reason);
    }
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (session === null || session.phase !== PHASE.BUILD) return;
    const cell = cellFromEvent(event);
    if (cell === null) return;
    const result = session.sell(cell.col, cell.row);
    if (result.ok) {
      hud.log(`Sold for ${result.refund}`, "is-gold");
      renderer.burst(cell.col, cell.row, PALETTE.spark, 6, 0.6);
    }
  });

  function explainRefusal(reason) {
    const message = {
      cannot_afford: "Not enough Shards",
      wrong_zone: "You can only build in the middle band",
      occupied: "Something is already there",
      out_of_bounds: "Off the field",
      wrong_phase: "Building is closed during a wave"
    }[reason];
    if (message !== undefined) hud.log(message, "is-bad");
  }

  function onKeyDown(event) {
    if (session === null || !running) return;

    if (event.key >= "1" && event.key <= "9") {
      hud.selectByIndex(Number(event.key) - 1);
      return;
    }
    if (event.key === "r" || event.key === "R") {
      pendingRotation = ROTATIONS[(ROTATIONS.indexOf(pendingRotation) + 1) % ROTATIONS.length];
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      if (session.phase === PHASE.BUILD) startWave();
    }
  }

  // ── Wave events → sound, sparks, shake, feed ─────────────────────────────

  function reactTo(events) {
    for (const event of events) {
      switch (event.type) {
        case EVENT.BLOCK_DESTROYED:
          renderer.burst(event.col, event.row, PALETTE.blocks[event.blockType]?.top ?? PALETTE.spark, 12, 1.1);
          break;
        case EVENT.CORE_HIT:
          renderer.shakeScreen(0.5);
          coreFlash = 1;
          break;
        case EVENT.BOMB_DETONATED:
          renderer.burst(event.col, event.row, PALETTE.spark, 26, 2.1);
          renderer.shakeScreen(0.65);
          break;
        case EVENT.BALL_EXITED:
          hud.log(`Gutter kill  +${ECONOMY.GUTTER_KILL}`, "is-good");
          break;
        case EVENT.BALL_ABSORBED:
          hud.log(`Ball absorbed  +${ECONOMY.ABSORB_KILL}`, "is-gold");
          break;
        default:
          break;
      }
    }
  }

  function startWave() {
    if (!session.ready()) return;
    renderer.clearTrails();
    hud.hideBanner();
    hud.banner(`Wave ${session.wave}`, "Hold the Core", false, 1400);
  }

  function announceResult(result) {
    if (result.outcome === OUTCOME.TIMED_OUT) {
      hud.banner("Wave held", "Balls left over pay nothing", false, 2200);
      hud.log("Wave timed out — no bounty", "");
    } else if (result.outcome === OUTCOME.CLEARED) {
      hud.banner("Wave cleared", `+${result.score.total} Shards`, false, 2200);
    }
    if (result.score.total > 0) hud.log(`Wave paid ${result.score.total}`, "is-gold");
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  function frame(now) {
    if (!running) return;

    const dt = lastFrame === 0 ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;

    const { events, waveFinished } = session.update(dt);
    reactTo(events);

    if (waveFinished) {
      const result = session.lastResult;
      if (session.over) {
        running = false;
        onFinished(session.summary());
        return;
      }
      announceResult(result);
    }

    // Placement ghost.
    let ghost = null;
    if (hover !== null && session.phase === PHASE.BUILD) {
      const existing = getCell(session.board, hover.col, hover.row);
      ghost = existing === null
        ? { col: hover.col, row: hover.row, valid: session.checkPlacement(hud.selected, hover.col, hover.row).ok }
        : null;
    }

    renderer.draw({
      board: session.board,
      balls: session.balls,
      paddle: session.paddle,
      ghost
    }, now);

    if (coreFlash > 0.01) {
      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.fillStyle = PALETTE.coreHitFlash;
      ctx.globalAlpha = coreFlash;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      coreFlash *= 0.86;
    }

    hud.update();
    requestAnimationFrame(frame);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  function onResize() { renderer.resize(); }

  return {
    /** Begin a fresh run. */
    start(seed) {
      session = createSession(seed);
      hud = createHud(root, session);
      hud.onReady(startWave);
      hover = null;
      pendingRotation = ROTATIONS[0];
      coreFlash = 0;
      lastFrame = 0;
      running = true;

      renderer.resize();
      renderer.clearTrails();
      hud.log("Build your defences", "");
      hud.banner("Wave 1 incoming", "Deflect balls into the gutters", false, 3000);

      window.addEventListener("resize", onResize);
      window.addEventListener("keydown", onKeyDown);
      requestAnimationFrame(frame);
    },

    stop() {
      running = false;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
    },

    resize: onResize
  };
}
