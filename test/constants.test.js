import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  GRID, ZONES, CORE, BALL, PADDLE, BLOCKS, BLOCK_ORDER, ROTATIONS,
  ECONOMY, WAVES, SABOTAGE, SIM, ROOM,
  ballCount, speedMultiplier, ballSpeed, paddleWidthFactor, paddleWidth,
  paddleTravel, waveConfig
} from "../public/js/engine/constants.js";

describe("field geometry", () => {
  test("the three row bands tile the grid exactly, with no gap or overlap", () => {
    assert.equal(ZONES.CORE_ROW_START, 0);
    assert.equal(ZONES.BUILD_ROW_START, ZONES.CORE_ROW_END + 1);
    assert.equal(ZONES.NOBUILD_ROW_START, ZONES.BUILD_ROW_END + 1);
    assert.equal(ZONES.NOBUILD_ROW_END, GRID.ROWS - 1);
  });

  test("the buildable zone is the largest band — it is where the game is played", () => {
    const build = ZONES.BUILD_ROW_END - ZONES.BUILD_ROW_START + 1;
    const core = ZONES.CORE_ROW_END - ZONES.CORE_ROW_START + 1;
    const nobuild = ZONES.NOBUILD_ROW_END - ZONES.NOBUILD_ROW_START + 1;
    assert.ok(build > core && build > nobuild, `build=${build} core=${core} nobuild=${nobuild}`);
  });

  test("the paddle sits inside the no-build band", () => {
    assert.ok(ZONES.PADDLE_ROW >= ZONES.NOBUILD_ROW_START);
    assert.ok(ZONES.PADDLE_ROW <= ZONES.NOBUILD_ROW_END);
  });

  test("the Core is centred on a whole column and fits its zone", () => {
    assert.ok(Number.isInteger(CORE.START_COL), `START_COL ${CORE.START_COL} is not a whole column`);
    const leftMargin = CORE.START_COL;
    const rightMargin = GRID.COLS - (CORE.START_COL + CORE.COLS);
    assert.equal(leftMargin, rightMargin, "Core is off-centre, which would bias left/right funnelling");
    assert.ok(CORE.START_ROW + CORE.ROWS - 1 <= ZONES.CORE_ROW_END, "Core overflows its zone");
    assert.ok(CORE.HP > 0);
  });

  test("gutters exist and still leave the paddle somewhere to travel", () => {
    assert.ok(ZONES.GUTTER_COLS > 0, "with no gutter the paddle covers everything and the game is unwinnable");
    for (const wave of [1, 10, 20, 40]) {
      const t = paddleTravel(wave);
      assert.ok(t.min < t.max, `wave ${wave}: paddle has no room to move`);
      assert.ok(t.min > 0 && t.max < GRID.COLS, `wave ${wave}: paddle escapes the field`);
    }
  });

  test("the paddle can never cover the full width — a gutter always survives", () => {
    for (const wave of [1, 5, 20, 60]) {
      const covered = paddleTravel(wave).max + paddleWidth(wave) / 2;
      assert.ok(covered < GRID.COLS, `wave ${wave}: paddle reaches the right edge, no gutter left`);
    }
  });
});

