// Scaffold only (T1.1). Confirms that /ws/:roomCode reaches the Worker and is
// routed to the Room Durable Object, rather than being swallowed by the SPA
// not-found fallback. The Room is a stub until T3.1, so a 501 carrying
// {"code":"not_implemented"} is exactly the success case here.

const row = document.getElementById("ws-check");
const button = document.getElementById("probe");
const icon = row.querySelector("span");

function report(cls, glyph, note) {
  icon.className = cls;
  icon.textContent = glyph;
  row.querySelector(".note")?.remove();
  const el = document.createElement("span");
  el.className = "note";
  el.textContent = ` — ${note}`;
  el.style.color = "var(--dim)";
  row.appendChild(el);
}

button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "checking…";
  try {
    const res = await fetch("/ws/T1TEST");
    const body = await res.json();
    if (res.status === 501 && body?.payload?.code === "not_implemented") {
      report("ok", "✓", "Worker reached, routed to Room DO (stub)");
    } else {
      report("fail", "✗", `unexpected ${res.status} ${JSON.stringify(body)}`);
    }
  } catch (err) {
    report("fail", "✗", `request failed: ${err.message}`);
  }
  button.remove();
});
