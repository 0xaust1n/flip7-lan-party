import Redis from "ioredis";
import { createInitialState, normalizeLoadedState, type InternalGameState } from "./game";

export class GameStore {
  private readonly keyPrefix = "flip7:room:";
  private readonly redis: Redis;

  constructor() {
    const redisUrl = process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
    if (!process.env.REDIS_URL) {
      console.log(`REDIS_URL 未設定，將使用預設 Redis: ${redisUrl}`);
    }

    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 100, 1000);
      },
      lazyConnect: true
    });
    this.redis.on("error", (err) => {
      console.error("Redis error:", err);
    });
  }

  async init(): Promise<void> {
    await this.redis.connect();
    await this.redis.ping();
    console.log("Redis connected.");
  }

  private key(room: string): string {
    return `${this.keyPrefix}${room}`;
  }

  async get(room: string): Promise<InternalGameState> {
    const raw = await this.redis.get(this.key(room));
    if (raw) {
      const parsed = normalizeLoadedState(JSON.parse(raw) as InternalGameState, room);
      return structuredClone(parsed);
    }

    const fresh = createInitialState(room);
    await this.set(room, fresh);
    return structuredClone(fresh);
  }

  async set(room: string, state: InternalGameState): Promise<void> {
    const normalized = normalizeLoadedState(state, room);
    const snapshot = structuredClone(normalized);
    await this.redis.set(this.key(room), JSON.stringify(snapshot));
  }

  async getAllActiveRooms(): Promise<string[]> {
    const rooms = new Set<string>();
    let cursor = "0";
    const pattern = `${this.keyPrefix}*`;

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      keys.forEach((key) => {
        if (key.startsWith(this.keyPrefix)) {
          rooms.add(key.slice(this.keyPrefix.length));
        }
      });
      cursor = nextCursor;
    } while (cursor !== "0");

    return Array.from(rooms);
  }
}