describe("block catalogue", () => {
  test("the palette lists every block exactly once", () => {
    assert.deepEqual([...BLOCK_ORDER].sort(), Object.keys(BLOCKS).sort());
    assert.equal(new Set(BLOCK_ORDER).size, BLOCK_ORDER.length);
  });

  test("every block has a positive cost and positive HP, and its id matches its key", () => {
    for (const [key, block] of Object.entries(BLOCKS)) {
      assert.equal(block.id, key, `${key}.id disagrees with its key`);
      assert.ok(block.cost > 0, `${key} costs ${block.cost}`);
      assert.ok(block.hp > 0, `${key} has ${block.hp} HP`);
      assert.ok(typeof block.label === "string" && block.label.length > 0);
    }
  });

  test("Wall is the cheapest block — it is the filler everything else is priced against", () => {
    const cheapest = Math.min(...Object.values(BLOCKS).map((b) => b.cost));
    assert.equal(BLOCKS.WALL.cost, cheapest);
  });

  test("only the Deflector is rotatable, and there are four orientations", () => {
    const rotatable = Object.values(BLOCKS).filter((b) => b.rotatable).map((b) => b.id);
    assert.deepEqual(rotatable, ["DEFLECTOR"]);
    assert.equal(ROTATIONS.length, 4);
    assert.equal(new Set(ROTATIONS).size, 4);
  });

  test("the starting purse affords a meaningful opening but not the whole board", () => {
    const cheapestFill = Math.floor(ECONOMY.START_SHARDS / BLOCKS.WALL.cost);
    const buildCells = (ZONES.BUILD_ROW_END - ZONES.BUILD_ROW_START + 1) * GRID.COLS;
    assert.ok(cheapestFill >= 8, `only ${cheapestFill} Walls affordable at the start`);
    assert.ok(cheapestFill < buildCells, "the opening purse fills the entire buildable zone");
  });
});

describe("economy", () => {
  test("a gutter kill pays clearly more than an absorb kill", () => {
    assert.ok(
      ECONOMY.GUTTER_KILL > ECONOMY.ABSORB_KILL * 1.5,
      "the reward gap is what steers players toward funnelling; keep it wide"
    );
  });

  test("selling never turns a profit", () => {
    assert.ok(ECONOMY.SELL_REFUND_FRACTION > 0 && ECONOMY.SELL_REFUND_FRACTION < 1);
  });

  test("a Generator has to survive several waves to repay itself", () => {
    const wavesToBreakEven = BLOCKS.GENERATOR.cost / ECONOMY.GENERATOR_YIELD;
    assert.ok(wavesToBreakEven >= 5, `pays for itself in ${wavesToBreakEven} waves — too safe an investment`);
  });
});

describe("escalation", () => {
  test("ball count matches the table in ProductSpec §6", () => {
    const expected = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4, 12: 4, 13: 5 };
    for (const [wave, balls] of Object.entries(expected)) {
      assert.equal(ballCount(Number(wave)), balls, `wave ${wave}`);
    }
  });

  test("ball count never decreases", () => {
    for (let w = 1; w < 60; w++) assert.ok(ballCount(w + 1) >= ballCount(w), `wave ${w}`);
  });

  test("speed starts at exactly 1.00× and rises every wave", () => {
    assert.equal(speedMultiplier(1), 1);
    for (let w = 1; w < 60; w++) {
      assert.ok(speedMultiplier(w + 1) > speedMultiplier(w), `wave ${w}`);
    }
  });

  test("speed growth is the compounding loop, not Math.pow", () => {
    // Repeated multiplication and Math.pow disagree in the last bits, and Math.pow is
    // not bit-portable across engines. This pins the behaviour to the portable one.
    let manual = 1;
    for (let w = 1; w < 25; w++) manual *= BALL.SPEED_GROWTH;
    assert.equal(speedMultiplier(25), manual);
  });

  test("the paddle is full width early, then shrinks in bands, then floors", () => {
    for (let w = 1; w < PADDLE.SHRINK_START_WAVE; w++) {
      assert.equal(paddleWidthFactor(w), 1, `wave ${w} should be full width`);
    }
    assert.ok(paddleWidthFactor(7) < 1);
    assert.ok(paddleWidthFactor(10) < paddleWidthFactor(7));
    for (let w = 1; w < 100; w++) {
      assert.ok(paddleWidthFactor(w + 1) <= paddleWidthFactor(w), `wave ${w} widened`);
      assert.ok(paddleWidthFactor(w) >= PADDLE.MIN_WIDTH_FACTOR, `wave ${w} fell through the floor`);
    }
    assert.equal(paddleWidthFactor(200), PADDLE.MIN_WIDTH_FACTOR);
  });

  test("waveConfig reports the same numbers as the individual helpers", () => {
    for (const w of [1, 7, 20]) {
      assert.deepEqual(waveConfig(w), {
        wave: w,
        balls: ballCount(w),
        ballSpeed: ballSpeed(w),
        paddleWidth: paddleWidth(w)
      });
    }
  });

  test("the winning wave is reachable and non-trivial", () => {
    assert.ok(WAVES.WIN_WAVE > 10);
    assert.ok(ballCount(WAVES.WIN_WAVE) > 1);
  });
});

