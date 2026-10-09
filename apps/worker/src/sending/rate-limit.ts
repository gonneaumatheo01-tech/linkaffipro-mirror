import type { Redis } from "ioredis";

/**
 * Limiteur de débit à fenêtre fixe sur Redis : `max` opérations par `windowMs` pour une clé.
 * Si la fenêtre est pleine, attend sa fin puis réessaie. Partagé entre tous les processus du worker.
 */
export class RateLimiter {
  constructor(
    private readonly redis: Pick<Redis, "incr" | "pexpire" | "pttl">,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async acquire(key: string, max: number, windowMs: number): Promise<void> {
    for (;;) {
      const k = `lap:rl:${key}`;
      const n = await this.redis.incr(k);
      if (n === 1) await this.redis.pexpire(k, windowMs);
      if (n <= max) return;
      const ttl = await this.redis.pttl(k);
      await this.sleep(ttl > 0 ? ttl + 5 : windowMs);
    }
  }

  /** Limites Telegram : 25 msg/s par bot, 1 msg/s par chat privé, 20 msg/min par canal. */
  async forBot(botId: string) {
    await this.acquire(`bot:${botId}`, 25, 1000);
  }
  async forPrivateChat(chatId: string | number | bigint) {
    await this.acquire(`chat:${chatId}`, 1, 1000);
  }
  async forChannel(chatId: string | number | bigint) {
    await this.acquire(`channel:${chatId}`, 20, 60_000);
  }
}
