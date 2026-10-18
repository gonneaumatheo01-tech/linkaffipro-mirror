import { prisma, recordEvent } from "@linkaffipro/db";
import { choosePrimaryBot } from "@linkaffipro/telegram";

/**
 * Passage d'un bot en assistant de conversation (phase 17) : il ne publie plus rien dans les canaux. Ses rôles sont
 * repris par un bot normal administrateur du même canal :
 * - bot principal d'un canal → remplacé (même choix que pour un canal nouveau : même univers, sinon le plus ancien
 *   administrateur), ou laissé vide s'il n'y en a aucun (rempli dès qu'un bot normal devient administrateur) ;
 * - messages de canal pas encore publiés (brouillons, programmés, annulés, échoués : ces deux derniers restent
 *   modifiables et reprogrammables) → publiés par le bot qui le remplace. Un brouillon ou un message programmé que
 *   personne d'autre ne peut publier bloque le changement de mode (sauf ceux publiés par le compte Telegram connecté,
 *   qui n'ont pas besoin du bot, et les modèles, jamais publiés tels quels). Un message annulé ou échoué ne bloque
 *   rien : il garde son bot, et sa reprogrammation choisit un bot normal (ou est refusée s'il n'y en a aucun).
 */

/** Messages repris : tout ce qui n'est pas (encore) publié et reste modifiable. */
export const HANDOVER_POST_STATUSES = ["DRAFT", "SCHEDULED", "FAILED", "CANCELLED"] as const;
/** Messages qui bloquent le changement de mode s'ils n'ont aucun autre bot pour les publier. */
const BLOCKING_POST_STATUSES: readonly string[] = ["DRAFT", "SCHEDULED"];

export type HandoverChannel = {
  id: string;
  title: string | null;
  vertical: string | null;
  primaryBotId: string | null;
  /** Bots administrateurs actifs (non retirés), du plus ancien au plus récent. */
  admins: Array<{ id: string; vertical: string; mode: string }>;
};

export type HandoverPost = {
  id: string;
  channelId: string;
  status: string;
  publisher: "BOT" | "ACCOUNT";
  isTemplate: boolean;
};

export type HandoverPlan = {
  /** Canaux dont ce bot était le bot principal : nouveau bot principal (null : aucun bot normal administrateur). */
  primaries: Array<{ channelId: string; botId: string | null }>;
  /** Messages pas encore publiés (brouillons, programmés, annulés, échoués) repris par un autre bot. */
  posts: Array<{ postId: string; botId: string }>;
  /** Brouillons et messages programmés que personne d'autre ne peut publier (le changement de mode est refusé). */
  stuck: Array<{ postId: string; channelId: string; channelTitle: string | null }>;
};

/** Plan de reprise (pur) : qui remplace `botId` dans chaque canal concerné. */
export function planAssistantHandover(
  botId: string,
  channels: HandoverChannel[],
  posts: HandoverPost[],
): HandoverPlan {
  const replacement = new Map<string, string | null>();
  for (const ch of channels) {
    const others = ch.admins.filter((a) => a.id !== botId && a.mode === "STANDARD");
    // Un autre bot principal déjà choisi (et administrateur) reste ; sinon même choix que pour un canal nouveau.
    const kept =
      ch.primaryBotId && ch.primaryBotId !== botId && others.some((a) => a.id === ch.primaryBotId)
        ? ch.primaryBotId
        : null;
    replacement.set(
      ch.id,
      kept ??
        choosePrimaryBot({ channelVertical: ch.vertical, detector: null, admins: others })?.botId ??
        null,
    );
  }
  const plan: HandoverPlan = { primaries: [], posts: [], stuck: [] };
  for (const ch of channels)
    if (ch.primaryBotId === botId)
      plan.primaries.push({ channelId: ch.id, botId: replacement.get(ch.id) ?? null });
  for (const p of posts) {
    const next = replacement.get(p.channelId) ?? null;
    if (next) plan.posts.push({ postId: p.id, botId: next });
    else if (p.publisher === "BOT" && !p.isTemplate && BLOCKING_POST_STATUSES.includes(p.status))
      plan.stuck.push({
        postId: p.id,
        channelId: p.channelId,
        channelTitle: channels.find((c) => c.id === p.channelId)?.title ?? null,
      });
  }
  return plan;
}

/** Lit ce qu'il faut reprendre pour `botId` (canaux dont il est le bot principal, messages pas encore publiés). */
export async function loadAssistantHandover(botId: string): Promise<HandoverPlan> {
  const posts = await prisma.post.findMany({
    where: { botId, status: { in: [...HANDOVER_POST_STATUSES] } },
    select: { id: true, channelId: true, status: true, publisher: true, isTemplate: true },
  });
  const channelIds = [...new Set(posts.map((p) => p.channelId))];
  const channels = await prisma.channel.findMany({
    where: { OR: [{ primaryBotId: botId }, { id: { in: channelIds } }] },
    select: {
      id: true,
      title: true,
      vertical: true,
      primaryBotId: true,
      botAdmins: {
        where: { revokedAt: null, bot: { isActive: true } },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        select: { bot: { select: { id: true, vertical: true, mode: true } } },
      },
    },
  });
  return planAssistantHandover(
    botId,
    channels.map((c) => ({
      id: c.id,
      title: c.title,
      vertical: c.vertical,
      primaryBotId: c.primaryBotId,
      admins: c.botAdmins.map((a) => a.bot),
    })),
    posts,
  );
}

/**
 * Applique la reprise (seulement si rien n'a changé entre-temps) ; renvoie ce qui a été fait : bots principaux
 * remplacés, canaux laissés sans bot principal, messages repris.
 */
export async function applyAssistantHandover(
  botId: string,
  plan: HandoverPlan,
): Promise<{ replaced: number; emptied: number; posts: number }> {
  const done = await prisma.$transaction(async (tx) => {
    const primaries: Array<{ channelId: string; botId: string | null }> = [];
    for (const p of plan.primaries) {
      const { count } = await tx.channel.updateMany({
        where: { id: p.channelId, primaryBotId: botId },
        data: { primaryBotId: p.botId },
      });
      if (count > 0) primaries.push(p);
    }
    let posts = 0;
    for (const p of plan.posts) {
      const { count } = await tx.post.updateMany({
        where: { id: p.postId, botId, status: { in: [...HANDOVER_POST_STATUSES] } },
        data: { botId: p.botId },
      });
      posts += count;
    }
    return { primaries, posts };
  });
  for (const p of done.primaries)
    if (p.botId)
      await recordEvent({
        type: "channel.primary_bot_set",
        channelId: p.channelId,
        botId: p.botId,
        payload: { reason: "assistant_mode", previousBotId: botId },
      });
  return {
    replaced: done.primaries.filter((p) => p.botId).length,
    emptied: done.primaries.filter((p) => !p.botId).length,
    posts: done.posts,
  };
}
