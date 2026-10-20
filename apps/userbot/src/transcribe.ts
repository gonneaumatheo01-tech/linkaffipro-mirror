/**
 * Transcription des vocaux Telegram (phase 18) : le vocal part vers l'API Venice de transcription et
 * son texte est traite comme un message normal. Ne jette jamais : un vocal non transcrit ne doit pas
 * casser le tour.
 */
import { logger } from "./logger";

const STT_URL = "https://api.venice.ai/api/v1/audio/transcriptions";
/** Multilingue (francais compris) : un contact peut parler dans une autre langue. */
const STT_MODEL = "openai/whisper-large-v3";
/** Biais de vocabulaire : Whisper s'appuie dessus pour les mots maches ou le volume faible. */
const STT_PROMPT =
  "Conversation Telegram en francais, langage parle et familier, entre un homme et une fille.";
/** Plafond de securite : un vocal Telegram fait quelques centaines de ko. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Texte du vocal, ou null si on n'a rien d'exploitable (le tour se fait quand meme, sans texte). */
export async function transcribe(
  apiKey: string,
  bytes: Buffer,
  mime: string,
): Promise<string | null> {
  if (bytes.length === 0) return null;
  if (bytes.length > MAX_BYTES) {
    logger.warn({ octets: bytes.length }, "vocal trop gros, non transcrit");
    return null;
  }
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "vocal.ogg");
    form.append("model", STT_MODEL);
    form.append("prompt", STT_PROMPT);
    const res = await fetch(STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      logger.warn({ statut: res.status }, "transcription du vocal en echec");
      return null;
    }
    const json = (await res.json()) as { text?: unknown };
    const texte = typeof json.text === "string" ? json.text.trim() : "";
    // Rien, ou un transcript sans lettres (« . », « ... ») : inexploitable, on prefere ne rien dire.
    if (texte.replace(/[^\p{L}]/gu, "").length < 2) return null;
    return texte;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "transcription du vocal en erreur",
    );
    return null;
  }
}
