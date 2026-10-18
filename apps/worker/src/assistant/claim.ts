/**
 * Réclamation des messages reçus par un tour de l'assistant (contrat §5) : anti-double réponse.
 * - Un tour (identifiant `turnId`) réclame les messages entrants non traités (`turnId` NULL) de la conversation dans une
 *   transaction qui verrouille la ligne de la conversation (`SELECT … FOR UPDATE`) : deux tours lancés en même temps ne
 *   prennent jamais les mêmes messages (le second ne trouve rien et s'arrête).
 * - Les messages arrivés pendant la préparation de la réponse sont réclamés par le même tour juste avant l'envoi.
 * - Messages rendus au tour suivant (nouvel essai après une panne de l'IA, messages arrivés trop tard) : `turnId` NULL.
 * - Fin d'un tour : ses messages sont marqués traités (`meta.turnDone`), pour que le balayage ne prenne jamais un tour
 *   terminé sans réponse (plafond, limite du jour…) pour un tour bloqué.
 * - Tour planté ou bloqué sans rien avoir envoyé : messages rendus avec un compteur `meta.crashes`, abandonnés (marqués
 *   traités) au-delà de 2 (jamais de boucle).
 * - `claimedAt` : heure de réclamation, posée par la réclamation et remise à null quand le message est rendu ou que son
 *   tour se termine ; seuls les tours en cours (ou bloqués) en ont une (index : balayage sans lecture de toute la table).
 */
import { randomBytes } from "node:crypto";
import type { ChatMedia, ChatMediaKind } from "@linkaffipro/chat";
import { prisma } from "@linkaffipro/db";

export type ClaimedInbound = {
  id: string;
  text: string;
  media: ChatMedia | null;
  createdAt: Date;
};

type ClaimedRow = { id: string; text: string; media: unknown; createdAt: Date };

const MEDIA_KINDS: readonly ChatMediaKind[] = [
  "photo",
  "sticker",
  "voice",
  "video",
  "document",
  "other",
];

/** Lecture tolérante de `ConversationMessage.media`. */
export function parseChatMedia(value: unknown): ChatMedia | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { kind?: unknown; mediaAssetId?: unknown };
  const kind = MEDIA_KINDS.includes(v.kind as ChatMediaKind) ? (v.kind as ChatMediaKind) : "other";
  return {
    kind,
    ...(typeof v.mediaAssetId === "string" ? { mediaAssetId: v.mediaAssetId } : {}),
  };
}

function toClaimed(rows: ClaimedRow[]): ClaimedInbound[] {
  return rows
    .map((r) => ({
      id: r.id,
      text: r.text ?? "",
      media: parseChatMedia(r.media),
      createdAt: new Date(r.createdAt),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

/** Identifiant d'un tour (unique, court, horodaté pour le diagnostic). */
export function newTurnId(now: Date = new Date()): string {
  return `t${now.getTime().toString(36)}${randomBytes(6).toString("hex")}`;
}

/**
 * Début d'un tour : verrouille la conversation et réclame ses messages entrants non traités. `null` : conversation
 * introuvable. Liste vide : rien à traiter (un autre tour les a déjà pris).
 */
export async function claimInbound(
  conversationId: string,
  turnId: string,
): Promise<ClaimedInbound[] | null> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    if (locked.length === 0) return null;
    const rows = await tx.$queryRaw<ClaimedRow[]>`
      UPDATE "ConversationMessage"
         SET "turnId" = ${turnId}, "meta" = "meta" - 'turnDone', "claimedAt" = now()
       WHERE "conversationId" = ${conversationId} AND "direction" = 'IN' AND "turnId" IS NULL
      RETURNING id, text, media, "createdAt"`;
    return toClaimed(rows);
  });
}

/** Messages arrivés pendant la préparation de la réponse : réclamés par le même tour (relecture avant l'envoi). */
export async function claimMoreInbound(
  conversationId: string,
  turnId: string,
): Promise<ClaimedInbound[]> {
  return claimInbound(conversationId, turnId).then((r) => r ?? []);
}

/** Rend des messages au tour suivant (`turnId` NULL), seulement s'ils appartiennent encore à ce tour. */
export async function releaseInbound(turnId: string, ids: readonly string[]): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return 0;
  const r = await prisma.conversationMessage.updateMany({
    where: { id: { in: unique }, turnId, direction: "IN" },
    data: { turnId: null, claimedAt: null },
  });
  return r.count;
}

