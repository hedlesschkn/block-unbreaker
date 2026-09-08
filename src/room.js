import { DurableObject } from "cloudflare:workers";

/**
 * One Durable Object per game room. SQLite-backed, declared in wrangler.jsonc's
 * migrations array via `new_sqlite_classes`.
 *
 * This is a deliberate stub. The room holds the authoritative game state and every
 * player's WebSocket, but none of that exists until Phase 3. It is declared now so the
 * migration ships with the very first deploy and is never a surprise later.
 *
 * Phase 3 will add, in order:
 *   T3.2  ctx.acceptWebSocket(server)  — never server.accept()
 *         ws.serializeAttachment() / deserializeAttachment() for player identity
 *   T3.5  authoritative board state and server-side placement validation
 *   T3.6  simulateWave() run here, timeline broadcast to clients
 *   T3.7  the Alarms API phase clock — no setInterval/setTimeout, ever
 */
export class Room extends DurableObject {
  async fetch(request) {
    return Response.json(
      {
        type: "error",
        payload: {
          code: "not_implemented",
          message: "Rooms are not implemented yet. See FEATUREROADMAP_workplan.md task T3.1."
        }
      },
      { status: 501 }
    );
  }
}
