// Why this file exists on its own:
// server.ts sets up routes → routes use controllers → controllers need
// to emit real-time events → if the Socket.IO instance lived inside
// server.ts, controllers would have to import server.ts, which imports
// the routes, which import the controllers — a circular loop that
// breaks at startup. Keeping it here lets everyone import from one
// small, neutral file instead.

import { Server as SocketIOServer } from "socket.io";
import http from "http";
import { verifyToken } from "./utils/jwt";
import { allowedOrigins } from "./utils/origins";

let io: SocketIOServer | null = null;

export function initSocket(server: http.Server): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: { origin: allowedOrigins() },
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // A farmer's browser tells us which centre's queue it cares about,
    // so we can send updates only to people actually waiting there.
    socket.on("join-centre", (centreId: string) => {
      socket.join(`centre:${centreId}`);
    });

    // Personal notifications. The browser must present its login token,
    // and we only ever join the room belonging to the user that token
    // proves — so nobody can listen in on another farmer's notifications
    // just by guessing an ID.
    socket.on("join-user", (token: string) => {
      try {
        const payload = verifyToken(token);
        socket.join(`user:${payload.userId}`);
      } catch {
        // Invalid or expired token: silently ignore, no room joined.
      }
    });

    socket.on("disconnect", () => console.log("Client disconnected:", socket.id));
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error("Socket.IO has not been initialized yet.");
  return io;
}
