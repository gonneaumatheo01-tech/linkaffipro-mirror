/**
 * Vocaux (phase 18, partagés en phase 20) : prétraitement ffmpeg et transcription Venice. Point d'entrée léger
 * `@linkaffipro/userbot/voice` : n'importe ni la base ni MTProto (utilisé par le userbot et par le worker).
 */
export * from "./voice-logger";
export * from "./audio";
export * from "./transcribe";