/** Rend TOUS les messages entrants d'un tour (tour bloqué, ou réponse pas encore permise). */
export async function releaseTurn(turnId: string): Promise<number> {
  const r = await prisma.conversationMessage.updateMany({
    where: { turnId, direction: "IN" },
    data: { turnId: null, claimedAt: null },
  });
  return r.count;
}

/**
 * Tour planté sans rien envoyer (erreur de la base, worker arrêté) : ses messages entrants sont rendus au tour suivant,
 * avec un compteur `meta.crashes` ; un message qui a déjà fait planter `maxCrashes` tours est marqué traité à la place
 * (jamais de boucle sur une erreur qui se reproduit). Renvoie le nombre de messages rendus et abandonnés.
 */
export async function releaseCrashedTurn(
  turnId: string,
  maxCrashes: number,
): Promise<{ released: number; gaveUp: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "ConversationMessage"
         SET "meta" = ("meta" - 'turnDone') || jsonb_build_object(
               'crashes',
               COALESCE(CASE WHEN jsonb_typeof("meta" -> 'crashes') = 'number'
                             THEN ("meta" ->> 'crashes')::numeric::int END, 0) + 1)
       WHERE "turnId" = ${turnId} AND "direction" = 'IN'`;
    const gaveUp = await tx.$executeRaw`
      UPDATE "ConversationMessage" SET "meta" = "meta" || '{"turnDone": true}'::jsonb, "claimedAt" = NULL
       WHERE "turnId" = ${turnId} AND "direction" = 'IN'
         AND ("meta" ->> 'crashes')::numeric::int > ${maxCrashes}`;
    const released = await tx.$executeRaw`
      UPDATE "ConversationMessage" SET "turnId" = NULL, "claimedAt" = NULL
       WHERE "turnId" = ${turnId} AND "direction" = 'IN' AND ("meta" ->> 'turnDone') IS NULL`;
    return { released, gaveUp };
  });
}

/** Fin d'un tour : ses messages entrants sont marqués traités (jamais repris par le balayage). */
export async function markTurnDone(turnId: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "ConversationMessage" SET "meta" = "meta" || '{"turnDone": true}'::jsonb, "claimedAt" = NULL
     WHERE "turnId" = ${turnId} AND "direction" = 'IN'`;
}

/** Erreur gardée sur une partie de l'assistant dont l'envoi a été interrompu (worker arrêté, panne de la base). */
export const INTERRUPTED_PART_ERROR =
  "Envoi interrompu (service d'arrière-plan arrêté pendant l'envoi) : message peut-être non reçu.";

/**
 * Parties d'un tour restées « en file » (`OutboundMessage` QUEUED : le worker s'est arrêté entre leur création et la
 * réponse de Telegram) : passées en échec, texte vidé (jamais renvoyées : elles sont peut-être parties), marquées
 * `meta.interrupted` (exclues de l'historique envoyé à l'IA). Renvoie le nombre de parties parties du tour (sans les
 * parties interrompues) : seules elles comptent pour « jamais deux réponses ».
 */
export async function settleTurnParts(
  turnId: string,
): Promise<{ sent: number; interrupted: number }> {
  const queued = await prisma.conversationMessage.findMany({
    where: { turnId, direction: "OUT", outboundMessage: { is: { status: "QUEUED" } } },
    select: { id: true, outboundMessageId: true },
  });
  if (queued.length > 0) {
    const omIds = queued.map((q) => q.outboundMessageId).filter((id): id is string => Boolean(id));
    await prisma.$transaction([
      prisma.outboundMessage.updateMany({
        where: { id: { in: omIds }, status: "QUEUED" },
        data: { status: "FAILED", error: INTERRUPTED_PART_ERROR, text: "", buttons: [] },
      }),
      prisma.$executeRaw`
        UPDATE "ConversationMessage" SET "meta" = "meta" || '{"interrupted": true}'::jsonb
         WHERE id = ANY(${queued.map((q) => q.id)}::text[])`,
    ]);
  }
  // Parties refusées par Telegram : leur ligne est retirée à l'envoi ; restent les parties parties.
  const out = await prisma.conversationMessage.count({ where: { turnId, direction: "OUT" } });
  return { sent: Math.max(0, out - queued.length), interrupted: queued.length };
}

/** Messages entrants encore non traités de la conversation. */
export async function countUnclaimed(conversationId: string): Promise<number> {
  return prisma.conversationMessage.count({
    where: { conversationId, direction: "IN", turnId: null },
  });
}
