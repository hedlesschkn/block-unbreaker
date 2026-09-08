/**
 * Drawing one thing at a time. Every function works in PIXELS and is handed the
 * geometry it needs — none of them read game state, and none of them know what a
 * cell is. `canvas.js` owns the cell-to-pixel conversion.
 *
 * The look is deliberately Arkanoid: chunky bevelled bricks with a lit top edge and a
 * shaded bottom, so the field reads as a physical wall rather than a grid of flat
 * rectangles.
 */

import { PALETTE, blockColors } from "./palette.js";

/** Rounded rectangle path. */
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * A bevelled brick.
 * @param damage 0 = pristine, 1 = about to break. Drives the crack overlay.
 */
export function drawBrick(ctx, x, y, w, h, type, damage = 0, glowStrength = 1) {
  const c = blockColors(type);
  const inset = Math.max(1, w * 0.05);
  const bx = x + inset;
  const by = y + inset;
  const bw = w - inset * 2;
  const bh = h - inset * 2;
  const r = Math.max(2, w * 0.14);

  if (c.glow !== "rgba(90,100,132,0.0)" && glowStrength > 0) {
    ctx.save();
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = w * 0.5 * glowStrength;
    roundRect(ctx, bx, by, bw, bh, r);
    ctx.fillStyle = c.face;
    ctx.fill();
    ctx.restore();
  }

  // Body, lit from above.
  const grad = ctx.createLinearGradient(0, by, 0, by + bh);
  grad.addColorStop(0, c.top);
  grad.addColorStop(0.42, c.face);
  grad.addColorStop(1, c.side);
  roundRect(ctx, bx, by, bw, bh, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // Top highlight.
  ctx.beginPath();
  ctx.moveTo(bx + r * 0.6, by + bh * 0.13);
  ctx.lineTo(bx + bw - r * 0.6, by + bh * 0.13);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = Math.max(1, h * 0.05);
  ctx.stroke();

  if (damage > 0) drawCracks(ctx, bx, by, bw, bh, damage);
}

/** Damage overlay — the brick visibly loses integrity before it breaks. */
function drawCracks(ctx, x, y, w, h, damage) {
  ctx.save();
  ctx.globalAlpha = Math.min(0.85, 0.25 + damage * 0.6);
  ctx.strokeStyle = "rgba(8,8,16,0.9)";
  ctx.lineWidth = Math.max(1, w * 0.05);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.22, y);
  ctx.lineTo(x + w * 0.44, y + h * 0.52);
  ctx.lineTo(x + w * 0.3, y + h);
  if (damage > 0.5) {
    ctx.moveTo(x + w * 0.72, y);
    ctx.lineTo(x + w * 0.58, y + h * 0.46);
    ctx.lineTo(x + w * 0.84, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * A Deflector: a right triangle whose hypotenuse is the reflecting face. The solid
 * corner is named by the rotation, matching DIAGONAL in physics.js — so what the
 * player sees is literally what the ball bounces off.
 */
export function drawDeflector(ctx, x, y, w, h, rotation, damage = 0) {
  const c = blockColors("DEFLECTOR");
  const inset = Math.max(1, w * 0.05);
  const x0 = x + inset;
  const y0 = y + inset;
  const x1 = x + w - inset;
  const y1 = y + h - inset;

  // Vertices of the solid half, by which corner holds the right angle.
  const corners = {
    SW: [[x0, y0], [x0, y1], [x1, y1]],
    NE: [[x0, y0], [x1, y0], [x1, y1]],
    SE: [[x1, y0], [x1, y1], [x0, y1]],
    NW: [[x0, y0], [x1, y0], [x0, y1]]
  };
  const pts = corners[rotation] ?? corners.SW;

  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = w * 0.45;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[1][0], pts[1][1]);
  ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.closePath();

  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, c.top);
  grad.addColorStop(1, c.side);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // The reflecting face, drawn bright so the player can read the angle at a glance.
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = Math.max(1.5, w * 0.07);
  ctx.stroke();

  if (damage > 0) {
    ctx.save();
    ctx.globalAlpha = damage * 0.5;
    ctx.fillStyle = "rgba(8,8,16,0.8)";
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** An Absorber: a void that swallows the ball. Drawn as a hole, not a brick. */
export function drawAbsorber(ctx, x, y, w, h, phase = 0) {
  const c = blockColors("ABSORBER");
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) * 0.42;

  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = w * 0.6;
  const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  grad.addColorStop(0, "#05030c");
  grad.addColorStop(0.55, c.face);
  grad.addColorStop(1, c.top);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Slowly rotating rim, so it reads as active rather than as a decal.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.96, phase, phase + Math.PI * 1.35);
  ctx.strokeStyle = c.top;
  ctx.lineWidth = Math.max(1.2, w * 0.06);
  ctx.stroke();
}

/** A Generator: a brick with a pulsing core, so income reads as alive. */
export function drawGenerator(ctx, x, y, w, h, damage, pulse) {
  drawBrick(ctx, x, y, w, h, "GENERATOR", damage);
  const c = blockColors("GENERATOR");
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.save();
  ctx.globalAlpha = 0.5 + 0.5 * pulse;
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = w * 0.7;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(w, h) * (0.14 + 0.05 * pulse), 0, Math.PI * 2);
  ctx.fillStyle = "#eaffee";
  ctx.fill();
  ctx.restore();
}

