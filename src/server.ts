import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { networkInterfaces } from "node:os";
import type { ServerWebSocket } from "bun";

import {
  applyAction as applyGameAction,
  createInitialState,
  toPublicState,
  type ActionClientData,
  type ClientAction,
  type InternalGameState
} from "./game";
import { clearRoomPlayerOwnership, getRoomClients, getRoomPlayerByClient, withRoomLock } from "./rooms";
import { GameStore } from "./store";

export type WSData = ActionClientData;

export { createInitialState };

const PUBLIC_DIR = join(process.cwd(), "public");
const DEFAULT_ROOM = "main";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const store = new GameStore();

export function applyAction(state: InternalGameState, action: ClientAction, ws: ServerWebSocket<WSData>): void {
  applyGameAction(state, action, {
    actor: ws.data,
    getRoomPlayerByClient,
    clearRoomPlayerOwnership
  });
}

function sanitizeUserId(input: string | null): string {
  if (!input) return crypto.randomUUID();
  const trimmed = input.trim();
  if (!trimmed) return crypto.randomUUID();
  return trimmed.slice(0, 128);
}

async function pushState(room: string): Promise<void> {
  const state = await store.get(room);
  const validIds = new Set(state.players.map((p) => p.id));
  const ownerMap = getRoomPlayerByClient(room);
  Array.from(ownerMap.entries()).forEach(([clientId, playerId]) => {
    if (!validIds.has(playerId)) ownerMap.delete(clientId);
  });
  const clients = getRoomClients<WSData>(room);

  clients.forEach((ws) => {
    try {
      const claimedPlayerId = ownerMap.get(ws.data.clientId) || null;
      ws.data.claimedPlayerId = claimedPlayerId;
      ws.send(
        JSON.stringify({
          type: "state",
          state: toPublicState(state),
          you: {
            clientId: ws.data.clientId,
            claimedPlayerId
          }
        })
      );
    } catch {
      // Ignore failed sends.
    }
  });
}

async function sendStateToSocket(ws: ServerWebSocket<WSData>): Promise<void> {
  const state = await store.get(ws.data.room);
  const validIds = new Set(state.players.map((p) => p.id));
  const ownerMap = getRoomPlayerByClient(ws.data.room);
  Array.from(ownerMap.entries()).forEach(([clientId, playerId]) => {
    if (!validIds.has(playerId)) ownerMap.delete(clientId);
  });
  const claimedPlayerId = ownerMap.get(ws.data.clientId) || null;
  ws.data.claimedPlayerId = claimedPlayerId;
  ws.send(
    JSON.stringify({
      type: "state",
      state: toPublicState(state),
      you: {
        clientId: ws.data.clientId,
        claimedPlayerId
      }
    })
  );
}

async function handleAction(ws: ServerWebSocket<WSData>, action: ClientAction): Promise<void> {
  const room = ws.data.room;
  await withRoomLock(room, async () => {
    const state = await store.get(room);
    applyAction(state, action, ws);
    await store.set(room, state);
    await pushState(room);
  });
}

async function handleStaticRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = pathname.replace(/\.\./g, "");
  const filePath = join(PUBLIC_DIR, safePath);

  try {
    const file = await readFile(filePath);
    const contentType = MIME_TYPES[extname(filePath)] || "application/octet-stream";
    return new Response(file, {
      headers: {
        "content-type": contentType,
        "cache-control": "no-store"
      }
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

function getLanIps(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];

  Object.values(nets).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal) {
        ips.push(entry.address);
      }
    });
  });

  return ips;
}

function startServer() {
  const requestedPort = Number(process.env.PORT || 3000);
  const portsToTry = process.env.PORT
    ? [requestedPort]
    : [...Array.from({ length: 20 }, (_, i) => requestedPort + i), 0];

  for (const port of portsToTry) {
    try {
      const server = Bun.serve<WSData>({
        hostname: "0.0.0.0",
        port,
        websocket: {
          open(ws) {
            getRoomClients<WSData>(ws.data.room).add(ws);
            void sendStateToSocket(ws);
          },
          message(ws, message) {
            try {
              const parsed = JSON.parse(String(message)) as ClientAction;
              if (!parsed || parsed.type !== "action") {
                ws.send(JSON.stringify({ type: "error", message: "訊息格式錯誤。" }));
                return;
              }
              void handleAction(ws, parsed);
            } catch {
              ws.send(JSON.stringify({ type: "error", message: "JSON 格式錯誤。" }));
            }
          },
          close(ws) {
            const clients = getRoomClients<WSData>(ws.data.room);
            clients.delete(ws);
            void pushState(ws.data.room);
          }
        },
        async fetch(req, serverInstance) {
          const url = new URL(req.url);
          if (url.pathname === "/ws") {
            const room = (url.searchParams.get("room") || DEFAULT_ROOM).trim() || DEFAULT_ROOM;
            const userId = sanitizeUserId(url.searchParams.get("userId"));
            const ok = serverInstance.upgrade(req, {
              data: {
                room,
                clientId: userId,
                claimedPlayerId: null
              }
            });
            if (ok) return;
            return new Response("WebSocket upgrade failed", { status: 400 });
          }

          return handleStaticRequest(req);
        }
      });

      const urls = [`http://localhost:${server.port}`, ...getLanIps().map((ip) => `http://${ip}:${server.port}`)];
      console.log("Flip 7 multiplayer server running:");
      urls.forEach((url) => console.log(`- ${url}`));
      console.log("WebSocket endpoint: /ws?room=main");
      return server;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to find an open port.");
}

if (import.meta.main) {
  await store.init();
  startServer();
}
