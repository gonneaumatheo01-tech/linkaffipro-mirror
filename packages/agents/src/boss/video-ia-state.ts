/**
 * Remplacement d'une personne dans une vidéo envoyée à Kevin : état gardé dans `Setting` `video-ia.kevin.<chatId>`,
 * un seul remplacement à la fois par conversation.
 * - `queued` : confirmé par OUI, tâche `video-ia.submit` en file ;
 * - `submitting` : repère posé AVANT l'appel payant (une reprise après plantage ne resoumet jamais à l'aveugle) ;
 * - `running` : travail accepté par le fournisseur (identifiant et adresses gardés), relu par `video-ia.poll`.
 * Un état `queued` ou `submitting` de plus de 30 minutes est abandonné (tâche perdue) : il ne bloque plus rien.
 */
import { nowOf, readSetting, writeSetting } from "../admin/journal";
import type { ReceivedVideo } from "../montage/kevin-state";
import type { VideoJobRef, VideoProvider, VideoResolution } from "../providers/video";
import type { AgentsDeps } from "../types";

export const VIDEO_IA_SETTING_PREFIX = "video-ia.kevin.";
/** Au-delà, un état qui n'a jamais démarré chez le fournisseur ne compte plus. */
export const VIDEO_IA_STALE_MS = 30 * 60_000;

export type VideoIaStatus = "queued" | "submitting" | "running";

export type VideoIaState = {
  status: VideoIaStatus;
  chatId: string;
  personaId: string;
  personaName: string;
  /** Vidéo reçue par Kevin (identifiants Telegram : téléchargée par le worker au lancement). */
  video: ReceivedVideo;
  resolution: VideoResolution;
  durationSec: number;
  estimatedCents: number;
  /** Confirmation par OUI (ISO). */
  requestedAt: string;
  provider?: VideoProvider["name"];
  jobId?: string;
  ref?: VideoJobRef;
  submittedAt?: string;
  polls: number;
  lastPolledAt?: string;
  /** Temps passé sans relecture (file occupée, worker arrêté), exclu de l'attente maximale. */
  pausedMs?: number;
};

export function videoIaKey(chatId: string | bigint | number): string {
  return `${VIDEO_IA_SETTING_PREFIX}${String(chatId)}`;
}

function parseState(v: unknown): VideoIaState | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<VideoIaState>;
  if (s.status !== "queued" && s.status !== "submitting" && s.status !== "running") return null;
  if (typeof s.personaId !== "string" || typeof s.requestedAt !== "string" || typeof s.chatId !== "string") return null;
  if (!s.video || typeof s.video !== "object" || typeof s.video.messageId !== "number") return null;
  return s as VideoIaState;
}

/** État pas encore accepté par le fournisseur et trop ancien (pur). */
export function isStaleVideoIa(s: Pick<VideoIaState, "status" | "requestedAt">, now: Date): boolean {
  if (s.status === "running") return false;
  const t = Date.parse(s.requestedAt);
  return Number.isFinite(t) && now.getTime() - t > VIDEO_IA_STALE_MS;
}

export async function readVideoIaState(deps: Pick<AgentsDeps, "prisma">, chatId: string | bigint | number): Promise<VideoIaState | null> {
  return parseState(await readSetting(deps, videoIaKey(chatId)));
}

/** Remplacement en cours qui bloque un nouveau (un état abandonné ne bloque pas). */
export async function activeVideoIa(deps: Pick<AgentsDeps, "prisma" | "now">, chatId: string | bigint | number): Promise<VideoIaState | null> {
  const s = await readVideoIaState(deps, chatId);
  return s && !isStaleVideoIa(s, nowOf(deps)) ? s : null;
}

export async function writeVideoIaState(deps: Pick<AgentsDeps, "prisma">, state: VideoIaState): Promise<void> {
  await writeSetting(deps, videoIaKey(state.chatId), state);
}

export async function clearVideoIaState(deps: Pick<AgentsDeps, "prisma">, chatId: string | bigint | number): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key: videoIaKey(chatId) } });
}
