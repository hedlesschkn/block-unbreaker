import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createRng, hashSeed, deriveSeed } from "../public/js/engine/rng.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RNG_PATH = resolve(HERE, "../public/js/engine/rng.js");

/**
 * Golden vectors, generated once and committed.
 *
 * This is the load-bearing test in the file. Because these numbers were produced by a
 * previous, separate process and frozen here, any future run that still matches them
 * has proved determinism across processes, across Node versions, and across time.
 * If mulberry32 is ever swapped out, or an operation in it stops being bit-exact,
 * this is what fails.
 *
 * Do not regenerate these to make a failing test pass. A change here means every
 * client and the Durable Object would disagree about a wave (ProductSpec §9).
 */
const GOLDEN = {
  BLOK: [
    0.7448408761993051, 0.38097210484556854, 0.7328671563882381, 0.22015582537278533,
    0.7291917516849935, 0.06377482344396412, 0.6120577591937035, 0.525186346611008,
    0.9897410105913877, 0.39462787634693086
  ],
  12345: [
    0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203,
    0.5094283693470061, 0.34747186047025025, 0.07375754183158278, 0.7663964673411101,
    0.9968264393974096, 0.8250224851071835
  ],
  0: [
    0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111,
    0.46732782293111086, 0.5450490827206522, 0.6152513844426721, 0.6489853798411787,
    0.45600721263326705, 0.581218967679888
  ]
};

describe("determinism", () => {
  test("matches the committed golden vector for a string seed", () => {
    const rng = createRng("BLOK");
    assert.deepEqual(Array.from({ length: 10 }, () => rng.next()), GOLDEN.BLOK);
  });

  test("matches the committed golden vector for an integer seed", () => {
    const rng = createRng(12345);
    assert.deepEqual(Array.from({ length: 10 }, () => rng.next()), GOLDEN[12345]);
  });

  test("seed 0 is a real seed, not a falsy accident", () => {
    const rng = createRng(0);
    assert.deepEqual(Array.from({ length: 10 }, () => rng.next()), GOLDEN[0]);
  });

  test("two generators with the same seed stay in lockstep for 10k draws", () => {
    const a = createRng("ROOM");
    const b = createRng("ROOM");
    for (let i = 0; i < 10000; i++) {
      assert.equal(a.next(), b.next(), `diverged at draw ${i}`);
    }
  });

  test("different seeds produce different streams", () => {
    const a = createRng("AAAA");
    const b = createRng("BBBB");
    const overlap = Array.from({ length: 100 }, () => a.next())
      .filter((v, i) => v === Array.from({ length: 100 }, () => b.next())[i]);
    assert.equal(overlap.length, 0);
  });

  /**
   * The definition of done for T2.1, taken literally: a genuinely separate `node`
   * process, its own V8 isolate, its own module registry, compared to ours.
   */
  test("a separate node process produces the identical sequence", () => {
    const script = `
      import { createRng } from ${JSON.stringify(RNG_PATH)};
      const rng = createRng("CROSS-PROCESS");
      process.stdout.write(JSON.stringify(Array.from({length: 500}, () => rng.next())));
    `;
    const childOutput = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8"
    });

    const here = createRng("CROSS-PROCESS");
    const mine = Array.from({ length: 500 }, () => here.next());

    assert.deepEqual(JSON.parse(childOutput), mine);
  });
});

describe("output shape", () => {
  test("every draw lies in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 50000; i++) {
      const v = rng.next();
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
  });

  test("the stream is broadly uniform across ten buckets", () => {
    const rng = createRng("UNIFORM");
    const buckets = new Array(10).fill(0);
    const draws = 100000;
    for (let i = 0; i < draws; i++) buckets[Math.floor(rng.next() * 10)]++;
    // A fair generator puts 10% in each bucket; allow a generous ±1.5%.
    for (const [i, count] of buckets.entries()) {
      const share = count / draws;
      assert.ok(share > 0.085 && share < 0.115, `bucket ${i} held ${(share * 100).toFixed(2)}%`);
    }
  });

  test("does not get stuck or short-cycle", () => {
    const rng = createRng(1);
    const seen = new Set();
    for (let i = 0; i < 20000; i++) seen.add(rng.next());
    assert.ok(seen.size > 19900, `only ${seen.size} distinct values in 20000 draws`);
  });
});

