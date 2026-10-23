/**
 * Choix d'un média casino (règle pure) : seulement des médias fournis par le client (`origin = HUMAN`) du bon type et
 * du bon thème ; jamais republié sur le même canal avant la durée de rotation (30 jours) ; jamais le même jour (de
 * Paris) sur un autre canal ; parmi les restants, le moins récemment utilisé (un média jamais utilisé d'abord), puis le
 * plus ancien dépôt.
 */
import { parisDay } from "../rules/time";
import { assetHasTheme } from "./rotation";

export type CasinoAsset = { id: string; createdAt: Date; mimeType: string; origin: string | null; theme: string | null; tags: unknown };
export type CasinoUsage = { assetId: string; channelId: string; usedAt: Date };
export type CasinoMediaKind = "video" | "photo";

const DAY = 86_400_000;

export function isKind(asset: Pick<CasinoAsset, "mimeType">, kind: CasinoMediaKind): boolean {
  return asset.mimeType.startsWith(kind === "video" ? "video/" : "image/");
}

/** Médias bloqués pour ce canal maintenant : utilisés ici dans la rotation, ou ailleurs aujourd'hui. */
export function blockedAssets(usages: readonly CasinoUsage[], channelId: string, now: Date, rotationDays: number): Set<string> {
  const since = now.getTime() - rotationDays * DAY;
  const today = parisDay(now);
  const out = new Set<string>();
  for (const u of usages) {
    if (u.channelId === channelId && u.usedAt.getTime() >= since) out.add(u.assetId);
    else if (u.channelId !== channelId && parisDay(u.usedAt) === today) out.add(u.assetId);
  }
  return out;
}

export function pickCasinoAsset(
  candidates: readonly CasinoAsset[],
  usages: readonly CasinoUsage[],
  o: { channelId: string; now: Date; rotationDays: number; theme: string; kind: CasinoMediaKind },
): string | null {
  const blocked = blockedAssets(usages, o.channelId, o.now, o.rotationDays);
  const lastUse = new Map<string, number>();
  for (const u of usages) lastUse.set(u.assetId, Math.max(lastUse.get(u.assetId) ?? 0, u.usedAt.getTime()));
  const ok = candidates.filter((c) => c.origin === "HUMAN" && isKind(c, o.kind) && assetHasTheme(c, o.theme) && !blocked.has(c.id));
  ok.sort((a, b) => (lastUse.get(a.id) ?? 0) - (lastUse.get(b.id) ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
  return ok[0]?.id ?? null;
}

/** Vidéos fournies d'un thème non utilisées sur ce canal depuis la durée de rotation (stock). */
export function unusedCount(
  candidates: readonly CasinoAsset[],
  usages: readonly CasinoUsage[],
  o: { channelId: string; now: Date; rotationDays: number; theme: string; kind?: CasinoMediaKind },
): number {
  const since = o.now.getTime() - o.rotationDays * DAY;
  const used = new Set(usages.filter((u) => u.channelId === o.channelId && u.usedAt.getTime() >= since).map((u) => u.assetId));
  return candidates.filter((c) => c.origin === "HUMAN" && isKind(c, o.kind ?? "video") && assetHasTheme(c, o.theme) && !used.has(c.id)).length;
}

export function stockState(unused: number, lowStock: number): "ok" | "low" | "empty" {
  return unused <= 0 ? "empty" : unused < lowStock ? "low" : "ok";
}
