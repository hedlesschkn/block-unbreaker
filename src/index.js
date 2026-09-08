import { Room } from "./room.js";

export { Room };

/** Room codes are 4-6 characters, uppercase, no ambiguous glyphs (see T3.3). */
const ROOM_CODE = /^[A-Z0-9]{4,6}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /ws/:roomCode — the only path routed to this Worker (see run_worker_first).
    if (url.pathname.startsWith("/ws/")) {
      const roomCode = url.pathname.slice(4).toUpperCase();

      if (!ROOM_CODE.test(roomCode)) {
        return Response.json(
          {
            type: "error",
            payload: {
              code: "bad_room_code",
              message: "Room codes are 4-6 letters or digits."
            }
          },
          { status: 400 }
        );
      }

      // One Durable Object per room code. Same code anywhere in the world,
      // same object.
      return env.ROOM.getByName(roomCode).fetch(request);
    }

    // Everything else is a static asset. Normally handled before this Worker
    // is invoked at all; this is the safety net.
    return env.ASSETS.fetch(request);
  }
};
