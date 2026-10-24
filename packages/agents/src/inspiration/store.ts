/**
 * Phase 27 (chantier A, lecture) — rangement des posts lus d'un canal de référence : une ligne par (référence, numéro),
 * mise à jour sans doublon (une relecture ou une reprise ne crée rien en double). Le texte est gardé 30 jours
 * (`purgeReferenceTexts`), un texte déjà effacé n'est jamais réécrit ; aucun média n'est gardé. Met à jour le nombre
 * de posts, la date de lecture et l'état de la référence.
 */
import type { AgentsDeps } from "../types";
import { INSPIRATION_LIMITS, type InspirationUniverse, type ReferencePostInput, type ReferenceViaName } from "./contract";
import { postFeatures } from "./features";

export type StoreResult = { created: number; updated: number; postCount: number };

export function isInspirationUniverse(v: unknown): v is InspirationUniverse {
  return v === "dating" || v === "casino" || v === "sports";
}

/** Range les posts (création ou mise à jour), puis met la référence à jour (READY, nombre de posts, lecture). */
export async function storeReferencePosts(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  referenceChannelId: string,
  posts: readonly ReferencePostInput[],
  via: ReferenceViaName,
  opts: { title?: string | null; username?: string | null; chatId?: bigint | null; markReady?: boolean } = {},
): Promise<StoreResult> {
  const now = deps.now?.() ?? new Date();
  const ref = await deps.prisma.referenceChannel.findUnique({ where: { id: referenceChannelId }, select: { id: true, universe: true } });
  if (!ref) throw new Error("Référence introuvable");
  const universe: InspirationUniverse = isInspirationUniverse(ref.universe) ? ref.universe : "dating";
  let created = 0;
  let updated = 0;
  const seen = new Set<number>();
  for (const p of posts) {
    if (seen.has(p.externalId)) continue;
    seen.add(p.externalId);
    const c = postFeatures(p, universe);
    const where = { referenceChannelId_externalId: { referenceChannelId, externalId: p.externalId } };
    const existing = await deps.prisma.referencePost.findUnique({ where, select: { id: true, textPurgedAt: true } });
    const columns = {
      postedAt: c.postedAt,
      via,
      textHash: c.textHash,
      shingles: c.shingles,
      length: c.length,
      lines: c.lines,
      emojiCount: c.emojiCount,
      mediaKind: c.mediaKind,
      views: c.views,
      hasLink: c.hasLink,
      hasButton: c.hasButton,
      hasPrice: c.hasPrice,
      hasOdds: c.hasOdds,
      hasVipCall: c.hasVipCall,
      keywords: c.keywords,
      features: c.features,
    };
    if (existing) {
      await deps.prisma.referencePost.update({
        where: { id: existing.id },
        // Texte effacé (30 jours) : il ne revient jamais ; les vues, elles, se mettent à jour.
        data: { ...columns, ...(existing.textPurgedAt ? {} : { text: c.text }) },
      });
      updated++;
    } else {
      await deps.prisma.referencePost.create({ data: { referenceChannelId, externalId: p.externalId, text: c.text, ...columns } });
      created++;
    }
  }
  const postCount = await deps.prisma.referencePost.count({ where: { referenceChannelId } });
  await deps.prisma.referenceChannel.update({
    where: { id: referenceChannelId },
    data: {
      postCount,
      lastReadAt: now,
      ...(opts.markReady === false ? {} : { status: "READY", unavailableReason: null }),
      ...(opts.title ? { title: opts.title.slice(0, 200) } : {}),
      ...(opts.username ? { username: opts.username } : {}),
      ...(opts.chatId !== undefined && opts.chatId !== null ? { telegramChatId: opts.chatId } : {}),
    },
  });
  return { created, updated, postCount };
}

/**
 * Efface le texte brut des posts de référence rangés depuis plus de 30 jours (`createdAt`) et date l'effacement ; les
 * empreintes (`textHash`, `shingles`) restent pour le contrôle « jamais de copie ». Branchée dans la purge nocturne.
 */
export async function purgeReferenceTexts(deps: Pick<AgentsDeps, "prisma">, now: Date = new Date()): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - INSPIRATION_LIMITS.textRetentionDays * 86_400_000);
  const r = await deps.prisma.referencePost.updateMany({
    where: { textPurgedAt: null, createdAt: { lt: cutoff } },
    data: { text: null, textPurgedAt: now },
  });
  return { purged: r.count };
}
