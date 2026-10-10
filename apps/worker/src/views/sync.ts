import { prisma } from "@linkaffipro/db";
import { getViews, MtprotoAuthError, MtprotoFloodWait, MtprotoRpcError } from "@linkaffipro/mtproto";
import { logger } from "../logger";
import { loadActiveSession, type ActiveSession } from "./credentials";
import { mergeViews, nextViewsPoll, viewsInitSince } from "./schedule";

/**
 * Relevé des vues et transferts des messages de canal via le compte Telegram connecté (MTProto).
 * Un seul client à la fois (file `sync-views`, concurrence 1), un appel par canal et par passage (lots de 100 ids).
 * FLOOD_WAIT : on arrête le passage, on note l'attente (Setting `views.floodUntil`) et le passage suivant reprend.
 * Session invalide : statut ERROR (« À reconnecter »), aucune nouvelle tentative tant que l'admin n'a pas reconnecté.
 */

const FLOOD_SETTING = "views.floodUntil";
/** Messages maximum traités par passage (sécurité ; le reste attend le passage suivant). */
const MAX_POSTS_PER_PASS = 500;

type DuePost = {
  id: string;
  sentAt: Date | null;
  telegramMessageIds: unknown;
  channel: { id: string; telegramChatId: bigint; title: string };
};

export type ViewsSyncResult = {
  polled: number;
  skipped?: string;
  channels?: number;
  errors?: number;
  floodWaitSeconds?: number;
};

function messageIdsOf(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0) : [];
}

async function floodUntil(): Promise<Date | null> {
  const row = await prisma.setting.findUnique({ where: { key: FLOOD_SETTING } }).catch(() => null);
  const iso = (row?.value as { until?: string } | null)?.until;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function setFloodUntil(until: Date | null): Promise<void> {
  if (!until) {
    await prisma.setting.deleteMany({ where: { key: FLOOD_SETTING } });
    return;
  }
  await prisma.setting.upsert({
    where: { key: FLOOD_SETTING },
    create: { key: FLOOD_SETTING, value: { until: until.toISOString() } },
    update: { value: { until: until.toISOString() } },
  });
}

async function noteSession(id: string, data: { lastError?: string | null; lastUsedAt?: Date; status?: string }): Promise<void> {
  await prisma.telegramUserSession.update({ where: { id }, data }).catch(() => undefined);
}

/** Enregistre un relevé pour un message et planifie le suivant. */
async function storeSample(post: DuePost, views: number, forwards: number, now: Date): Promise<void> {
  await prisma.$transaction([
    prisma.postStats.upsert({
      where: { postId: post.id },
      create: { postId: post.id, views, forwards },
      update: { views, forwards },
    }),
    prisma.postViewSample.create({ data: { postId: post.id, at: now, views, forwards } }),
    prisma.post.update({ where: { id: post.id }, data: { viewsNextAt: nextViewsPoll(post.sentAt ?? now, now) } }),
  ]);
}

/**
 * Relève les vues d'un lot de messages d'un même canal. Retourne le nombre de messages mis à jour.
 * Les erreurs MTProto remontent à l'appelant (qui décide d'arrêter ou de continuer).
 */
async function pollChannel(active: ActiveSession, posts: DuePost[], now: Date): Promise<number> {
  const channel = posts[0]?.channel;
  if (!channel) return 0;
  const byId = new Map<number, DuePost[]>();
  for (const p of posts) for (const id of messageIdsOf(p.telegramMessageIds)) byId.set(id, [...(byId.get(id) ?? []), p]);
  const ids = [...byId.keys()];
  if (ids.length === 0) return 0;
  const rows = await getViews({ session: active.session, channelId: channel.telegramChatId, messageIds: ids }, active.creds);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  let updated = 0;
  for (const p of posts) {
    const merged = mergeViews(messageIdsOf(p.telegramMessageIds).map((id) => rowById.get(id) ?? { views: -1, forwards: -1 }));
    if (!merged) {
      // Message introuvable côté Telegram (supprimé ?) : on arrête de le relever.
      await prisma.post.update({ where: { id: p.id }, data: { viewsNextAt: null } });
      continue;
    }
    await storeSample(p, merged.views, merged.forwards, now);
    updated += 1;
  }
  return updated;
}

/** Messages dus : envoyés, non modèles, relevé planifié dans le passé, canal connu. */
async function loadDuePosts(now: Date, where: Record<string, unknown> = {}): Promise<DuePost[]> {
  return prisma.post.findMany({
    where: { status: "SENT", isTemplate: false, viewsNextAt: { lte: now }, ...where },
    select: { id: true, sentAt: true, telegramMessageIds: true, channel: { select: { id: true, telegramChatId: true, title: true } } },
    orderBy: { viewsNextAt: "asc" },
    take: MAX_POSTS_PER_PASS,
  });
}

/** Passage périodique (toutes les 15 min). */
export async function runViewsSync(): Promise<ViewsSyncResult> {
  const now = new Date();
  const { active, reason } = await loadActiveSession();
  if (!active) return { polled: 0, skipped: reason ?? "compte Telegram non connecté" };

  const wait = await floodUntil();
  if (wait && wait > now) return { polled: 0, skipped: `attente demandée par Telegram jusqu'à ${wait.toISOString()}` };

  // Initialisation : les messages envoyés depuis moins de 30 jours sans relevé planifié en reçoivent un maintenant.
  await prisma.post.updateMany({
    where: { status: "SENT", isTemplate: false, viewsNextAt: null, sentAt: { gte: viewsInitSince(now) }, NOT: { telegramMessageIds: { equals: [] } } },
    data: { viewsNextAt: now },
  });

  const due = await loadDuePosts(now);
  const byChannel = new Map<string, DuePost[]>();
  for (const p of due) byChannel.set(p.channel.id, [...(byChannel.get(p.channel.id) ?? []), p]);

  let polled = 0;
  let errors = 0;
  let lastError: string | null = null;
  for (const [channelId, posts] of byChannel) {
    try {
      polled += await pollChannel(active, posts, now);
    } catch (err) {
      if (err instanceof MtprotoFloodWait) {
        const until = new Date(now.getTime() + (err.seconds + 5) * 1000);
        await setFloodUntil(until);
        await noteSession(active.id, { lastError: `Telegram demande d'attendre ${err.seconds} s ; relevé repris automatiquement.` });
        logger.warn({ seconds: err.seconds, channelId }, "relevé des vues : FLOOD_WAIT, passage interrompu");
        return { polled, channels: byChannel.size, errors: errors + 1, floodWaitSeconds: err.seconds };
      }
      if (err instanceof MtprotoAuthError) {
        await noteSession(active.id, { status: "ERROR", lastError: err.message });
        logger.error({ code: err.code }, "relevé des vues : session Telegram invalide, compte à reconnecter");
        return { polled, channels: byChannel.size, errors: errors + 1 };
      }
      errors += 1;
      lastError = err instanceof Error ? err.message : String(err);
      const title = posts[0]?.channel.title ?? channelId;
      logger.warn({ channelId, err: lastError }, "relevé des vues : canal en erreur, on passe au suivant");
      // On replanifie les messages de ce canal pour ne pas réessayer en boucle dans la même minute.
      const next = new Date(now.getTime() + 60 * 60 * 1000);
      await prisma.post.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { viewsNextAt: next } });
      if (!(err instanceof MtprotoRpcError)) {
        // Erreur réseau ou inconnue : on arrête le passage, le suivant reprendra.
        await noteSession(active.id, { lastError: `${title} : ${lastError}` });
        return { polled, channels: byChannel.size, errors };
      }
      lastError = `${title} : ${lastError}`;
    }
  }
  await noteSession(active.id, { lastUsedAt: now, lastError });
  if (polled > 0) logger.info({ polled, channels: byChannel.size, errors }, "relevé des vues terminé");
  return { polled, channels: byChannel.size, errors };
}

