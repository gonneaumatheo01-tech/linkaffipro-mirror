/**
 * Journal minimal des vocaux (phase 20) : la transcription partagée ne dépend pas de pino. Le userbot lui passe son
 * journal pino, le worker le sien ; par défaut, rien n'est écrit.
 */
export type VoiceLogger = {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
};

/** Journal muet (par défaut). */
export const silentVoiceLogger: VoiceLogger = {
  info: () => undefined,
  warn: () => undefined,
};
