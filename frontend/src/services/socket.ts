// A single shared real-time connection to the backend. Any page
// that needs live updates (like the farmer dashboard's queue
// position) imports this instead of creating its own connection.

import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, "")
  : "http://localhost:4000";

export const socket: Socket = io(SOCKET_URL, {
  autoConnect: true,
});
