/**
 * Sound, synthesised on the fly with WebAudio.
 *
 * No audio files: the whole game stays a handful of text assets, there is nothing to
 * 404, and the deploy has no binary payload. Every sound here is an oscillator or a
 * burst of noise shaped by an envelope.
 *
 * Browsers refuse to start an AudioContext until the user has interacted with the
 * page, so the context is created lazily on the first sound after a real click.
 */

const STORAGE_KEY = "bu.muted";

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private browsing, or storage disabled. Default to audible.
  }

  function ensure() {
    if (ctx !== null) return true;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (AudioContextClass === undefined) return false;
    ctx = new AudioContextClass();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
    return true;
  }

  /** A shaped oscillator note. */
  function tone(freq, { duration = 0.09, type = "square", gain = 0.5, sweepTo = null, delay = 0 } = {}) {
    if (muted || !ensure()) return;
    const start = ctx.currentTime + delay;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (sweepTo !== null) osc.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** A burst of filtered noise, for impacts. */
  function noise({ duration = 0.16, gain = 0.4, frequency = 1200, q = 1.1 } = {}) {
    if (muted || !ensure()) return;
    const start = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter).connect(env).connect(master);
    source.start(start);
  }

  return {
    get muted() { return muted; },

    setMuted(value) {
      muted = value;
      try { localStorage.setItem(STORAGE_KEY, value ? "1" : "0"); } catch { /* ignore */ }
    },

    toggle() {
      this.setMuted(!muted);
      return muted;
    },

    /** Unlock the context on a real user gesture. */
    unlock() {
      if (ensure() && ctx.state === "suspended") ctx.resume();
    },

    bounce() { tone(420, { duration: 0.045, type: "square", gain: 0.16 }); },
    wallBounce() { tone(260, { duration: 0.04, type: "square", gain: 0.10 }); },
    paddleHit() { tone(180, { duration: 0.07, type: "sawtooth", gain: 0.22, sweepTo: 130 }); },

    blockBreak() { noise({ duration: 0.14, gain: 0.34, frequency: 1500 }); },
    bomb() {
      noise({ duration: 0.42, gain: 0.6, frequency: 190, q: 0.6 });
      tone(90, { duration: 0.34, type: "sawtooth", gain: 0.4, sweepTo: 40 });
    },

    /** The reward sound. Rising, because this is the thing you want to hear. */
    gutterKill() {
      tone(523, { duration: 0.08, type: "triangle", gain: 0.3 });
      tone(784, { duration: 0.09, type: "triangle", gain: 0.3, delay: 0.07 });
      tone(1046, { duration: 0.13, type: "triangle", gain: 0.28, delay: 0.14 });
    },

    absorb() { tone(300, { duration: 0.18, type: "sine", gain: 0.3, sweepTo: 90 }); },

    /** Falling and dissonant — you are being hurt. */
    coreHit() {
      tone(160, { duration: 0.26, type: "sawtooth", gain: 0.38, sweepTo: 70 });
      noise({ duration: 0.18, gain: 0.22, frequency: 420 });
    },

    waveStart() {
      tone(330, { duration: 0.1, type: "square", gain: 0.24 });
      tone(494, { duration: 0.16, type: "square", gain: 0.24, delay: 0.1 });
    },

    waveCleared() {
      for (const [i, f] of [523, 659, 784, 1046].entries()) {
        tone(f, { duration: 0.14, type: "triangle", gain: 0.26, delay: i * 0.09 });
      }
    },

    place() { tone(600, { duration: 0.04, type: "square", gain: 0.14 }); },
    sell() { tone(400, { duration: 0.06, type: "square", gain: 0.14, sweepTo: 260 }); },
    denied() { tone(120, { duration: 0.11, type: "square", gain: 0.2 }); },

    gameOver() {
      for (const [i, f] of [392, 330, 262, 196].entries()) {
        tone(f, { duration: 0.3, type: "sawtooth", gain: 0.3, delay: i * 0.17 });
      }
    },

    victory() {
      for (const [i, f] of [523, 659, 784, 1046, 1318].entries()) {
        tone(f, { duration: 0.22, type: "triangle", gain: 0.3, delay: i * 0.12 });
      }
    }
  };
}
