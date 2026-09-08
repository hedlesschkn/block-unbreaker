/**
 * The board: a grid of cells, the rules about what may go in them, and the damage
 * model. Pure — no DOM, no globals, no clocks, no randomness. Both the browser and
 * the Durable Object import this, and both must agree exactly (ProductSpec §9).
 *
 * A board is a flat array of `GRID.COLS * GRID.ROWS` cells, row-major. A cell is
 * either `null` or a block: `{ type, hp, rotation }`. Flat rather than nested because
 * the physics walks it a few million times per wave and index arithmetic is cheaper
 * than two dereferences.
 *
 * Board operations MUTATE. The simulation clones a board once at the start of a wave
 * and then chews on the copy; making every hit allocate a fresh 240-element array
 * would be pointless garbage. Call `clone()` when you want isolation.
 */

import { GRID, ZONES, CORE, BLOCKS, ROTATIONS, ECONOMY } from "./constants.js";

/** The Core is a block type, but not a placeable one — it never appears in the palette. */
export const CORE_TYPE = "CORE";

/**
 * Every block definition the board understands, placeable or not.
 * The Core reflects like a wall; it simply cannot be bought, sold or rebuilt.
 */
export const BLOCK_DEFS = Object.freeze({
  ...BLOCKS,
  [CORE_TYPE]: Object.freeze({
    id: CORE_TYPE,
    label: "Core",
    cost: 0,
    hp: CORE.HP,
    reflects: true,
    placeable: false
  })
});

/** Placement rejection reasons. Returned as codes so the UI and the DO agree on wording. */
export const REJECT = Object.freeze({
  OUT_OF_BOUNDS: "out_of_bounds",
  WRONG_ZONE: "wrong_zone",
  OCCUPIED: "occupied",
  UNKNOWN_TYPE: "unknown_type",
  NOT_PLACEABLE: "not_placeable",
  BAD_ROTATION: "bad_rotation",
  CANNOT_AFFORD: "cannot_afford",
  EMPTY_CELL: "empty_cell",
  NOT_SELLABLE: "not_sellable"
});

export const ZONE = Object.freeze({ CORE: "CORE", BUILD: "BUILD", NOBUILD: "NOBUILD" });

// ─── Geometry ────────────────────────────────────────────────────────────────

export const CELL_COUNT = GRID.COLS * GRID.ROWS;

/** Flat index for a cell. No bounds checking — call inBounds first. */
export function idx(col, row) {
  return row * GRID.COLS + col;
}

export function colOf(index) {
  return index % GRID.COLS;
}

export function rowOf(index) {
  return Math.floor(index / GRID.COLS);
}

export function inBounds(col, row) {
  return col >= 0 && col < GRID.COLS && row >= 0 && row < GRID.ROWS;
}

/** Which band a row belongs to. ProductSpec §2. */
export function zoneOf(row) {
  if (row <= ZONES.CORE_ROW_END) return ZONE.CORE;
  if (row <= ZONES.BUILD_ROW_END) return ZONE.BUILD;
  return ZONE.NOBUILD;
}

/** Cells inside the blast of a bomb at (col, row), the bomb's own cell included. */
export function blastCells(col, row, radius) {
  const cells = [];
  for (let r = row - radius; r <= row + radius; r++) {
    for (let c = col - radius; c <= col + radius; c++) {
      if (inBounds(c, r)) cells.push({ col: c, row: r });
    }
  }
  return cells;
}

// ─── Construction ────────────────────────────────────────────────────────────

/** A board with nothing on it but the Core. */
export function createBoard() {
  const board = { cells: new Array(CELL_COUNT).fill(null) };
  placeCore(board);
  return board;
}

/** Stamp the Core into the top zone. Centred; see the note in constants.js. */
export function placeCore(board) {
  for (let r = 0; r < CORE.ROWS; r++) {
    for (let c = 0; c < CORE.COLS; c++) {
      const col = CORE.START_COL + c;
      const row = CORE.START_ROW + r;
      board.cells[idx(col, row)] = { type: CORE_TYPE, hp: CORE.HP, rotation: null };
    }
  }
}

/** A deep copy. The simulation takes one of these per wave and mutates it freely. */
export function clone(board) {
  const cells = new Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = board.cells[i];
    cells[i] = cell === null ? null : { type: cell.type, hp: cell.hp, rotation: cell.rotation };
  }
  return { cells };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** The block at a cell, or null. Out-of-bounds reads as null, not as an error. */
