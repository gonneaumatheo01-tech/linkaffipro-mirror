/**
 * Phase 28, chantier E — ce que Kevin attend dans une conversation pour le montage (`Setting`
 * `montage.kevin.<chatId>`), une seule chose à la fois, la plus récente gagne :
 * - `video` : une vidéo reçue sans demande de montage (question « montage ou médiathèque ? » posée ou non) ; la
 *   phrase qui suit (« découpe ça en shorts de 15 s ») la prend ;
 * - `phrase` : une demande de montage arrivée AVANT la vidéo (Telegram envoie le commentaire avant le fichier) ;
 * - `plan` : plan de coupe envoyé, réponse attendue (« ok », « enlève le 3 ») ;
 * - `edit` : « ✏️ Modifier » appuyé sur un aperçu, Kevin attend ce qu'il faut changer ;
 * - `subtitle` : « autre » appuyé sur un doute de sous-titre, Kevin attend le bon texte ;
 * - `destination` : tous les shorts tranchés, Kevin attend où les envoyer ;
 * - `previews` : des aperçus attendent une réponse (« ok », « ok sauf le 3 »).
 * Plus la liste des vidéos reçues (30 min) : une phrase envoyée juste après une vidéo transférée la retrouve.
 */
import { nowOf, readSetting, writeSetting } from "../admin/journal";
import type { AgentsDeps } from "../types";

export const MONTAGE_KEVIN_SETTING_PREFIX = "montage.kevin.";

/** Vidéo reçue par Kevin (identifiants Telegram et métadonnées : rien n'est téléchargé dans le webhook). */
export type ReceivedVideo = {
  messageId: number;
  fileId: string;
  fileUniqueId: string;
  sizeBytes: number | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  mimeType: string;
  fileName: string | null;
  /** Bot qui a reçu le message (ses `fileId` ne valent que pour lui). */
  botId: string | null;
  forwarded: boolean;
  receivedAt: string;
  /** Montage déjà lancé avec cette vidéo. */
  jobId?: string | null;
  /** Rangée dans la médiathèque (choix « médiathèque »). */
  assetId?: string | null;
};

export type MontageAwait =
  | { kind: "video"; video: ReceivedVideo; asked: boolean; at: string; messageIds?: number[] }
  | { kind: "phrase"; text: string; messageId: number; at: string; messageIds?: number[] }
  | { kind: "plan"; jobId: string; at: string; messageIds?: number[] }
  | { kind: "edit"; clipId: string; jobId: string; at: string; messageIds?: number[] }
  | { kind: "subtitle"; clipId: string; jobId: string; index: number; atMs: number; at: string; messageIds?: number[] }
  | { kind: "destination"; jobId: string; at: string; messageIds?: number[] }
  /** Aperçus envoyés : « ok », « ok sauf le 3 », « le 5, raccourcis de 2 secondes ». */
  | { kind: "previews"; jobId: string; at: string; messageIds?: number[] };

export type MontageKevinState = { await?: MontageAwait | null; videos?: ReceivedVideo[] };

/**
 * Durées de vie : une vidéo 30 min, une phrase 2 min ; un plan 48 h ; une modification ou un doute 6 h ; des aperçus ou
 * une destination 24 h (au-delà, « ok » ne vaut plus validation).
 */
export const MONTAGE_AWAIT_TTL_MS: Record<MontageAwait["kind"], number> = {
  video: 30 * 60_000,
  phrase: 2 * 60_000,
  plan: 48 * 3600_000,
  edit: 6 * 3600_000,
  subtitle: 6 * 3600_000,
  destination: 24 * 3600_000,
  previews: 24 * 3600_000,
};
export const RECEIVED_VIDEO_TTL_MS = 30 * 60_000;

export function montageStateKey(chatId: string | bigint | number): string {
  return `${MONTAGE_KEVIN_SETTING_PREFIX}${String(chatId)}`;
}

