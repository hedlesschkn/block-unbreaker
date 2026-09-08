import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { GRID, ZONES, CORE, BLOCKS, ECONOMY } from "../public/js/engine/constants.js";
import {
  createBoard, clone, idx, colOf, rowOf, inBounds, zoneOf, ZONE, blastCells,
  getCell, isEmpty, reflectsAt, occupiedCells, coreCells, coreHp, isCoreDestroyed,
  generatorCells, generatorYield, investedValue,
  canPlace, place, canSell, sell, rotate, damage, detonate,
  serialize, deserialize, CORE_TYPE, REJECT, CELL_COUNT
} from "../public/js/engine/board.js";

const BUILD_ROW = ZONES.BUILD_ROW_START;

describe("geometry helpers", () => {
  test("idx round-trips through colOf and rowOf", () => {
    for (let row = 0; row < GRID.ROWS; row++) {
      for (let col = 0; col < GRID.COLS; col++) {
        const i = idx(col, row);
        assert.equal(colOf(i), col);
        assert.equal(rowOf(i), row);
      }
    }
  });

  test("inBounds rejects everything off the grid", () => {
    assert.ok(inBounds(0, 0));
    assert.ok(inBounds(GRID.COLS - 1, GRID.ROWS - 1));
    for (const [c, r] of [[-1, 0], [0, -1], [GRID.COLS, 0], [0, GRID.ROWS]]) {
      assert.ok(!inBounds(c, r), `(${c},${r}) should be out of bounds`);
    }
  });

  test("zoneOf maps every row to exactly one band", () => {
    for (let row = 0; row <= ZONES.CORE_ROW_END; row++) assert.equal(zoneOf(row), ZONE.CORE);
    for (let row = ZONES.BUILD_ROW_START; row <= ZONES.BUILD_ROW_END; row++) assert.equal(zoneOf(row), ZONE.BUILD);
    for (let row = ZONES.NOBUILD_ROW_START; row <= ZONES.NOBUILD_ROW_END; row++) assert.equal(zoneOf(row), ZONE.NOBUILD);
  });

  test("blastCells covers a 3x3 and clips at the edges", () => {
    assert.equal(blastCells(5, 5, 1).length, 9);
    assert.equal(blastCells(0, 0, 1).length, 4);
    assert.equal(blastCells(GRID.COLS - 1, GRID.ROWS - 1, 1).length, 4);
  });
});

describe("a fresh board", () => {
  test("holds only the Core", () => {
    const board = createBoard();
    assert.equal(board.cells.length, CELL_COUNT);
    assert.equal(occupiedCells(board).length, CORE.COLS * CORE.ROWS);
    assert.equal(coreCells(board).length, CORE.COLS * CORE.ROWS);
  });

  test("starts at full Core HP and is not destroyed", () => {
    const board = createBoard();
    assert.equal(coreHp(board), CORE.COLS * CORE.ROWS * CORE.HP);
    assert.ok(!isCoreDestroyed(board));
  });

  test("puts the Core in the core zone and nowhere else", () => {
    const board = createBoard();
    for (const cell of coreCells(board)) {
      assert.equal(zoneOf(cell.row), ZONE.CORE);
    }
  });

  test("leaves the whole buildable zone free", () => {
    const board = createBoard();
    for (let row = ZONES.BUILD_ROW_START; row <= ZONES.BUILD_ROW_END; row++) {
      for (let col = 0; col < GRID.COLS; col++) assert.ok(isEmpty(board, col, row));
    }
  });
});

