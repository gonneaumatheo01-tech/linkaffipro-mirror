import { Redis } from "ioredis";

/**
 * Exécute `fn` sur une connexion Redis courte (ouverte puis fermée), avec délai maximal : utilisé par
 * `/api/health` et la page État pour ne jamais bloquer si Redis est injoignable.
 */
export async function withRedis<T>(fn: (client: Redis) => Promise<T>, timeoutMs = 3000): Promise<T> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL manquante");
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: timeoutMs, family: 0 });
  let timer: NodeJS.Timeout | undefined;
  try {
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Redis ne répond pas (${timeoutMs} ms)`)), timeoutMs);
    });
    await Promise.race([client.connect(), guard]);
    return await Promise.race([fn(client), guard]);
  } finally {
    if (timer) clearTimeout(timer);
    client.disconnect();
  }
}

/** Vérifie Redis en ouvrant une connexion courte (utilisé par /api/health). */
export async function pingRedis(timeoutMs = 3000): Promise<"ok" | string> {
  try {
    const pong = await withRedis((c) => c.ping(), timeoutMs);
    return pong === "PONG" ? "ok" : `réponse inattendue : ${pong}`;
  } catch (err) {
    return `erreur : ${(err as Error).message}`;
  }
}