describe("simulation safety", () => {
  /**
   * The collision test in T2.3 sweeps the ball in SUBSTEPS slices per timestep. If a
   * slice is ever longer than the ball's radius, the ball can skip clean through a
   * block and the wave silently goes wrong. Checked here so a future speed or
   * timestep tweak fails loudly instead of producing ghost balls.
   */
  test("a ball cannot tunnel through a block at any playable speed", () => {
    const sliceSeconds = SIM.TIMESTEP / SIM.SUBSTEPS;
    for (const wave of [1, WAVES.WIN_WAVE, 50]) {
      const travel = ballSpeed(wave) * sliceSeconds;
      assert.ok(
        travel < BALL.RADIUS,
        `wave ${wave}: ball moves ${travel.toFixed(4)} cells per substep vs radius ${BALL.RADIUS}`
      );
    }
  });

  test("there is comfortable headroom before tunnelling becomes possible", () => {
    const sliceSeconds = SIM.TIMESTEP / SIM.SUBSTEPS;
    let wave = WAVES.WIN_WAVE;
    while (ballSpeed(wave) * sliceSeconds < BALL.RADIUS && wave < 500) wave++;
    assert.ok(wave > WAVES.WIN_WAVE * 2, `tunnelling becomes possible at wave ${wave}`);
  });

  test("the step cap allows a long wave but still bounds the Durable Object", () => {
    const seconds = SIM.MAX_STEPS * SIM.TIMESTEP;
    assert.ok(seconds >= 60, `waves are cut off after ${seconds}s`);
    assert.ok(seconds <= 180, `${seconds}s of simulation is too much for one DO invocation`);
  });

  test("the ball keeps enough vertical motion to avoid horizontal deadlock", () => {
    assert.ok(BALL.MIN_VERTICAL_FRACTION > 0 && BALL.MIN_VERTICAL_FRACTION < 0.5);
  });
});

describe("room codes", () => {
  test("the alphabet excludes glyphs people misread aloud", () => {
    for (const glyph of ["0", "O", "1", "I", "l"]) {
      assert.ok(!ROOM.CODE_ALPHABET.includes(glyph), `${glyph} is ambiguous when read out`);
    }
  });

  test("the alphabet has no duplicates and enough codes to avoid collisions", () => {
    assert.equal(new Set(ROOM.CODE_ALPHABET).size, ROOM.CODE_ALPHABET.length);
    let space = 1;
    for (let i = 0; i < ROOM.CODE_LENGTH; i++) space *= ROOM.CODE_ALPHABET.length;
    assert.ok(space > 500000, `only ${space} possible room codes`);
  });

  test("rooms hold more than one player but stay small", () => {
    assert.ok(ROOM.MAX_PLAYERS >= 2 && ROOM.MAX_PLAYERS <= 8);
  });
});

describe("sabotage", () => {
  test("charging takes several gutter kills and sends at least one ball", () => {
    assert.ok(SABOTAGE.GUTTER_KILLS_PER_CHARGE >= 2);
    assert.ok(SABOTAGE.BALLS_SENT >= 1);
  });
});

describe("immutability", () => {
  test("constant groups are frozen, so nothing can retune the game at runtime", () => {
    for (const group of [GRID, ZONES, BALL, PADDLE, BLOCKS, ECONOMY, WAVES, SABOTAGE, SIM, ROOM]) {
      assert.ok(Object.isFrozen(group));
    }
    for (const block of Object.values(BLOCKS)) assert.ok(Object.isFrozen(block));
  });
});