describe("placement rules", () => {
  test("a legal placement in the build zone succeeds and charges the cost", () => {
    const board = createBoard();
    const result = place(board, "WALL", 3, BUILD_ROW, null, 999);
    assert.deepEqual(result, { ok: true, cost: BLOCKS.WALL.cost });
    assert.equal(getCell(board, 3, BUILD_ROW).type, "WALL");
    assert.equal(getCell(board, 3, BUILD_ROW).hp, BLOCKS.WALL.hp);
  });

  test("the core zone and the no-build zone both refuse placement", () => {
    const board = createBoard();
    assert.equal(canPlace(board, "WALL", 0, ZONES.CORE_ROW_START).reason, REJECT.WRONG_ZONE);
    assert.equal(canPlace(board, "WALL", 0, ZONES.NOBUILD_ROW_START).reason, REJECT.WRONG_ZONE);
    assert.equal(canPlace(board, "WALL", 0, ZONES.PADDLE_ROW).reason, REJECT.WRONG_ZONE);
  });

  test("an occupied cell refuses a second block", () => {
    const board = createBoard();
    place(board, "WALL", 4, BUILD_ROW, null, 999);
    assert.equal(canPlace(board, "WALL", 4, BUILD_ROW, 999).reason, REJECT.OCCUPIED);
  });

  test("off-grid placement is rejected, not wrapped", () => {
    const board = createBoard();
    assert.equal(canPlace(board, "WALL", -1, BUILD_ROW).reason, REJECT.OUT_OF_BOUNDS);
    assert.equal(canPlace(board, "WALL", GRID.COLS, BUILD_ROW).reason, REJECT.OUT_OF_BOUNDS);
  });

  test("an unaffordable block is rejected", () => {
    const board = createBoard();
    assert.equal(canPlace(board, "GENERATOR", 2, BUILD_ROW, BLOCKS.GENERATOR.cost - 1).reason, REJECT.CANNOT_AFFORD);
    assert.ok(canPlace(board, "GENERATOR", 2, BUILD_ROW, BLOCKS.GENERATOR.cost).ok);
  });

  test("the Core cannot be placed by a player", () => {
    const board = createBoard();
    assert.equal(canPlace(board, CORE_TYPE, 0, BUILD_ROW).reason, REJECT.NOT_PLACEABLE);
  });

  test("an unknown block type is rejected", () => {
    const board = createBoard();
    assert.equal(canPlace(board, "TREBUCHET", 0, BUILD_ROW).reason, REJECT.UNKNOWN_TYPE);
  });

  test("a rejected placement leaves the board untouched", () => {
    const board = createBoard();
    const before = serialize(board);
    place(board, "WALL", 0, ZONES.CORE_ROW_START, null, 999);
    place(board, "TREBUCHET", 0, BUILD_ROW, null, 999);
    place(board, "GENERATOR", 0, BUILD_ROW, null, 0);
    assert.deepEqual(serialize(board), before);
  });

  test("a Deflector takes a rotation; a Wall does not", () => {
    const board = createBoard();
    place(board, "DEFLECTOR", 1, BUILD_ROW, "SW", 999);
    assert.equal(getCell(board, 1, BUILD_ROW).rotation, "SW");

    place(board, "WALL", 2, BUILD_ROW, "SW", 999);
    assert.equal(getCell(board, 2, BUILD_ROW).rotation, null);
  });

  test("a Deflector placed without a rotation gets a default rather than null", () => {
    const board = createBoard();
    place(board, "DEFLECTOR", 5, BUILD_ROW, null, 999);
    assert.notEqual(getCell(board, 5, BUILD_ROW).rotation, null);
  });

  test("an invalid rotation is rejected", () => {
    const board = createBoard();
    assert.equal(canPlace(board, "DEFLECTOR", 1, BUILD_ROW, 999, "SIDEWAYS").reason, REJECT.BAD_ROTATION);
  });

  test("rotate changes a placed Deflector and refuses everything else", () => {
    const board = createBoard();
    place(board, "DEFLECTOR", 1, BUILD_ROW, "NE", 999);
    assert.ok(rotate(board, 1, BUILD_ROW, "SE").ok);
    assert.equal(getCell(board, 1, BUILD_ROW).rotation, "SE");

    place(board, "WALL", 2, BUILD_ROW, null, 999);
    assert.ok(!rotate(board, 2, BUILD_ROW, "SE").ok);
    assert.equal(rotate(board, 9, BUILD_ROW, "SE").reason, REJECT.EMPTY_CELL);
  });
});

describe("selling", () => {
  test("refunds half the cost, floored, and clears the cell", () => {
    const board = createBoard();
    place(board, "GENERATOR", 3, BUILD_ROW, null, 999);
    const result = sell(board, 3, BUILD_ROW);
    assert.equal(result.refund, Math.floor(BLOCKS.GENERATOR.cost * ECONOMY.SELL_REFUND_FRACTION));
    assert.ok(isEmpty(board, 3, BUILD_ROW));
  });

  test("a damaged block refunds the same as a fresh one", () => {
    const board = createBoard();
    place(board, "WALL", 3, BUILD_ROW, null, 999);
    damage(board, 3, BUILD_ROW, 1);
    assert.equal(sell(board, 3, BUILD_ROW).refund, Math.floor(BLOCKS.WALL.cost * ECONOMY.SELL_REFUND_FRACTION));
  });

  test("selling never profits", () => {
    for (const [type, def] of Object.entries(BLOCKS)) {
      const board = createBoard();
      place(board, type, 3, BUILD_ROW, null, 999);
      assert.ok(sell(board, 3, BUILD_ROW).refund < def.cost, `${type} refunds its full cost`);
    }
  });

  test("the Core cannot be sold, and neither can an empty cell", () => {
    const board = createBoard();
    assert.equal(sell(board, CORE.START_COL, CORE.START_ROW).reason, REJECT.NOT_SELLABLE);
    assert.equal(coreCells(board).length, CORE.COLS * CORE.ROWS);
    assert.equal(sell(board, 0, BUILD_ROW).reason, REJECT.EMPTY_CELL);
  });
});

