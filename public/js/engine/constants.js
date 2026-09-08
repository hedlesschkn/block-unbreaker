/**
 * Every tunable number in Block Unbreaker.
 *
 * Rule (FEATUREROADMAP_workplan.md, standing rule 3): no magic numbers anywhere else
 * in the codebase. If you are about to type a number into engine/, render/ or src/,
 * it belongs here instead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNITS
 *
 * The engine works in CELLS, never pixels. One grid cell is 1.0 world unit on both
 * axes; the origin is the top-left of the grid; +y points down. The renderer scales
 * cells to pixels, and the simulation never learns about pixels, DPI or viewport
 * size. Time is in seconds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DETERMINISM CONTRACT — read this before adding anything to engine/
 *
 * The Durable Object and every connected browser must compute byte-identical
 * results from the same inputs (ProductSpec §9). That holds only if the engine
 * sticks to operations IEEE-754 defines exactly:
 *
 *     ALLOWED    + - * / %  comparisons  Math.sqrt  Math.abs
 *                Math.min  Math.max  Math.floor  Math.ceil  Math.round
 *                Math.imul  bitwise ops
 *
 *     BANNED     Math.sin  Math.cos  Math.tan  Math.atan2  Math.asin  Math.acos
 *                Math.pow  Math.exp  Math.log  Math.hypot  Math.cbrt
 *                Math.random  Date.now  performance.now
 *
 * The transcendental functions are NOT specified to the last bit by the standard.
 * V8, JavaScriptCore and SpiderMonkey each round them differently, so a Safari
 * client and the workerd Durable Object can and will disagree — and one wrong bit
 * in a ball's velocity becomes a completely different wave about ten bounces later.
 *
 * So: store directions as unit vectors and normalise with Math.sqrt. Grow values by
 * repeated multiplication rather than Math.pow. This is why `speedMultiplier()`
 * below is a loop and not one line.
 */

/** The playfield. ProductSpec §2. */
export const GRID = Object.freeze({
  COLS: 12,
  ROWS: 20
});

/**
 * Row bands, all inclusive. ProductSpec §2.
 *
 * rows  0–2   Core zone      pre-placed, not player-editable
 * rows  3–16  Buildable      where the player plays
 * rows 17–19  No-build       paddle lane and launch space
 */
export const ZONES = Object.freeze({
  CORE_ROW_START: 0,
  CORE_ROW_END: 2,

  BUILD_ROW_START: 3,
  BUILD_ROW_END: 16,

  NOBUILD_ROW_START: 17,
  NOBUILD_ROW_END: 19,

  /** The row the paddle slides along. */
  PADDLE_ROW: 19,

  /**
   * Dead columns at each edge that the paddle physically cannot cover.
   * Getting a ball down a gutter is how you win. ProductSpec §2.
   *
   * Widened from 1 to 1.5 at T2.11: with one-cell gutters the paddle covered 83% of
   * the field and most waves simply timed out, which is the least interesting way for
   * a wave to end.
   */
  GUTTER_COLS: 1.5
});

/**
 * The Core. ProductSpec §4.
 *
 * Four columns by two rows, centred — 8 blocks. The spec originally said nine as a
 * 3×3, but an odd width cannot be centred on a 12-column grid: it would sit one
 * column off, quietly biasing every left-versus-right funnelling decision in the
 * game. An even width centres exactly. Flagged rather than changed silently.
 */
export const CORE = Object.freeze({
  COLS: 4,
  ROWS: 2,
  /** 7, not 10: at 80 total HP a player who did nothing at all survived to wave 10. */
  HP: 7,

  /**
   * Damage multiplier for hits that land on the Core.
   *
   * Without this the game rewarded an EMPTY board: with nothing in the way, balls fell
   * straight through to the gutters and cleared quickly, so doing nothing scored more
   * gutter kills and survived longer than any built defence (measured, T2.11). Blocks
   * were a liability, which is the exact opposite of a defence game.
   *
   * Making an unobstructed path to the Core genuinely lethal is what puts the "defence"
   * back in: something has to stand between the ball and the castle.
   */
  DAMAGE_MULTIPLIER: 3,
  /** Derived: centred horizontally, flush to the top of the core zone. */
  get START_COL() {
    return (GRID.COLS - this.COLS) / 2;
  },
  get START_ROW() {
    return ZONES.CORE_ROW_START;
  }
});

/** The ball. ProductSpec §4. Speed is constant within a wave — reflections change direction, never magnitude. */
export const BALL = Object.freeze({
  RADIUS: 0.28,

  /** Cells per second at wave 1. */
  BASE_SPEED: 9.0,

  /** Multiplied in once per wave. ProductSpec §6. */
  SPEED_GROWTH: 1.04,

  /**
   * Floor on |vy| after any reflection, as a fraction of total speed. Without it a
   * ball can settle into a near-horizontal groove and bounce sideways forever,
   * which is boring to watch and burns the simulation step budget.
   */
  MIN_VERTICAL_FRACTION: 0.30,

  /** Horizontal spread of the opening launch, as a fraction of speed. */
  LAUNCH_SPREAD: 0.45
});

