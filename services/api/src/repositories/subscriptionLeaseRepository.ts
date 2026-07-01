import { createClient, type RedisClientType } from "redis";

export interface SubscriptionLeaseRepository {
  ping(): Promise<boolean>;
  addLease(subscriptionKey: string, member: string, expiresAt: number): Promise<number>;
  refreshLeases(subscriptionKeys: string[], member: string, expiresAt: number): Promise<void>;
  removeLease(subscriptionKey: string, member: string, now: number): Promise<number>;
  sweepExpired(now: number): Promise<string[]>;
  publishControl(message: string): Promise<void>;
  disconnect(): Promise<void>;
}

export interface SubscriptionLeaseOptions {
  url: string;
  database: number;
  leasePrefix: string;
  controlChannel: string;
}

export class RedisSubscriptionLeaseRepository implements SubscriptionLeaseRepository {
  private readonly client: RedisClientType;

  constructor(private readonly options: SubscriptionLeaseOptions) {
    this.client = createClient({
      url: options.url,
      database: options.database,
    });
    this.client.on("error", (error) =>
      console.error("Redis subscription repository error", error)
    );
  }

  async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async ping() {
    return (await this.client.ping()) === "PONG";
  }

  async addLease(subscriptionKey: string, member: string, expiresAt: number) {
    const key = this.leaseKey(subscriptionKey);
    const now = Date.now();
    const results = await this.client
      .multi()
      .zRemRangeByScore(key, 0, now)
      .zAdd(key, { score: expiresAt, value: member })
      .zCard(key)
      .exec();

    return Number(results?.[2] ?? 0);
  }

  async refreshLeases(subscriptionKeys: string[], member: string, expiresAt: number) {
    if (subscriptionKeys.length === 0) {
      return;
    }

    const multi = this.client.multi();
    for (const subscriptionKey of subscriptionKeys) {
      multi.zAdd(this.leaseKey(subscriptionKey), {
        score: expiresAt,
        value: member,
      });
    }
    await multi.exec();
  }

  async removeLease(subscriptionKey: string, member: string, now: number) {
    const key = this.leaseKey(subscriptionKey);
    const results = await this.client
      .multi()
      .zRemRangeByScore(key, 0, now)
      .zRem(key, member)
      .zCard(key)
      .exec();

    return Number(results?.[2] ?? 0);
  }

  async sweepExpired(now: number) {
    const emptyKeys: string[] = [];
    let cursor = 0;

    do {
      const scanResult = await this.client.scan(cursor, {
        MATCH: `${this.options.leasePrefix}:*`,
        COUNT: 100,
      });
      cursor = Number(scanResult.cursor);

      for (const key of scanResult.keys) {
        const results = await this.client
          .multi()
          .zRemRangeByScore(key, 0, now)
          .zCard(key)
          .exec();

        const removed = Number(results?.[0] ?? 0);
        const remaining = Number(results?.[1] ?? 0);

        if (removed > 0 && remaining === 0) {
          emptyKeys.push(key.slice(this.options.leasePrefix.length + 1));
        }
      }
    } while (cursor !== 0);

    return emptyKeys;
  }

  async publishControl(message: string) {
    await this.client.publish(this.options.controlChannel, message);
  }

  async disconnect() {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private leaseKey(subscriptionKey: string) {
    return `${this.options.leasePrefix}:${subscriptionKey}`;
  }
}