export function getCell(board, col, row) {
  if (!inBounds(col, row)) return null;
  return board.cells[idx(col, row)];
}

export function isEmpty(board, col, row) {
  return getCell(board, col, row) === null;
}

/** Definition for a block type, or undefined. */
export function defOf(type) {
  return BLOCK_DEFS[type];
}

/** Does a block at this cell bounce the ball? Absorbers do not. */
export function reflectsAt(board, col, row) {
  const cell = getCell(board, col, row);
  return cell !== null && BLOCK_DEFS[cell.type].reflects === true;
}

/** Every occupied cell, as `{ col, row, block }`. */
export function occupiedCells(board) {
  const out = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    if (board.cells[i] !== null) out.push({ col: colOf(i), row: rowOf(i), block: board.cells[i] });
  }
  return out;
}

export function coreCells(board) {
  return occupiedCells(board).filter((c) => c.block.type === CORE_TYPE);
}

/** Total Core HP remaining — the multiplayer tiebreak, and the loss condition. */
export function coreHp(board) {
  return coreCells(board).reduce((sum, c) => sum + c.block.hp, 0);
}

/** The run ends when this is true. ProductSpec §4. */
export function isCoreDestroyed(board) {
  return coreCells(board).length === 0;
}

export function generatorCells(board) {
  return occupiedCells(board).filter((c) => BLOCK_DEFS[c.block.type].yieldsShards === true);
}

/** Shards paid out at the end of a wave by surviving Generators. ProductSpec §5. */
export function generatorYield(board) {
  return generatorCells(board).length * ECONOMY.GENERATOR_YIELD;
}

/** What the player has spent that is still standing — used by the results screen. */
export function investedValue(board) {
  return occupiedCells(board)
    .filter((c) => c.block.type !== CORE_TYPE)
    .reduce((sum, c) => sum + BLOCK_DEFS[c.block.type].cost, 0);
}

// ─── Placement ───────────────────────────────────────────────────────────────

/**
 * May this block go here?
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }`. The Durable Object calls this
 * before committing any client's request (T3.5), and the UI calls the same function
 * to grey out illegal cells — one implementation, so they can never disagree.
 *
 * @param shards  Pass the player's balance to include affordability, or Infinity to
 *                check only the geometry.
 */
export function canPlace(board, type, col, row, shards = Infinity, rotation = null) {
  const def = BLOCK_DEFS[type];
  if (def === undefined) return { ok: false, reason: REJECT.UNKNOWN_TYPE };
  if (def.placeable === false) return { ok: false, reason: REJECT.NOT_PLACEABLE };
  if (!inBounds(col, row)) return { ok: false, reason: REJECT.OUT_OF_BOUNDS };
  if (zoneOf(row) !== ZONE.BUILD) return { ok: false, reason: REJECT.WRONG_ZONE };
  if (!isEmpty(board, col, row)) return { ok: false, reason: REJECT.OCCUPIED };
  if (def.rotatable === true && rotation !== null && !ROTATIONS.includes(rotation)) {
    return { ok: false, reason: REJECT.BAD_ROTATION };
  }
  if (shards < def.cost) return { ok: false, reason: REJECT.CANNOT_AFFORD };
  return { ok: true };
}

/**
 * Place a block. Validates first and refuses rather than corrupting the board.
 * Returns `{ ok, cost }` or `{ ok: false, reason }`.
 */
export function place(board, type, col, row, rotation = null, shards = Infinity) {
  const check = canPlace(board, type, col, row, shards, rotation);
  if (!check.ok) return check;

  const def = BLOCK_DEFS[type];
  board.cells[idx(col, row)] = {
    type,
    hp: def.hp,
    rotation: def.rotatable === true ? (rotation ?? ROTATIONS[0]) : null
  };
  return { ok: true, cost: def.cost };
}

/** May this cell be sold? Core cannot; empty cells cannot. */
export function canSell(board, col, row) {
  if (!inBounds(col, row)) return { ok: false, reason: REJECT.OUT_OF_BOUNDS };
  const cell = getCell(board, col, row);
  if (cell === null) return { ok: false, reason: REJECT.EMPTY_CELL };
  if (BLOCK_DEFS[cell.type].placeable === false) return { ok: false, reason: REJECT.NOT_SELLABLE };
  return { ok: true };
}

/**
 * Sell a block back. Build phase only — the caller enforces the phase.
 * Refund is on the block's cost, not on its remaining HP: a chipped Wall refunds the
 * same as a fresh one, which keeps the build phase from becoming an accounting puzzle.
 */
