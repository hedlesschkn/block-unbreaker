/**
 * Screen switching and app wiring. No router — three sections, one visible at a time.
 */

import { WAVES, ECONOMY } from "./engine/constants.js";
import { createGameScreen } from "./screens/game.js";
import { STATUS } from "./game/session.js";

const screens = {
  title: document.getElementById("screen-title"),
  game: document.getElementById("screen-game"),
  results: document.getElementById("screen-results")
};

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.classList.toggle("is-active", key === name);
}

/** A fresh seed per run, so no two solo runs are identical. */
function newSeed() {
  return `SOLO-${Math.floor(Math.random() * 0xffffffff).toString(36).toUpperCase()}`;
}

const game = createGameScreen(screens.game, { onFinished: showResults });

function startRun() {
  show("game");
  // start() measures the canvas itself via getBoundingClientRect, which forces the
  // layout it needs. Deferring to requestAnimationFrame would be fragile: rAF does not
  // fire in a hidden document, so the run would never begin at all.
  game.start(newSeed());
}

function showResults(summary) {
  game.stop();

  const won = summary.status === STATUS.WON;
  const verdict = document.getElementById("results-verdict");
  verdict.textContent = won ? "Core Held" : "Core Destroyed";
  verdict.classList.toggle("is-win", won);

  document.getElementById("results-sub").textContent = won
    ? `You survived all ${WAVES.WIN_WAVE} waves.`
    : `The Core fell on wave ${summary.wavesAttempted}.`;

  const rows = [
    ["Waves survived", summary.wavesSurvived, true],
    ["Gutter kills", summary.gutterKills, false],
    ["Absorbed / bombed", summary.absorbKills, false],
    ["Shards remaining", summary.shards, false],
    ["Core remaining", `${summary.coreHp} / ${summary.maxCoreHp}`, false]
  ];

  const stats = document.getElementById("results-stats");
  stats.innerHTML = "";
  for (const [label, value, headline] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (headline) dd.className = "is-headline";
    stats.append(dt, dd);
  }

  show("results");
}

document.getElementById("btn-play").addEventListener("click", startRun);
document.getElementById("btn-again").addEventListener("click", startRun);
document.getElementById("btn-menu").addEventListener("click", () => show("title"));
