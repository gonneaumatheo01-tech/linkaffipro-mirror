/** Règles pures de la Médiathèque : format selon le mélange du canal, prochain média à utiliser. */

export type MediaFormat = "video" | "photo" | "text";
export type Mix = { video: number; photo: number; text: number };

/** Un média n'est jamais réutilisé sur le même canal avant 30 jours. */
export const MEDIA_REUSE_DAYS = 30;

/**
 * Format du prochain post : celui qui manque le plus par rapport au mélange voulu, compte tenu des formats des
 * derniers posts du canal (à égalité : vidéo, puis photo, puis texte).
 */
export function chooseFormat(mix: Mix, recent: readonly MediaFormat[]): MediaFormat {
  const total = mix.video + mix.photo + mix.text;
  if (total <= 0) return "text";
  const n = recent.length + 1;
  let best: { f: MediaFormat; deficit: number } | null = null;
  for (const f of ["video", "photo", "text"] as const) {
    if (mix[f] <= 0) continue;
    const want = (mix[f] / total) * n;
    const have = recent.filter((r) => r === f).length;
    const deficit = want - have;
    if (!best || deficit > best.deficit + 1e-9) best = { f, deficit };
  }
  return best?.f ?? "text";
}

export type AssetCandidate = { id: string; createdAt: Date };
export type AssetUsage = { assetId: string; channelId: string; usedAt: Date };

/**
 * Prochain média : jamais utilisé sur ce canal depuis 30 jours ; parmi eux, le moins récemment utilisé (tous canaux
 * confondus), un média jamais utilisé passant d'abord ; à égalité, le plus ancien dépôt.
 */
export function pickAsset(
  candidates: readonly AssetCandidate[],
  usages: readonly AssetUsage[],
  channelId: string,
  now: Date,
): string | null {
  const since = now.getTime() - MEDIA_REUSE_DAYS * 86_400_000;
  const blocked = new Set(usages.filter((u) => u.channelId === channelId && u.usedAt.getTime() >= since).map((u) => u.assetId));
  const lastUse = new Map<string, number>();
  for (const u of usages) lastUse.set(u.assetId, Math.max(lastUse.get(u.assetId) ?? 0, u.usedAt.getTime()));
  const ok = candidates.filter((c) => !blocked.has(c.id));
  ok.sort((a, b) => (lastUse.get(a.id) ?? 0) - (lastUse.get(b.id) ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
  return ok[0]?.id ?? null;
}
