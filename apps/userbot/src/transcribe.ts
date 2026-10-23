/**
 * Transcription des vocaux Telegram (phase 18) : le code vit dans `@linkaffipro/userbot` depuis la phase 20 (partage
 * avec le worker pour les vocaux de l'admin). Meme fournisseur, meme cle, meme repli ; ce module branche le journal
 * pino du userbot.
 */
import {
  transcribe as sharedTranscribe,
  type TranscribeOptions,
} from "@linkaffipro/userbot/voice";
import { logger } from "./logger";

export { usableTranscript, type TranscribeOptions } from "@linkaffipro/userbot/voice";

/** Texte du vocal, ou null si on n'a rien d'exploitable (le tour se fait quand meme, sans texte). */
export function transcribe(
  apiKey: string,
  bytes: Buffer,
  mime: string,
  options: TranscribeOptions = {},
): Promise<string | null> {
  return sharedTranscribe(apiKey, bytes, mime, { logger, ...options });
}