/** Relevé immédiat d'un seul message (bouton de la fiche message ou test). */
export async function syncPostViews(postId: string): Promise<{ postId: string; polled: boolean; reason?: string }> {
  const now = new Date();
  const { active, reason } = await loadActiveSession();
  if (!active) return { postId, polled: false, reason: reason ?? "compte Telegram non connecté" };
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, status: true, sentAt: true, telegramMessageIds: true, channel: { select: { id: true, telegramChatId: true, title: true } } },
  });
  if (!post || post.status !== "SENT") return { postId, polled: false, reason: "message non envoyé" };
  if (messageIdsOf(post.telegramMessageIds).length === 0) return { postId, polled: false, reason: "aucun identifiant Telegram" };
  try {
    const n = await pollChannel(active, [post], now);
    await noteSession(active.id, { lastUsedAt: now, lastError: null });
    return { postId, polled: n > 0 };
  } catch (err) {
    if (err instanceof MtprotoFloodWait) {
      await setFloodUntil(new Date(now.getTime() + (err.seconds + 5) * 1000));
      await noteSession(active.id, { lastError: `Telegram demande d'attendre ${err.seconds} s ; relevé repris automatiquement.` });
      return { postId, polled: false, reason: `attente de ${err.seconds} s demandée par Telegram` };
    }
    const message = err instanceof Error ? err.message : String(err);
    await noteSession(active.id, { lastError: `${post.channel.title} : ${message}`, ...(err instanceof MtprotoAuthError ? { status: "ERROR" } : {}) });
    return { postId, polled: false, reason: message };
  }
}
