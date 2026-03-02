import Redis from "ioredis";
import { createInitialState, normalizeLoadedState, type InternalGameState } from "./game";

export class GameStore {
  private readonly keyPrefix = "flip7:room:";
  private readonly memory = new Map<string, InternalGameState>();
  private redis: Redis | null = null;

  constructor() {
    const redisUrlRaw = process.env.REDIS_URL;
    if (!redisUrlRaw) {
      console.log("REDIS_URL 未設定，將使用記憶體模式。");
      this.redis = null;
      return;
    }

    try {
      this.redis = new Redis(redisUrlRaw, {
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 100, 1000);
        }
      });
      this.redis.on("error", (err) => {
        console.error("Redis error:", err);
      });
    } catch (err) {
      console.log("REDIS_URL 格式錯誤，將使用記憶體模式。", err);
      this.redis = null;
    }
  }

  async init(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.ping();
      console.log("Redis connected.");
    } catch (err) {
      this.redis = null;
      console.log("Redis unavailable, using in-memory state.", err);
    }
  }

  private key(room: string): string {
    return `${this.keyPrefix}${room}`;
  }

  async get(room: string): Promise<InternalGameState> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(this.key(room));
        if (raw) {
          const parsed = normalizeLoadedState(JSON.parse(raw) as InternalGameState, room);
          this.memory.set(room, parsed);
          return structuredClone(parsed);
        }
      } catch (err) {
        console.error("Redis read failed:", err);
      }
    }

    const cached = this.memory.get(room);
    if (cached) {
      normalizeLoadedState(cached, room);
      return structuredClone(cached);
    }

    const fresh = createInitialState(room);
    this.memory.set(room, fresh);
    return structuredClone(fresh);
  }

  async set(room: string, state: InternalGameState): Promise<void> {
    const normalized = normalizeLoadedState(state, room);
    const snapshot = structuredClone(normalized);
    this.memory.set(room, snapshot);

    if (this.redis) {
      try {
        await this.redis.set(this.key(room), JSON.stringify(snapshot));
      } catch (err) {
        console.error("Redis write failed:", err);
      }
    }
  }

  async getAllActiveRooms(): Promise<string[]> {
    // In memory only for now or SCAN in redis
    return Array.from(this.memory.keys());
  }
}
