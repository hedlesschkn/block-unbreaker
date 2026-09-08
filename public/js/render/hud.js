/**
 * The DOM side of the game screen: purse, palette, wave, timers, Core bar, feed.
 *
 * Deliberately not on the canvas. Text belongs in the DOM where it can be selected,
 * read by a screen reader, and scale with the user's font settings — and it keeps the
 * canvas doing one job.
 */

import { BLOCKS, BLOCK_ORDER, ECONOMY, WAVES, waveConfig, ballCount } from "../engine/constants.js";
import { PALETTE } from "./palette.js";
import { PHASE } from "../game/session.js";

/**
 * One line of plain English per block, so nothing needs a manual. HP figures are read
 * from the catalogue rather than written out, so a balance change cannot leave the
 * palette telling the player something that stopped being true.
 */
const BLURB = Object.freeze({
  WALL: `Cheap armour. Bounces the ball and soaks ${BLOCKS.WALL.hp} hits.`,
  DEFLECTOR: "Throws the ball along its diagonal, whichever way it came in. Click a placed one to turn it. This is how you aim.",
  ABSORBER: "Eats one ball and is consumed. Your panic button.",
  BOMB: "Blows up a 3×3 when broken — balls and your own blocks alike.",
  GENERATOR: `Pays +${ECONOMY.GENERATOR_YIELD} Shards every wave it survives. Keep it out of the firing line.`
});

const FEED_LIMIT = 7;

export function createHud(root, session) {
  const el = {
    shards: root.querySelector("#hud-shards"),
    palette: root.querySelector("#hud-palette"),
    wave: root.querySelector("#hud-wave"),
    waveTarget: root.querySelector("#hud-wave-target"),
    phaseLabel: root.querySelector("#hud-phase-label"),
    phaseNote: root.querySelector("#hud-phase-note"),
    timer: root.querySelector("#hud-timer"),
    core: root.querySelector("#hud-core"),
    coreNote: root.querySelector("#hud-core-note"),
    incoming: root.querySelector("#hud-incoming"),
    ready: root.querySelector("#btn-ready"),
    banner: root.querySelector("#hud-banner"),
    feed: root.querySelector("#hud-feed")
  };

  let selected = BLOCK_ORDER[0];
  let lastShards = null;
  const buttons = new Map();

  // ── Palette ──────────────────────────────────────────────────────────────

  for (const [index, type] of BLOCK_ORDER.entries()) {
    const def = BLOCKS[type];
    const colors = PALETTE.blocks[type];

    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-item";
    button.dataset.type = type;
    button.innerHTML = `
      <span class="palette-swatch" style="background:${colors.face}"></span>
      <span><span class="palette-name">${def.label}</span> <span class="palette-key">${index + 1}</span></span>
      <span class="palette-cost">${def.cost}</span>
      <span class="palette-desc">${BLURB[type]}</span>`;
    button.addEventListener("click", () => select(type));
    buttons.set(type, button);
    li.appendChild(button);
    el.palette.appendChild(li);
  }

  function select(type) {
    selected = type;
    for (const [key, button] of buttons) button.classList.toggle("is-selected", key === type);
  }
  select(selected);

  // ── Feed ─────────────────────────────────────────────────────────────────

  function log(text, tone = "") {
    const li = document.createElement("li");
    li.textContent = text;
    if (tone !== "") li.className = tone;
    el.feed.prepend(li);
    while (el.feed.children.length > FEED_LIMIT) el.feed.lastChild.remove();
  }

  // ── Banner ───────────────────────────────────────────────────────────────

  let bannerTimer = null;

  function banner(title, sub = "", bad = false, ms = 2000) {
    el.banner.innerHTML =
      `<span class="banner-title${bad ? " is-bad" : ""}">${title}</span>` +
      (sub === "" ? "" : `<span class="banner-sub">${sub}</span>`);
    el.banner.hidden = false;
    clearTimeout(bannerTimer);
    if (ms > 0) bannerTimer = setTimeout(() => { el.banner.hidden = true; }, ms);
  }

  function hideBanner() {
    clearTimeout(bannerTimer);
    el.banner.hidden = true;
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  function update() {
    // Purse, with a bump when it changes.
    if (session.shards !== lastShards) {
      el.shards.textContent = session.shards;
      if (lastShards !== null) {
        el.shards.classList.remove("is-bump");
        void el.shards.offsetWidth; // restart the animation
        el.shards.classList.add("is-bump");
      }
      lastShards = session.shards;
    }

    const building = session.phase === PHASE.BUILD;
    for (const [type, button] of buttons) {
      button.classList.toggle("is-broke", !session.canAfford(type));
      button.disabled = !building;
    }

    el.wave.textContent = session.wave;
    el.waveTarget.textContent = `of ${WAVES.WIN_WAVE} to win`;

    const config = waveConfig(session.wave);
    el.incoming.textContent =
      `${config.balls} ball${config.balls === 1 ? "" : "s"} · ` +
      `${(config.ballSpeed / 9).toFixed(2)}× speed · paddle ${config.paddleWidth.toFixed(1)} wide`;

    // Phase label, note and timer bar.
    if (building) {
      el.phaseLabel.textContent = "Build";
      el.phaseNote.textContent = "Place your defences";
      const fraction = session.buildRemaining / WAVES.BUILD_SECONDS;
      el.timer.style.width = `${fraction * 100}%`;
      el.timer.classList.toggle("is-urgent", session.buildRemaining <= 6);
      el.ready.disabled = false;
      el.ready.textContent = `Ready (${Math.ceil(session.buildRemaining)}s)`;
    } else if (session.phase === PHASE.WAVE) {
      el.phaseLabel.textContent = "Wave";
      el.phaseNote.textContent = "You cannot intervene. Watch.";
      el.timer.style.width = "100%";
      el.timer.classList.remove("is-urgent");
      el.ready.disabled = true;
      el.ready.textContent = "In progress";
    } else if (session.phase === PHASE.RESOLVE) {
      el.phaseLabel.textContent = "Resolve";
      el.phaseNote.textContent = "Counting the damage";
      el.ready.disabled = true;
      el.ready.textContent = "…";
    }

    // Core bar.
    const coreFraction = session.coreHp / session.maxCoreHp;
    el.core.style.width = `${Math.max(0, coreFraction) * 100}%`;
    el.core.classList.toggle("is-hurt", coreFraction <= 0.6 && coreFraction > 0.28);
    el.core.classList.toggle("is-critical", coreFraction <= 0.28);
    el.coreNote.textContent = `${session.coreHp} / ${session.maxCoreHp} HP`;
  }

  return {
    update,
    log,
    banner,
    hideBanner,
    select,
    get selected() { return selected; },
    selectByIndex(index) {
      if (index >= 0 && index < BLOCK_ORDER.length) select(BLOCK_ORDER[index]);
    },
    onReady(handler) { el.ready.addEventListener("click", handler); }
  };
}