function alive(a: MontageAwait | null | undefined, now: Date): MontageAwait | null {
  if (!a || typeof a !== "object" || typeof a.at !== "string" || !(a.kind in MONTAGE_AWAIT_TTL_MS)) return null;
  return now.getTime() - new Date(a.at).getTime() <= MONTAGE_AWAIT_TTL_MS[a.kind] ? a : null;
}

export async function readMontageState(deps: Pick<AgentsDeps, "prisma" | "now">, chatId: string | bigint | number): Promise<MontageKevinState> {
  const raw = (await readSetting(deps, montageStateKey(chatId))) as MontageKevinState | undefined;
  if (!raw || typeof raw !== "object") return {};
  const now = nowOf(deps);
  const videos = (Array.isArray(raw.videos) ? raw.videos : []).filter((v) => v && now.getTime() - new Date(v.receivedAt).getTime() <= RECEIVED_VIDEO_TTL_MS);
  return { await: alive(raw.await, now), videos };
}

export async function writeMontageState(deps: Pick<AgentsDeps, "prisma">, chatId: string | bigint | number, state: MontageKevinState): Promise<void> {
  if (!state.await && !state.videos?.length) {
    await deps.prisma.setting.deleteMany({ where: { key: montageStateKey(chatId) } });
    return;
  }
  await writeSetting(deps, montageStateKey(chatId), { await: state.await ?? null, videos: (state.videos ?? []).slice(-5) });
}

/** Ce que Kevin attend (ou null). */
export async function readMontageAwait(deps: Pick<AgentsDeps, "prisma" | "now">, chatId: string | bigint | number): Promise<MontageAwait | null> {
  return (await readMontageState(deps, chatId)).await ?? null;
}

/** Pose ce que Kevin attend (remplace l'attente précédente). */
export async function setMontageAwait(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  chatId: string | bigint | number,
  next: MontageAwait | null,
): Promise<void> {
  const s = await readMontageState(deps, chatId);
  await writeMontageState(deps, chatId, { ...s, await: next });
}

/** Retire l'attente si c'est bien celle-là (même nature, même travail ou short). */
export async function clearMontageAwait(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  chatId: string | bigint | number,
  match?: (a: MontageAwait) => boolean,
): Promise<void> {
  const s = await readMontageState(deps, chatId);
  if (!s.await) return;
  if (match && !match(s.await)) return;
  await writeMontageState(deps, chatId, { ...s, await: null });
}

/** Garde la vidéo reçue (30 min) ; un webhook rejoué (même message) ne la double pas. */
export async function rememberVideo(deps: Pick<AgentsDeps, "prisma" | "now">, chatId: string | bigint | number, video: ReceivedVideo): Promise<void> {
  const s = await readMontageState(deps, chatId);
  const videos = (s.videos ?? []).filter((v) => v.messageId !== video.messageId);
  videos.push(video);
  await writeMontageState(deps, chatId, { ...s, videos });
}

/** Met à jour une vidéo gardée (montage lancé, rangée). */
export async function markVideo(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  chatId: string | bigint | number,
  messageId: number,
  patch: Partial<Pick<ReceivedVideo, "jobId" | "assetId">>,
): Promise<void> {
  const s = await readMontageState(deps, chatId);
  const videos = (s.videos ?? []).map((v) => (v.messageId === messageId ? { ...v, ...patch } : v));
  const a = s.await?.kind === "video" && s.await.video.messageId === messageId ? null : (s.await ?? null);
  await writeMontageState(deps, chatId, { await: a, videos });
}

/** Dernière vidéo reçue pas encore utilisée (ni montée ni rangée), ou null. */
export async function latestFreeVideo(deps: Pick<AgentsDeps, "prisma" | "now">, chatId: string | bigint | number): Promise<ReceivedVideo | null> {
  const s = await readMontageState(deps, chatId);
  const free = (s.videos ?? []).filter((v) => !v.jobId && !v.assetId);
  return free.length ? free[free.length - 1]! : null;
}