describe("damage", () => {
  test("a Wall takes exactly its HP in hits before breaking", () => {
    const board = createBoard();
    place(board, "WALL", 3, BUILD_ROW, null, 999);
    for (let i = 1; i < BLOCKS.WALL.hp; i++) {
      assert.equal(damage(board, 3, BUILD_ROW).destroyed, false, `broke early on hit ${i}`);
    }
    const final = damage(board, 3, BUILD_ROW);
    assert.equal(final.destroyed, true);
    assert.equal(final.type, "WALL");
    assert.ok(isEmpty(board, 3, BUILD_ROW));
  });

  test("hitting an empty cell is a no-op, not a crash", () => {
    const board = createBoard();
    assert.deepEqual(damage(board, 0, BUILD_ROW), { hit: false, destroyed: false });
  });

  test("overkill damage destroys without going negative", () => {
    const board = createBoard();
    place(board, "WALL", 3, BUILD_ROW, null, 999);
    assert.equal(damage(board, 3, BUILD_ROW, 99).destroyed, true);
  });

  test("destroying a Bomb reports that it explodes; a Wall does not", () => {
    const board = createBoard();
    place(board, "BOMB", 3, BUILD_ROW, null, 999);
    assert.equal(damage(board, 3, BUILD_ROW, 99).explodes, true);
    place(board, "WALL", 4, BUILD_ROW, null, 999);
    assert.equal(damage(board, 4, BUILD_ROW, 99).explodes, false);
  });

  test("Core damage is flagged, and clearing the Core ends the run", () => {
    const board = createBoard();
    const hit = damage(board, CORE.START_COL, CORE.START_ROW, 1);
    assert.equal(hit.wasCore, true);
    assert.equal(coreHp(board), CORE.COLS * CORE.ROWS * CORE.HP - 1);

    for (const cell of coreCells(board)) damage(board, cell.col, cell.row, CORE.HP);
    assert.ok(isCoreDestroyed(board));
    assert.equal(coreHp(board), 0);
  });
});

describe("bomb detonation", () => {
  test("clears the surrounding 3x3, friendly fire included", () => {
    const board = createBoard();
    const row = BUILD_ROW + 3;
    for (let c = 4; c <= 6; c++) {
      for (let r = row - 1; r <= row + 1; r++) {
        if (c === 5 && r === row) continue; // leave the centre free for the bomb
        place(board, "WALL", c, r, null, 9999);
      }
    }
    place(board, "BOMB", 5, row, null, 9999);
    assert.equal(damage(board, 5, row, 99).explodes, true);

    detonate(board, 5, row);
    for (let c = 4; c <= 6; c++) {
      for (let r = row - 1; r <= row + 1; r++) {
        assert.ok(isEmpty(board, c, r), `(${c},${r}) survived the blast`);
      }
    }
  });

  test("returns every cell caught in the blast, so balls can be checked against it", () => {
    const board = createBoard();
    const blasted = detonate(board, 5, BUILD_ROW + 3);
    assert.equal(blasted.length, 9);
  });

  test("a bomb inside a blast chains, and the chain terminates", () => {
    const board = createBoard();
    const row = BUILD_ROW + 3;
    place(board, "BOMB", 4, row, null, 9999);
    place(board, "BOMB", 5, row, null, 9999);
    place(board, "BOMB", 6, row, null, 9999);
    place(board, "WALL", 7, row, null, 9999);

    damage(board, 4, row, 99);
    detonate(board, 4, row);

    for (const col of [4, 5, 6, 7]) {
      assert.ok(isEmpty(board, col, row), `(${col},${row}) survived a chain that should have reached it`);
    }
  });

  test("a ring of bombs does not loop forever", () => {
    const board = createBoard();
    const row = BUILD_ROW + 3;
    for (let c = 2; c < 10; c++) {
      place(board, "BOMB", c, row, null, 99999);
      place(board, "BOMB", c, row + 1, null, 99999);
    }
    damage(board, 2, row, 99);
    const blasted = detonate(board, 2, row);
    assert.ok(blasted.length > 0);
    assert.ok(blasted.length < 5000, "blast list grew unreasonably — chain may be revisiting cells");
  });

  test("a blast at the board edge does not reach off-grid", () => {
    const board = createBoard();
    const blasted = detonate(board, 0, ZONES.BUILD_ROW_START);
    for (const cell of blasted) assert.ok(inBounds(cell.col, cell.row));
  });
});