export function sell(board, col, row) {
  const check = canSell(board, col, row);
  if (!check.ok) return check;

  const cell = getCell(board, col, row);
  const refund = Math.floor(BLOCK_DEFS[cell.type].cost * ECONOMY.SELL_REFUND_FRACTION);
  board.cells[idx(col, row)] = null;
  return { ok: true, refund };
}

/** Rotate a placed Deflector. Free, build phase only. */
export function rotate(board, col, row, rotation) {
  const cell = getCell(board, col, row);
  if (cell === null) return { ok: false, reason: REJECT.EMPTY_CELL };
  if (BLOCK_DEFS[cell.type].rotatable !== true) return { ok: false, reason: REJECT.NOT_PLACEABLE };
  if (!ROTATIONS.includes(rotation)) return { ok: false, reason: REJECT.BAD_ROTATION };
  cell.rotation = rotation;
  return { ok: true };
}

// ─── Damage ──────────────────────────────────────────────────────────────────

/**
 * Hit a block.
 *
 * Returns `{ hit, destroyed, type, wasCore, explodes }`. Bomb chain reactions are
 * NOT resolved here — the caller drives them, because a chain needs to emit an event
 * per detonation and needs to know which balls were caught. See `detonate`.
 */
export function damage(board, col, row, amount = 1) {
  const cell = getCell(board, col, row);
  if (cell === null) return { hit: false, destroyed: false };

  const def = BLOCK_DEFS[cell.type];
  cell.hp -= amount;

  if (cell.hp > 0) {
    return { hit: true, destroyed: false, type: cell.type, wasCore: cell.type === CORE_TYPE, explodes: false };
  }

  board.cells[idx(col, row)] = null;
  return {
    hit: true,
    destroyed: true,
    type: cell.type,
    wasCore: cell.type === CORE_TYPE,
    explodes: def.explodes === true
  };
}

/**
 * Resolve a bomb at (col, row) and every bomb it sets off, breadth-first.
 *
 * The bomb itself must already be destroyed. Returns the full list of cells caught in
 * any blast (`{ col, row }`), so the caller can check which balls were inside and
 * award kills. Friendly fire is the point: the blast destroys the player's own
 * adjacent blocks outright (ProductSpec §4).
 */
export function detonate(board, col, row) {
  const def = BLOCK_DEFS.BOMB;
  const queue = [{ col, row }];
  const blasted = [];
  const seen = new Set([idx(col, row)]);

  while (queue.length > 0) {
    const origin = queue.shift();
    for (const cell of blastCells(origin.col, origin.row, def.blastRadius)) {
      blasted.push(cell);
      const target = getCell(board, cell.col, cell.row);
      if (target === null) continue;

      const chains = target.type === "BOMB";
      board.cells[idx(cell.col, cell.row)] = null;

      // A bomb inside another bomb's blast detonates in turn.
      if (chains && !seen.has(idx(cell.col, cell.row))) {
        seen.add(idx(cell.col, cell.row));
        queue.push(cell);
      }
    }
  }
  return blasted;
}

// ─── Serialisation ───────────────────────────────────────────────────────────

/**
 * Compact wire form. A cell becomes `null` or `[typeIndex, hp, rotationIndex]`.
 *
 * Indices rather than names because a board crosses the socket on every placement
 * (`board_update`, ProductSpec §9) and 240 cells of `{"type":"DEFLECTOR",...}` is a
 * lot of bytes to spend saying very little.
 */
const TYPE_LIST = Object.freeze(Object.keys(BLOCK_DEFS));

export function serialize(board) {
  return board.cells.map((cell) => {
    if (cell === null) return null;
    const rot = cell.rotation === null ? -1 : ROTATIONS.indexOf(cell.rotation);
    return [TYPE_LIST.indexOf(cell.type), cell.hp, rot];
  });
}

export function deserialize(data) {
  if (!Array.isArray(data) || data.length !== CELL_COUNT) {
    throw new TypeError(`board.deserialize expects ${CELL_COUNT} cells, got ${Array.isArray(data) ? data.length : typeof data}`);
  }
  const cells = data.map((entry) => {
    if (entry === null) return null;
    const [typeIndex, hp, rotIndex] = entry;
    const type = TYPE_LIST[typeIndex];
    if (type === undefined) throw new TypeError(`unknown block type index ${typeIndex}`);
    return { type, hp, rotation: rotIndex === -1 ? null : ROTATIONS[rotIndex] };
  });
  return { cells };
}
