import type { ServerWebSocket } from "bun";

export type WSDataLike = {
  room: string;
  clientId: string;
  claimedPlayerId: string | null;
};

const roomLocks = new Map<string, Promise<void>>();
const roomClients = new Map<string, Set<ServerWebSocket<WSDataLike>>>();
const roomPlayerByClient = new Map<string, Map<string, string>>();

export function withRoomLock<T>(room: string, task: () => Promise<T>): Promise<T> {
  const previous = roomLocks.get(room) || Promise.resolve();

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const run = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      release();
    });

  roomLocks.set(room, gate);
  return run;
}

export function getRoomClients<T extends WSDataLike = WSDataLike>(room: string): Set<ServerWebSocket<T>> {
  if (!roomClients.has(room)) {
    roomClients.set(room, new Set());
  }
  return roomClients.get(room)! as Set<ServerWebSocket<T>>;
}

export function getRoomPlayerByClient(room: string): Map<string, string> {
  if (!roomPlayerByClient.has(room)) {
    roomPlayerByClient.set(room, new Map());
  }
  return roomPlayerByClient.get(room)!;
}

export function clearRoomPlayerOwnership(room: string): void {
  getRoomPlayerByClient(room).clear();
  const clients = getRoomClients(room);
  clients.forEach((socket) => {
    socket.data.claimedPlayerId = null;
  });
}
