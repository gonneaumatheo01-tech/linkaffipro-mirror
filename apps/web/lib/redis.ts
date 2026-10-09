import { Redis } from "ioredis";

/** Vérifie Redis en ouvrant une connexion courte (utilisé par /api/health). */
export async function pingRedis(timeoutMs = 3000): Promise<"ok" | string> {
  const url = process.env.REDIS_URL;
  if (!url) return "REDIS_URL manquante";
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: timeoutMs, family: 0 });
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG" ? "ok" : `réponse inattendue : ${pong}`;
  } catch (err) {
    return `erreur : ${(err as Error).message}`;
  } finally {
    client.disconnect();
  }
}
