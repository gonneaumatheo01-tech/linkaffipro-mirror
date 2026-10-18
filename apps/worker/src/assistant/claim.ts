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
         SET "turnId" = ${turnId}, "meta" = "meta" - 'turnDone'
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
    data: { turnId: null },
  });
  return r.count;
}

/** Rend TOUS les messages entrants d'un tour (tour bloqué, ou réponse pas encore permise). */
export async function releaseTurn(turnId: string): Promise<number> {
  const r = await prisma.conversationMessage.updateMany({
    where: { turnId, direction: "IN" },
    data: { turnId: null },
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
      UPDATE "ConversationMessage" SET "meta" = "meta" || '{"turnDone": true}'::jsonb
       WHERE "turnId" = ${turnId} AND "direction" = 'IN'
         AND ("meta" ->> 'crashes')::numeric::int > ${maxCrashes}`;
    const released = await tx.$executeRaw`
      UPDATE "ConversationMessage" SET "turnId" = NULL
       WHERE "turnId" = ${turnId} AND "direction" = 'IN' AND ("meta" ->> 'turnDone') IS NULL`;
    return { released, gaveUp };
  });
}

/** Fin d'un tour : ses messages entrants sont marqués traités (jamais repris par le balayage). */
export async function markTurnDone(turnId: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "ConversationMessage" SET "meta" = "meta" || '{"turnDone": true}'::jsonb
     WHERE "turnId" = ${turnId} AND "direction" = 'IN'`;
}

/** Messages entrants encore non traités de la conversation. */
export async function countUnclaimed(conversationId: string): Promise<number> {
  return prisma.conversationMessage.count({
    where: { conversationId, direction: "IN", turnId: null },
  });
}