/** The enemy paddle. ProductSpec §4. */
export const PADDLE = Object.freeze({
  WIDTH: 3.0,
  HEIGHT: 0.4,

  /** Cells per second. Beatable by distance, not by trickery. */
  MAX_SPEED: 10.0,

  /**
   * Return "english": how far the bounce tilts when the ball strikes the end of the
   * paddle rather than its middle. Expressed as a horizontal-to-vertical ratio so
   * the direction can be normalised with sqrt instead of trigonometry — see the
   * determinism contract above.
   */
  MAX_RETURN_SPREAD: 1.60,

  /**
   * The paddle aims at where the ball WILL land, not where it is. Set to 0 for a
   * purely reactive (much weaker) paddle.
   */
  PREDICTS_LANDING: true,

  /**
   * Minimum tilt on any return, as a fraction of MAX_RETURN_SPREAD.
   *
   * Without this the game has a fixed point: a ball striking the exact centre of a
   * stationary paddle goes straight up, comes straight back down onto the centre, and
   * rallies vertically forever. The paddle imparts a little sideways bias instead —
   * physically it reads as spin off a moving paddle, and mechanically it guarantees
   * rallies wander instead of locking.
   */
  MIN_RETURN_TILT: 0.12,

  /** Width shrinks in later waves. ProductSpec §6. */
  SHRINK_START_WAVE: 7,
  SHRINK_PER_BAND: 0.05,
  SHRINK_BAND_WAVES: 3,
  MIN_WIDTH_FACTOR: 0.60
});

/**
 * Block catalogue. ProductSpec §4.
 * Starting values — expect all of these to move during the balance pass (T2.11).
 */
export const BLOCKS = Object.freeze({
  WALL: Object.freeze({
    id: "WALL",
    label: "Wall",
    cost: 14,
    /**
     * 8, not 3. At 3 HP a wall was gone after three bounces, so a shield had to be
     * rebuilt from scratch every wave — and income could not cover it. Defences that
     * are annihilated each wave mean investment never compounds, which is why building
     * anything scored no better than building nothing (measured, T2.11). Blocks should
     * wear down across a run, not vanish within one wave.
     */
    hp: 8,
    reflects: true
  }),

  DEFLECTOR: Object.freeze({
    id: "DEFLECTOR",
    label: "Deflector",
    cost: 30,
    /**
     * Deliberately far tougher than anything else.
     *
     * At 6 HP only ~10% of Deflectors survived a single wave (measured, T2.11), so the
     * funnel a player built evaporated before it could aim anything and the intended
     * strategy scored no better than doing nothing. A block whose entire job is to be
     * hit repeatedly cannot be made of glass. It still wears out — it is just no longer
     * consumed on contact.
     */
    hp: 24,
    reflects: true,
    /** Reflects 90° off a diagonal face rather than straight back. */
    diagonal: true,
    rotatable: true
  }),

  ABSORBER: Object.freeze({
    id: "ABSORBER",
    label: "Absorber",
    cost: 40,
    hp: 1,
    reflects: false,
    /** Destroys the ball that touches it, and is consumed doing so. */
    destroysBall: true
  }),

  BOMB: Object.freeze({
    id: "BOMB",
    label: "Bomb",
    cost: 30,
    hp: 2,
    reflects: true,
    /** On destruction, detonates across the surrounding 3×3 — balls AND your own blocks. */
    explodes: true,
    blastRadius: 1
  }),

  GENERATOR: Object.freeze({
    id: "GENERATOR",
    label: "Generator",
    cost: 50,
    hp: 5,
    reflects: true,
    /** Pays out at the end of every wave it survives. */
    yieldsShards: true
  })
});

/** Placement order in the build palette. */
export const BLOCK_ORDER = Object.freeze(["WALL", "DEFLECTOR", "ABSORBER", "BOMB", "GENERATOR"]);

/** Deflector orientations. The diagonal runs between the two named corners. */
export const ROTATIONS = Object.freeze(["NE", "SE", "SW", "NW"]);

/** Shards. ProductSpec §5. */
export const ECONOMY = Object.freeze({
  START_SHARDS: 150,

  /**
   * A ball driven out of the bottom of the field. Deliberately worth roughly twice
   * an absorb kill — this gap is the main lever pushing players toward the
   * interesting strategy, and it is the first number to touch in the balance pass.
   */
  GUTTER_KILL: 25,

  /** A ball eaten by an Absorber or caught in a Bomb. */
  ABSORB_KILL: 8,

  WAVE_SURVIVED: 15,

  /**
   * Fraction of the survival bonus paid when a wave TIMES OUT rather than being
   * cleared. Surviving the clock is not the same as beating the wave, and paying both
   * the same is what funded doing nothing (measured, T2.11).
   */
  TIMEOUT_SURVIVAL_FRACTION: 0.25,

  GENERATOR_YIELD: 5,

  /** Build phase only. */
  SELL_REFUND_FRACTION: 0.5
});