describe("helpers", () => {
  test("int stays inside [0, max)", () => {
    const rng = createRng("INT");
    for (let i = 0; i < 10000; i++) {
      const v = rng.int(6);
      assert.ok(Number.isInteger(v) && v >= 0 && v < 6, `got ${v}`);
    }
  });

  test("range stays inside [min, max)", () => {
    const rng = createRng("RANGE");
    for (let i = 0; i < 10000; i++) {
      const v = rng.range(3, 9);
      assert.ok(Number.isInteger(v) && v >= 3 && v < 9, `got ${v}`);
    }
  });

  test("float stays inside [min, max)", () => {
    const rng = createRng("FLOAT");
    for (let i = 0; i < 10000; i++) {
      const v = rng.float(-2, 5);
      assert.ok(v >= -2 && v < 5, `got ${v}`);
    }
  });

  test("pick only ever returns a member of the array", () => {
    const rng = createRng("PICK");
    const items = ["WALL", "DEFLECTOR", "ABSORBER"];
    for (let i = 0; i < 1000; i++) assert.ok(items.includes(rng.pick(items)));
  });

  test("shuffle permutes without mutating the input", () => {
    const rng = createRng("BLOK");
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8], "input was mutated");
    assert.deepEqual([...out].sort((a, b) => a - b), input, "not a permutation");
    assert.deepEqual(out, [4, 8, 1, 7, 2, 5, 3, 6], "shuffle drifted from its golden result");
  });
});

describe("seed derivation", () => {
  test("hashSeed is stable and unsigned", () => {
    assert.equal(hashSeed("BLOK"), 1182185637);
    assert.equal(hashSeed(""), 2166136261);
    assert.equal(hashSeed("block-unbreaker"), 799068290);
    assert.ok(hashSeed("anything") >= 0);
  });

  test("hashSeed separates similar strings", () => {
    assert.notEqual(hashSeed("ROOM1"), hashSeed("ROOM2"));
    assert.notEqual(hashSeed("AB"), hashSeed("BA"));
  });

  test("deriveSeed is stable", () => {
    assert.deepEqual(
      [deriveSeed("BLOK", 0), deriveSeed("BLOK", 1), deriveSeed(12345, 7)],
      [4224956273, 2482154809, 4222630420]
    );
  });

  test("channels give independent streams from one seed", () => {
    const balls = createRng(deriveSeed("BLOK", 0));
    const sabotage = createRng(deriveSeed("BLOK", 1));
    const a = Array.from({ length: 50 }, () => balls.next());
    const b = Array.from({ length: 50 }, () => sabotage.next());
    assert.notDeepEqual(a, b);
  });

  test("fork is reproducible from the same parent state", () => {
    const parent = createRng("BLOK");
    const one = parent.fork(3);
    const parentAgain = createRng("BLOK");
    const two = parentAgain.fork(3);
    assert.equal(one.next(), two.next());
  });
});

describe("save and restore", () => {
  test("restoring a snapshot resumes the identical sequence", () => {
    const rng = createRng("SNAPSHOT");
    for (let i = 0; i < 25; i++) rng.next();

    const snapshot = rng.save();
    const expected = Array.from({ length: 20 }, () => rng.next());

    const revived = createRng(0);
    revived.restore(snapshot);
    assert.deepEqual(Array.from({ length: 20 }, () => revived.next()), expected);
  });

  test("a snapshot survives a JSON round trip, as the Durable Object will store it", () => {
    const rng = createRng("PERSIST");
    for (let i = 0; i < 10; i++) rng.next();

    const stored = JSON.parse(JSON.stringify({ rng: rng.save() }));
    const expected = Array.from({ length: 10 }, () => rng.next());

    const revived = createRng(0);
    revived.restore(stored.rng);
    assert.deepEqual(Array.from({ length: 10 }, () => revived.next()), expected);
  });

  test("restore rejects malformed state rather than silently desyncing", () => {
    const rng = createRng(1);
    assert.throws(() => rng.restore(null), TypeError);
    assert.throws(() => rng.restore([]), TypeError);
    assert.throws(() => rng.restore([1, 2]), TypeError);
  });
});

describe("determinism contract", () => {
  /**
   * Standing rule 2: engine/ must not reach for anything whose result is not
   * bit-identical across JavaScript engines. A Safari client and the workerd
   * Durable Object round Math.sin differently, and one wrong bit in a velocity is a
   * different wave ten bounces later. Guarded here so it cannot creep in later.
   */
  test("rng.js uses no banned non-deterministic or transcendental calls", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(RNG_PATH, "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const banned = [
      "Math.random", "Date.now", "performance.now",
      "Math.sin", "Math.cos", "Math.tan", "Math.atan2", "Math.asin", "Math.acos",
      "Math.pow", "Math.exp", "Math.log", "Math.hypot", "Math.cbrt"
    ];
    for (const name of banned) {
      assert.ok(!code.includes(name), `engine/rng.js must not call ${name}`);
    }
  });
});
