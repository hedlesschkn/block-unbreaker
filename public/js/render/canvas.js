/**
 * The field renderer. Owns the canvas, the cell-to-pixel mapping, and the draw loop.
 *
 * This is the boundary between the engine and the screen: the engine thinks entirely
 * in cells, and nothing below `render/` knows what a pixel is. Every conversion in the
 * game goes through `cellToPx` / `pxToCell` here.
 *
 * The renderer may do whatever it likes with `Math.random` and the clock — the
 * determinism contract applies only to `engine/`.
 */

import { GRID, ZONES, BALL, PADDLE, BLOCKS, CORE } from "../engine/constants.js";
import { getCell, BLOCK_DEFS, CORE_TYPE } from "../engine/board.js";
import { PADDLE_Y } from "../engine/physics.js";
import { PALETTE } from "./palette.js";
import {
  drawBrick, drawDeflector, drawAbsorber, drawGenerator, drawBomb, drawCore,
  drawBall, drawPaddle, drawGhost, roundRect
} from "./sprites.js";

const TRAIL_LENGTH = 6;

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });

  let cell = 1;        // pixels per cell
  let originX = 0;     // left edge of the field, in pixels
  let originY = 0;
  let width = 0;
  let height = 0;

  const trails = new Map();   // ball id -> recent pixel positions
  let shake = 0;              // screen-shake energy, decays each frame
  const particles = [];

  /** Fit the field to the element box, accounting for device pixel ratio. */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    width = box.width;
    height = box.height;

    // Largest whole field that fits, centred.
    cell = Math.min(width / GRID.COLS, height / GRID.ROWS);
    originX = (width - cell * GRID.COLS) / 2;
    originY = (height - cell * GRID.ROWS) / 2;
  }

  const cellToPx = (col, row) => ({ x: originX + col * cell, y: originY + row * cell });

  /** Screen position → grid cell. Returns fractional coordinates; floor for a cell. */
  function pxToCell(px, py) {
    return { col: (px - originX) / cell, row: (py - originY) / cell };
  }

  function drawField() {
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = PALETTE.fieldBg;
    ctx.fillRect(originX, originY, cell * GRID.COLS, cell * GRID.ROWS);

    // Zone tints, so the player can see where they may build without being told.
    ctx.fillStyle = PALETTE.coreZone;
    ctx.fillRect(originX, originY, cell * GRID.COLS, cell * (ZONES.CORE_ROW_END + 1));
    ctx.fillStyle = PALETTE.buildZone;
    ctx.fillRect(originX, originY + cell * ZONES.BUILD_ROW_START, cell * GRID.COLS,
      cell * (ZONES.BUILD_ROW_END - ZONES.BUILD_ROW_START + 1));

    // Grid.
    ctx.strokeStyle = PALETTE.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= GRID.COLS; c++) {
      ctx.moveTo(originX + c * cell, originY);
      ctx.lineTo(originX + c * cell, originY + cell * GRID.ROWS);
    }
    for (let r = 0; r <= GRID.ROWS; r++) {
      ctx.moveTo(originX, originY + r * cell);
      ctx.lineTo(originX + cell * GRID.COLS, originY + r * cell);
    }
    ctx.stroke();

    drawGutters();

    ctx.strokeStyle = PALETTE.fieldEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(originX, originY, cell * GRID.COLS, cell * GRID.ROWS);
  }

  /**
   * The gutters — the columns the paddle cannot reach. Marked because they are the
   * win condition, and a player who cannot see them cannot aim at them.
   */
  function drawGutters() {
    const top = originY + cell * ZONES.NOBUILD_ROW_START;
    const h = cell * (GRID.ROWS - ZONES.NOBUILD_ROW_START);
    const w = cell * ZONES.GUTTER_COLS;

    for (const x of [originX, originX + cell * GRID.COLS - w]) {
      ctx.fillStyle = PALETTE.gutter;
      ctx.fillRect(x, top, w, h);

      ctx.save();
      ctx.strokeStyle = PALETTE.gutterEdge;
      ctx.lineWidth = Math.max(1, cell * 0.05);
      ctx.setLineDash([cell * 0.22, cell * 0.18]);
      ctx.beginPath();
      ctx.moveTo(x + (x === originX ? w : 0), top);
      ctx.lineTo(x + (x === originX ? w : 0), top + h);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBoard(board, time) {
    const pulse = 0.5 + 0.5 * Math.sin(time / 520);

    for (let row = 0; row < GRID.ROWS; row++) {
      for (let col = 0; col < GRID.COLS; col++) {
        const block = getCell(board, col, row);
        if (block === null) continue;

        const { x, y } = cellToPx(col, row);
        const def = BLOCK_DEFS[block.type];
        const damage = 1 - block.hp / def.hp;

        switch (block.type) {
          case CORE_TYPE: drawCore(ctx, x, y, cell, cell, damage, pulse); break;
          case "DEFLECTOR": drawDeflector(ctx, x, y, cell, cell, block.rotation, damage); break;
          case "ABSORBER": drawAbsorber(ctx, x, y, cell, cell, time / 900); break;
          case "GENERATOR": drawGenerator(ctx, x, y, cell, cell, damage, pulse); break;
          case "BOMB": drawBomb(ctx, x, y, cell, cell, damage, pulse); break;
          default: drawBrick(ctx, x, y, cell, cell, block.type, damage);
        }
      }
    }
  }

  function drawBalls(balls) {
    const live = new Set();
    for (const ball of balls) {
      if (!ball.alive) continue;
      live.add(ball.id);

      const px = originX + ball.x * cell;
      const py = originY + ball.y * cell;

      let trail = trails.get(ball.id);
      if (trail === undefined) {
        trail = [];
        trails.set(ball.id, trail);
      }
      trail.push({ x: px, y: py });
      if (trail.length > TRAIL_LENGTH) trail.shift();

      drawBall(ctx, px, py, BALL.RADIUS * cell, trail);
    }
    for (const id of [...trails.keys()]) if (!live.has(id)) trails.delete(id);
  }

  function drawEnemyPaddle(paddle) {
    drawPaddle(
      ctx,
      originX + paddle.x * cell,
      originY + PADDLE_Y * cell,
      paddle.width * cell,
      PADDLE.HEIGHT * cell
    );
  }

  // ─── Effects ───────────────────────────────────────────────────────────────

  /** Spray a few sparks. Purely cosmetic — never read by the engine. */
  function burst(col, row, color, count = 10, speed = 1) {
    const { x, y } = cellToPx(col, row);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = (0.4 + Math.random() * 1.6) * speed;
      particles.push({
        x: x + cell / 2,
        y: y + cell / 2,
        vx: Math.cos(angle) * velocity * cell * 0.06,
        vy: Math.sin(angle) * velocity * cell * 0.06,
        life: 1,
        decay: 0.018 + Math.random() * 0.03,
        size: cell * (0.05 + Math.random() * 0.08),
        color
      });
    }
  }

  function shakeScreen(amount) {
    shake = Math.min(1, shake + amount);
  }

  function stepParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += cell * 0.004;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── Frame ─────────────────────────────────────────────────────────────────

  /**
   * Draw one frame.
   *
   * @param scene `{ board, balls, paddle, ghost }` — ghost is the placement preview,
   *              `{ col, row, type, rotation, valid }` or null.
   */
  function draw(scene, time) {
    if (width === 0) resize();

    ctx.save();
    if (shake > 0.001) {
      const magnitude = shake * cell * 0.28;
      ctx.translate((Math.random() - 0.5) * magnitude, (Math.random() - 0.5) * magnitude);
      shake *= 0.88;
    } else {
      shake = 0;
    }

    drawField();
    drawBoard(scene.board, time);

    if (scene.ghost != null) {
      const { x, y } = cellToPx(scene.ghost.col, scene.ghost.row);
      drawGhost(ctx, x, y, cell, cell, scene.ghost.valid);
    }

    if (scene.balls != null) drawBalls(scene.balls);
    if (scene.paddle != null) drawEnemyPaddle(scene.paddle);

    stepParticles();
    drawParticles();

    ctx.restore();
  }

  return {
    resize,
    draw,
    burst,
    shakeScreen,
    pxToCell,
    cellToPx,
    get cellSize() {
      return cell;
    },
    clearTrails() {
      trails.clear();
      particles.length = 0;
      shake = 0;
    }
  };
}
