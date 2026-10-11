/**
 * Compte Telegram connecté et messages de canal avec emojis animés (phase 12, D10), côté serveur : lecture de l'état
 * relevé par le worker (`Setting` `mtproto.publishStatus`, tâche `custom-emoji` `account-status`) et demande d'un
 * nouveau relevé (bouton « Vérifier » du formulaire). Règles pures : ./publisher.ts.
 */
import { createHash } from "node:crypto";
import type { MtprotoPublishStatus } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { parsePublishStatus } from "./publisher";

export const PUBLISH_STATUS_SETTING = "mtproto.publishStatus";
/** Canaux vérifiés au plus par demande (le formulaire n'en coche jamais autant). */
export const ACCOUNT_CHECK_MAX_CHANNELS = 20;
/** Une demande identique par fenêtre de 15 s (un double clic ne lance pas deux relevés). */
const CHECK_WINDOW_MS = 15_000;

export async function loadPublishStatus(): Promise<MtprotoPublishStatus | null> {
  const row = await prisma.setting.findUnique({ where: { key: PUBLISH_STATUS_SETTING } });
  return parsePublishStatus(row?.value);
}

/**
 * Demande au worker de relever l'état du compte pour ces canaux (Premium, droit de publier). Renvoie l'heure de la
 * demande (le formulaire attend un relevé plus récent) ; lève si le service d'arrière-plan ne répond pas.
 */
export async function requestAccountCheck(
  channelIds: readonly string[],
  now: Date = new Date(),
): Promise<{ requestedAt: string; channelIds: string[] }> {
  const ids = [...new Set(channelIds.filter((id) => typeof id === "string" && id))]
    .sort()
    .slice(0, ACCOUNT_CHECK_MAX_CHANNELS);
  const known = ids.length
    ? (await prisma.channel.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(
        (c) => c.id,
      )
    : [];
  const key = createHash("sha256").update(known.join(",")).digest("hex").slice(0, 12);
  await enqueue(
    "custom-emoji",
    { type: "account-status", channelIds: known },
    { jobId: `custom-emoji:account-status:${key}:${Math.floor(now.getTime() / CHECK_WINDOW_MS)}` },
  );
  return { requestedAt: now.toISOString(), channelIds: known };
}

/**
 * Type de chaque canal (`Channel.type` : CHANNEL, ou GROUP pour un groupe ou un supergroupe), pour savoir qui publie un
 * message avec des emojis animés (`planPostVersion`). Un canal inconnu est absent (traité comme un canal).
 */
export async function loadChatTypes(channelIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(channelIds.filter((id) => typeof id === "string" && id))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.channel.findMany({
    where: { id: { in: ids } },
    select: { id: true, type: true },
  });
  return new Map(rows.filter((r) => r.type).map((r) => [r.id, String(r.type)]));
}
