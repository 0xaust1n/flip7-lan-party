import { createConnection } from "node:net";

import { createInitialState, normalizeLoadedState, type InternalGameState } from "./game";

type ParsedResp = { value: unknown; next: number } | null;

function readLine(buffer: Buffer, start: number): { line: string; next: number } | null {
  const end = buffer.indexOf("\r\n", start, "utf8");
  if (end === -1) return null;
  return {
    line: buffer.toString("utf8", start, end),
    next: end + 2
  };
}

function parseResp(buffer: Buffer, offset = 0): ParsedResp {
  if (offset >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[offset]);

  if (prefix === "+" || prefix === "-" || prefix === ":") {
    const line = readLine(buffer, offset + 1);
    if (!line) return null;
    if (prefix === "+") return { value: line.line, next: line.next };
    if (prefix === "-") return { value: { redisError: line.line }, next: line.next };
    return { value: Number(line.line), next: line.next };
  }

  if (prefix === "$") {
    const lenLine = readLine(buffer, offset + 1);
    if (!lenLine) return null;
    const length = Number(lenLine.line);
    if (Number.isNaN(length)) throw new Error("Invalid bulk length.");
    if (length === -1) return { value: null, next: lenLine.next };

    const dataStart = lenLine.next;
    const dataEnd = dataStart + length;
    if (buffer.length < dataEnd + 2) return null;
    const value = buffer.toString("utf8", dataStart, dataEnd);
    return { value, next: dataEnd + 2 };
  }

  if (prefix === "*") {
    const lenLine = readLine(buffer, offset + 1);
    if (!lenLine) return null;
    const count = Number(lenLine.line);
    if (Number.isNaN(count)) throw new Error("Invalid array length.");
    if (count === -1) return { value: null, next: lenLine.next };

    const values: unknown[] = [];
    let cursor = lenLine.next;
    for (let i = 0; i < count; i += 1) {
      const parsed = parseResp(buffer, cursor);
      if (!parsed) return null;
      values.push(parsed.value);
      cursor = parsed.next;
    }
    return { value: values, next: cursor };
  }

  throw new Error(`Unsupported RESP prefix: ${prefix}`);
}

function encodeCommand(args: string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const byteLen = Buffer.byteLength(arg, "utf8");
    out += `$${byteLen}\r\n${arg}\r\n`;
  }
  return out;
}

class RedisClientLite {
  private readonly host: string;
  private readonly port: number;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  async command(args: string[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Redis command timeout."));
      }, 1500);

      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          const parsed = parseResp(buffer, 0);
          if (!parsed) return;

          clearTimeout(timeout);
          socket.end();
          if (
            parsed.value &&
            typeof parsed.value === "object" &&
            "redisError" in (parsed.value as Record<string, unknown>)
          ) {
            reject(new Error(String((parsed.value as { redisError: unknown }).redisError)));
            return;
          }
          resolve(parsed.value);
        } catch (error) {
          clearTimeout(timeout);
          socket.destroy();
          reject(error);
        }
      });

      socket.on("connect", () => {
        socket.write(encodeCommand(args));
      });
    });
  }
}

export class GameStore {
  private readonly keyPrefix = "flip7:room:";
  private readonly memory = new Map<string, InternalGameState>();
  private redis: RedisClientLite | null = null;

  constructor() {
    const redisUrlRaw = process.env.REDIS_URL;
    if (!redisUrlRaw) {
      console.log("REDIS_URL 未設定，將使用記憶體模式。");
      this.redis = null;
      return;
    }

    try {
      const redisUrl = new URL(redisUrlRaw);
      const host = redisUrl.hostname;
      const port = Number(redisUrl.port || 6379);
      this.redis = new RedisClientLite(host, port);
    } catch {
      console.log("REDIS_URL 格式錯誤，將使用記憶體模式。");
      this.redis = null;
    }
  }

  async init(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.command(["PING"]);
      console.log("Redis connected.");
    } catch {
      this.redis = null;
      console.log("Redis unavailable, using in-memory state.");
    }
  }

  private key(room: string): string {
    return `${this.keyPrefix}${room}`;
  }

  async get(room: string): Promise<InternalGameState> {
    if (this.redis) {
      try {
        const raw = await this.redis.command(["GET", this.key(room)]);
        if (typeof raw === "string") {
          const parsed = normalizeLoadedState(JSON.parse(raw) as InternalGameState, room);
          this.memory.set(room, parsed);
          return structuredClone(parsed);
        }
      } catch {
        this.redis = null;
        console.log("Redis read failed, switched to in-memory state.");
      }
    }

    const cached = this.memory.get(room);
    if (cached) {
      const normalized = normalizeLoadedState(structuredClone(cached), room);
      this.memory.set(room, normalized);
      return structuredClone(normalized);
    }

    const fresh = createInitialState(room);
    this.memory.set(room, fresh);
    return structuredClone(fresh);
  }

  async set(room: string, state: InternalGameState): Promise<void> {
    const normalized = normalizeLoadedState(structuredClone(state), room);
    this.memory.set(room, normalized);

    if (!this.redis) return;
    try {
      await this.redis.command(["SET", this.key(room), JSON.stringify(normalized)]);
    } catch {
      this.redis = null;
      console.log("Redis write failed, switched to in-memory state.");
    }
  }
}
