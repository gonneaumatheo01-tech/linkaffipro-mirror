/**
 * Pretraitement des vocaux (phase 18) : le code vit dans `@linkaffipro/userbot` depuis la phase 20 (partage avec le
 * worker pour les vocaux de l'admin). Ce module garde l'interface du userbot et lui branche son journal pino.
 */
import {
  hasFfmpeg as sharedHasFfmpeg,
  prepareVoice as sharedPrepareVoice,
  type PreparedAudio,
} from "@linkaffipro/userbot/voice";
import { logger } from "./logger";

export { VOICE_FILTERS, resetFfmpegDetection, type PreparedAudio } from "@linkaffipro/userbot/voice";

/** ffmpeg est-il installe ? Verifie une seule fois par process. */
export function hasFfmpeg(): Promise<boolean> {
  return sharedHasFfmpeg(logger);
}

/** Nettoie et amplifie un vocal ; null si ffmpeg manque ou echoue (l'appelant envoie les octets d'origine). */
export function prepareVoice(bytes: Buffer): Promise<PreparedAudio | null> {
  return sharedPrepareVoice(bytes, logger);
}
