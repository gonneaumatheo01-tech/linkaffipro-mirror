/**
 * Octets d'un short pour la lecture dans le navigateur (phase 28). Un short gardé dans Telegram est récupéré par
 * `resolveAssetBytes` (chaîne Montage) avec le bot de Kevin (20 Mo au plus : pas de compte connecté côté site), puis
 * gardé quelques minutes en mémoire : un lecteur vidéo demande le fichier par morceaux (`Range`), il ne doit pas être
 * retéléchargé à chaque morceau. Mémoire bornée (3 shorts, 10 minutes).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentsDeps } from "@linkaffipro/agents";
import { buildAgentsDeps } from "./deps";
import { bytesOf, loadMontageEngine } from "./montage-engine";

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 3;
const cache = new Map<string, { bytes: Uint8Array; at: number }>();
const inflight = new Map<string, Promise<Uint8Array | "too_big" | null>>();

export function clearShortBytesCache(): void {
  cache.clear();
  inflight.clear();
}

type Fn = (...a: unknown[]) => unknown;

/** Dépendances de `resolveAssetBytes` côté site : bot de Kevin seulement, dossier temporaire propre au site. */
async function montageReadDeps(): Promise<AgentsDeps> {
  const base = buildAgentsDeps() as AgentsDeps & Record<string, unknown>;
  const agents = (await import("@linkaffipro/agents")) as unknown as Record<string, unknown>;
  const tg = (await import("@linkaffipro/telegram")) as unknown as Record<string, unknown>;
  const route = agents.createTelegramDownloader as Fn | undefined;
  const botDl = tg.createBotFileDownloader as Fn | undefined;
  const downloadTelegramFile = typeof route === "function" && typeof botDl === "function" ? route({ bot: botDl(), account: null }) : undefined;
  return { ...base, ...(downloadTelegramFile ? { downloadTelegramFile } : {}), montage: { workDir: join(tmpdir(), "montage-web") } } as AgentsDeps;
}

function isTooBig(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; description?: unknown };
  return e?.code === "too_big" || /too big|trop lourd|plus de 20 Mo/i.test(String(e?.description ?? e?.message ?? ""));
}

/** Octets du média, `"too_big"` si un bot ne peut pas le récupérer, null si la chaîne n'est pas encore livrée. */
export async function shortBytes(assetId: string, now = Date.now()): Promise<Uint8Array | "too_big" | null> {
  const hit = cache.get(assetId);
  if (hit && now - hit.at < TTL_MS) return hit.bytes;
  if (hit) cache.delete(assetId);
  const running = inflight.get(assetId);
  if (running) return running;
  const p = (async () => {
    const engine = await loadMontageEngine();
    if (!engine.resolveAssetBytes) return null;
    let raw: unknown;
    try {
      raw = await engine.resolveAssetBytes(await montageReadDeps(), assetId);
    } catch (err) {
      if (isTooBig(err)) return "too_big" as const;
      throw err;
    }
    const r = bytesOf(raw);
    if (r instanceof Uint8Array) {
      cache.set(assetId, { bytes: r, at: now });
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    }
    return r;
  })().finally(() => inflight.delete(assetId));
  inflight.set(assetId, p);
  return p;
}
