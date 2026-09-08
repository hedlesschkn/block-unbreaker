/**
 * Every colour in the game, in one place.
 *
 * Isolated deliberately: task T0.3 reconciles the visual design against the Figma
 * file, and when it does, this module is what changes. Nothing else should contain a
 * colour literal — if a hex code appears in a draw call, it belongs here instead.
 *
 * The scheme is built around one idea: **your things glow cool, the enemy runs hot.**
 * The paddle is the only warm-red element on the field, so the thing trying to kill
 * you is the thing your eye goes to first.
 */

export const PALETTE = Object.freeze({
  // Field
  bg: "#0a0a12",
  fieldBg: "#0d0d18",
  gridLine: "rgba(120, 140, 200, 0.055)",
  fieldEdge: "rgba(120, 140, 200, 0.22)",

  // Zone hints
  coreZone: "rgba(53, 224, 208, 0.035)",
  buildZone: "rgba(120, 140, 200, 0.02)",
  gutter: "rgba(74, 222, 128, 0.10)",
  gutterEdge: "rgba(74, 222, 128, 0.5)",

  // Blocks, keyed by type id
  blocks: Object.freeze({
    CORE: { face: "#35e0d0", top: "#8bfff4", side: "#1a9c92", glow: "rgba(53,224,208,0.55)" },
    WALL: { face: "#5a6484", top: "#8892b0", side: "#39415c", glow: "rgba(90,100,132,0.0)" },
    DEFLECTOR: { face: "#c44df0", top: "#e79dff", side: "#7d2c99", glow: "rgba(196,77,240,0.35)" },
    ABSORBER: { face: "#3d2a6b", top: "#6b4fb0", side: "#241640", glow: "rgba(107,79,176,0.4)" },
    BOMB: { face: "#f0803d", top: "#ffb787", side: "#a04f1c", glow: "rgba(240,128,61,0.4)" },
    GENERATOR: { face: "#4ade80", top: "#a7f3c4", side: "#249152", glow: "rgba(74,222,128,0.4)" }
  }),

  // Actors
  ball: "#ffffff",
  ballGlow: "rgba(255,255,255,0.7)",
  ballTrail: "rgba(140, 200, 255, 0.35)",

  /** The enemy. The only hot colour on the field. */
  paddle: "#ff4d6d",
  paddleTop: "#ff8fa3",
  paddleGlow: "rgba(255,77,109,0.55)",

  // Placement feedback
  ghostOk: "rgba(53, 224, 208, 0.45)",
  ghostBad: "rgba(255, 77, 109, 0.35)",
  ghostEdge: "rgba(255,255,255,0.5)",

  // Effects
  spark: "#ffe27a",
  coreHitFlash: "rgba(255, 77, 109, 0.28)",
  text: "#e8e8f4",
  textDim: "#8a8aa8"
});

/** Colours for a block type, falling back to Wall for anything unrecognised. */
export function blockColors(type) {
  return PALETTE.blocks[type] ?? PALETTE.blocks.WALL;
}
