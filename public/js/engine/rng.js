/**
 * Seeded pseudo-random number generator.
 *
 * `Math.random` is banned everywhere under engine/ — it cannot be seeded, so the
 * Durable Object and the browser would immediately disagree about what happened in a
 * wave. Everything random in Block Unbreaker comes from here, from a seed the
 * Durable Object chooses and broadcasts (ProductSpec §9).
 *
 * The algorithm is mulberry32: a 32-bit-state generator built entirely from integer
 * operations — `Math.imul`, shifts and xor — every one of which is exactly specified.
 * The only floating-point step is the final divide by 2^32, which is exact. So the
 * sequence is identical on every JavaScript engine, today and in ten years. That is
 * the whole reason to hand-roll one instead of reaching for a library.
 *
 * Statistically it is more than good enough for launch angles and target selection.
 * It is not cryptographic, and nothing here should ever be used as if it were.
 */

/** Number of 32-bit values in the generator's state. Used when serialising. */
const STATE_SIZE = 1;

/**
 * Hash a string into a 32-bit seed, so a room code can seed a game directly.
 * FNV-1a — chosen for being short, integer-only and stable across engines.
 */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Combine a base seed with a channel number to get an independent stream.
 *
 * Use this rather than sharing one generator across concerns. If the wave's ball
 * launches and its sabotage targeting both drew from a single stream, adding one
 * extra draw to either would silently reshuffle the other — which turns a tiny
 * balance tweak into an unreproducible bug.
 */
export function deriveSeed(seed, channel) {
  const base = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  let h = base ^ Math.imul(channel >>> 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Create a generator.
 *
 * @param {number|string} seed  A 32-bit integer, or a string (room code) to hash.
 * @returns {{
 *   next: () => number,
 *   int: (maxExclusive: number) => number,
 *   range: (min: number, maxExclusive: number) => number,
 *   float: (min: number, max: number) => number,
 *   pick: <T>(items: T[]) => T,
 *   shuffle: <T>(items: T[]) => T[],
 *   save: () => number[],
 *   restore: (state: number[]) => void,
 *   fork: (channel: number) => object
 * }}
 */
export function createRng(seed) {
  let a = (typeof seed === "string" ? hashSeed(seed) : seed) >>> 0;

  /** Next float in [0, 1). */
  function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,

    /** Integer in [0, maxExclusive). */
    int(maxExclusive) {
      return Math.floor(next() * maxExclusive);
    },

    /** Integer in [min, maxExclusive). */
    range(min, maxExclusive) {
      return min + Math.floor(next() * (maxExclusive - min));
    },

    /** Float in [min, max). */
    float(min, max) {
      return min + next() * (max - min);
    },

    /** One item. Returns undefined for an empty array. */
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },

    /** A shuffled copy, Fisher-Yates. The input is not modified. */
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },

    /**
     * Snapshot the state so the Durable Object can persist mid-wave and resume
     * producing the identical sequence. ProductSpec §9.
     */
    save() {
      return [a];
    },

    restore(state) {
      if (!Array.isArray(state) || state.length !== STATE_SIZE) {
        throw new TypeError(`rng.restore expects ${STATE_SIZE} value(s), got ${JSON.stringify(state)}`);
      }
      a = state[0] >>> 0;
    },

    /** An independent generator derived from this one's seed. See deriveSeed. */
    fork(channel) {
      return createRng(deriveSeed(a, channel));
    }
  };
}