/** Phases and escalation. ProductSpec §3 and §6. */
export const WAVES = Object.freeze({
  BUILD_SECONDS: 30,

  /**
   * Hard time limit on a wave.
   *
   * The paddle is very good: on a long descent it has both prediction and time, so it
   * returns essentially everything aimed within its lane. That is intended — the way
   * past it is the gutter, not out-rallying it. But it means a board with no
   * funnelling can rally indefinitely, and a wave that never ends is a wave that never
   * hands the player back their build phase.
   *
   * So a wave is capped. Balls still in play when the timer expires are removed and
   * pay NOTHING, which keeps tanking from being a strategy: you have to actually kill
   * balls to earn Shards.
   */
  MAX_SECONDS: 45,

  /** Surviving this wave wins the run. */
  WIN_WAVE: 20,

  /** Ball count: one at wave 1, one more every three waves. */
  BALLS_BASE: 1,
  BALLS_EVERY_N_WAVES: 3
});

/** Multiplayer sabotage. ProductSpec §7. */
export const SABOTAGE = Object.freeze({
  /** Gutter kills needed to charge the meter. Absorb kills do not count. */
  GUTTER_KILLS_PER_CHARGE: 3,
  /** Extra balls injected into the target's next wave when it fires. */
  BALLS_SENT: 1
});

/** Simulation. ProductSpec §9. */
export const SIM = Object.freeze({
  /**
   * Fixed timestep. Every client and the Durable Object step at exactly this rate,
   * independent of frame rate.
   */
  TIMESTEP: 1 / 120,

  /**
   * Hard safety net so a pathological board can never hang the Durable Object.
   * 120 steps/sec × 90 seconds.
   */
  MAX_STEPS: 10800,

  /** Collision substeps per timestep, to stop a fast ball tunnelling through a block. */
  SUBSTEPS: 4
});

/** Room codes. ProductSpec §7, task T3.3. Ambiguous glyphs (0/O, 1/I) excluded. */
export const ROOM = Object.freeze({
  CODE_LENGTH: 4,
  CODE_ALPHABET: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  MAX_PLAYERS: 4
});

// ─────────────────────────────────────────────────────────────────────────────
// Derived escalation. Pure functions of the constants above, kept here so the
// whole difficulty curve reads in one place. ProductSpec §6.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Balls in play at the start of a wave.
 * Waves 1–3 → 1, 4–6 → 2, 7–9 → 3, and so on without limit.
 */
export function ballCount(wave) {
  return WAVES.BALLS_BASE + Math.floor((wave - 1) / WAVES.BALLS_EVERY_N_WAVES);
}

/**
 * Ball speed multiplier for a wave. 1.00 at wave 1, +4% per wave thereafter.
 *
 * This is a loop rather than Math.pow(SPEED_GROWTH, wave - 1) on purpose: pow is
 * not bit-exact across JavaScript engines, and this value feeds directly into every
 * subsequent collision. See the determinism contract at the top of this file.
 */
export function speedMultiplier(wave) {
  let m = 1;
  for (let w = 1; w < wave; w++) m *= BALL.SPEED_GROWTH;
  return m;
}

/** Ball speed in cells per second for a wave. */
export function ballSpeed(wave) {
  return BALL.BASE_SPEED * speedMultiplier(wave);
}

/**
 * Paddle width multiplier. Full width through wave 6, then 5% narrower every three
 * waves, floored so the paddle never becomes a token.
 */
export function paddleWidthFactor(wave) {
  if (wave < PADDLE.SHRINK_START_WAVE) return 1;
  const band = Math.floor((wave - PADDLE.SHRINK_START_WAVE) / PADDLE.SHRINK_BAND_WAVES);
  const factor = 1 - PADDLE.SHRINK_PER_BAND * (band + 1);
  return Math.max(PADDLE.MIN_WIDTH_FACTOR, factor);
}

/** Paddle width in cells for a wave. */
export function paddleWidth(wave) {
  return PADDLE.WIDTH * paddleWidthFactor(wave);
}

/**
 * The x range the paddle's CENTRE can occupy. Anything outside the span this
 * implies is a gutter, and a ball descending there cannot be intercepted.
 */
export function paddleTravel(wave) {
  const half = paddleWidth(wave) / 2;
  return {
    min: ZONES.GUTTER_COLS + half,
    max: GRID.COLS - ZONES.GUTTER_COLS - half
  };
}

/** Everything a wave needs to run. The seed is supplied separately. */
export function waveConfig(wave) {
  return {
    wave,
    balls: ballCount(wave),
    ballSpeed: ballSpeed(wave),
    paddleWidth: paddleWidth(wave)
  };
}