describe("queries the game reads every wave", () => {
  test("reflectsAt is true for walls and false for absorbers and empty cells", () => {
    const board = createBoard();
    place(board, "WALL", 3, BUILD_ROW, null, 999);
    place(board, "ABSORBER", 4, BUILD_ROW, null, 999);
    assert.equal(reflectsAt(board, 3, BUILD_ROW), true);
    assert.equal(reflectsAt(board, 4, BUILD_ROW), false);
    assert.equal(reflectsAt(board, 5, BUILD_ROW), false);
    assert.equal(reflectsAt(board, CORE.START_COL, CORE.START_ROW), true);
  });

  test("generator payout scales with surviving generators", () => {
    const board = createBoard();
    assert.equal(generatorYield(board), 0);
    place(board, "GENERATOR", 1, BUILD_ROW, null, 999);
    place(board, "GENERATOR", 2, BUILD_ROW, null, 999);
    assert.equal(generatorCells(board).length, 2);
    assert.equal(generatorYield(board), 2 * ECONOMY.GENERATOR_YIELD);

    damage(board, 1, BUILD_ROW, 99);
    assert.equal(generatorYield(board), ECONOMY.GENERATOR_YIELD);
  });

  test("investedValue counts placed blocks and ignores the Core", () => {
    const board = createBoard();
    assert.equal(investedValue(board), 0);
    place(board, "WALL", 1, BUILD_ROW, null, 999);
    place(board, "BOMB", 2, BUILD_ROW, null, 999);
    assert.equal(investedValue(board), BLOCKS.WALL.cost + BLOCKS.BOMB.cost);
  });
});

describe("clone", () => {
  test("is deep — mutating the copy leaves the original alone", () => {
    const board = createBoard();
    place(board, "WALL", 3, BUILD_ROW, null, 999);
    const copy = clone(board);

    damage(copy, 3, BUILD_ROW, 99);
    place(copy, "BOMB", 7, BUILD_ROW, null, 999);
    damage(copy, CORE.START_COL, CORE.START_ROW, 5);

    assert.equal(getCell(board, 3, BUILD_ROW).type, "WALL");
    assert.ok(isEmpty(board, 7, BUILD_ROW));
    assert.equal(getCell(board, CORE.START_COL, CORE.START_ROW).hp, CORE.HP);
  });
});

describe("serialisation", () => {
  test("round-trips a populated board unchanged", () => {
    const board = createBoard();
    place(board, "WALL", 1, BUILD_ROW, null, 9999);
    place(board, "DEFLECTOR", 2, BUILD_ROW, "SW", 9999);
    place(board, "ABSORBER", 3, BUILD_ROW, null, 9999);
    place(board, "BOMB", 4, BUILD_ROW, null, 9999);
    place(board, "GENERATOR", 5, BUILD_ROW, null, 9999);
    damage(board, 1, BUILD_ROW, 1);

    const revived = deserialize(JSON.parse(JSON.stringify(serialize(board))));
    assert.deepEqual(revived.cells, board.cells);
    assert.equal(getCell(revived, 2, BUILD_ROW).rotation, "SW");
    assert.equal(getCell(revived, 1, BUILD_ROW).hp, BLOCKS.WALL.hp - 1);
  });

  test("is compact — empty cells cost one token each", () => {
    const board = createBoard();
    const bytes = JSON.stringify(serialize(board)).length;
    assert.ok(bytes < 1400, `serialised board is ${bytes} bytes`);
  });

  test("rejects malformed input instead of producing a broken board", () => {
    assert.throws(() => deserialize(null), TypeError);
    assert.throws(() => deserialize([]), TypeError);
    assert.throws(() => deserialize(new Array(CELL_COUNT).fill([999, 1, -1])), TypeError);
  });
});