/** A Bomb: a brick with a fuse dot, so the risk is legible before you commit. */
export function drawBomb(ctx, x, y, w, h, damage, pulse) {
  drawBrick(ctx, x, y, w, h, "BOMB", damage);
  ctx.save();
  ctx.globalAlpha = 0.65 + 0.35 * pulse;
  ctx.shadowColor = PALETTE.spark;
  ctx.shadowBlur = w * 0.6;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.spark;
  ctx.fill();
  ctx.restore();
}

/** The Core: brighter than anything else, and it breathes. */
export function drawCore(ctx, x, y, w, h, damage, pulse) {
  drawBrick(ctx, x, y, w, h, "CORE", damage, 0.6 + 0.5 * pulse);
  ctx.save();
  ctx.globalAlpha = 0.25 + 0.25 * pulse;
  ctx.fillStyle = "#d8fffb";
  const inset = w * 0.28;
  roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, w * 0.1);
  ctx.fill();
  ctx.restore();
}

/** The ball, with a soft trail behind it. `trail` is oldest-first. */
export function drawBall(ctx, px, py, radius, trail = []) {
  // Drawn segment by segment so the tail can taper in both width and opacity. One
  // uniform stroke reads as a stick glued to the ball rather than as motion.
  if (trail.length > 1) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = PALETTE.ballTrail;
    for (let i = 1; i < trail.length; i++) {
      const t = i / (trail.length - 1);
      ctx.globalAlpha = 0.5 * t * t;
      ctx.lineWidth = radius * 1.5 * t;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor = PALETTE.ballGlow;
  ctx.shadowBlur = radius * 3.2;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.ball;
  ctx.fill();
  ctx.restore();
}

/** The enemy paddle. Hot, hard-edged, and clearly not yours. */
export function drawPaddle(ctx, cx, cy, w, h) {
  ctx.save();
  ctx.shadowColor = PALETTE.paddleGlow;
  ctx.shadowBlur = h * 2.4;
  const grad = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  grad.addColorStop(0, PALETTE.paddleTop);
  grad.addColorStop(1, PALETTE.paddle);
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

/** Placement preview under the cursor. */
export function drawGhost(ctx, x, y, w, h, valid) {
  ctx.save();
  ctx.fillStyle = valid ? PALETTE.ghostOk : PALETTE.ghostBad;
  roundRect(ctx, x + w * 0.05, y + h * 0.05, w * 0.9, h * 0.9, w * 0.14);
  ctx.fill();
  ctx.setLineDash([w * 0.16, w * 0.12]);
  ctx.strokeStyle = PALETTE.ghostEdge;
  ctx.lineWidth = Math.max(1, w * 0.045);
  ctx.stroke();
  ctx.restore();
}

export { roundRect };
