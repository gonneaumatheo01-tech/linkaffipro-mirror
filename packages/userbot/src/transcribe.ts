/**
 * Transcription des vocaux Telegram (phase 18, partagee depuis la phase 20 : comptes reels et vocaux de l'admin) : le vocal part vers l'API Venice de transcription et
 * son texte est traite comme un message normal. Ne jette jamais : un vocal non transcrit ne doit pas
 * casser le tour.
 *
 * Robustesse aux voix faibles (etape 2) :
 *   1. le son est nettoye et amplifie avant l'envoi (audio.ts, ffmpeg) ;
 *   2. premier essai en detection automatique de la langue ; si le resultat est vide, trop court
 *      pour la duree, ou une « hallucination » connue de Whisper sur un son quasi muet, second essai
 *      en forcant le francais (la langue de 95 % des contacts) ;
 *   3. un transcript inexploitable vaut null : la persona demande alors de repeter, elle n'invente rien.
 */
import { prepareVoice, type PreparedAudio } from "./audio";
import { silentVoiceLogger, type VoiceLogger } from "./voice-logger";

const STT_URL = "https://api.venice.ai/api/v1/audio/transcriptions";
/** Multilingue (francais compris) : un contact peut parler dans une autre langue. */
const STT_MODEL = "openai/whisper-large-v3";
/** Biais de vocabulaire : Whisper s'appuie dessus pour les mots maches ou le volume faible. */
export const STT_PROMPT =
  "Conversation Telegram en francais, langage parle et familier, entre un homme et une fille.";
/** Langue du second essai quand la detection automatique n'a rien donne. */
const FALLBACK_LANGUAGE = "fr";
/** Plafond de securite sur le vocal recu : un vocal Telegram fait quelques centaines de ko. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Plafond sur le fichier envoye (FLAC 16 kHz mono : ~1,2 Mo par minute) ; Venice refuse au-dela de 25 Mo. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Phrases que Whisper « entend » dans le silence ou le souffle (generiques de sous-titres, formules de fin
 * de video). Un transcript qui n'est que cela n'est pas une parole : on le traite comme vide.
 */
const HALLUCINATIONS: RegExp[] = [
  /sous[- ]?titr/i,
  /amara\.org/i,
  /merci d'avoir regard/i,
  /abonne[sz][- ]?(toi|vous)/i,
  /n'h[ée]sitez pas [àa] (vous abonner|liker)/i,
  /[àa] (bient[ôo]t|la prochaine) pour (une|de) nouvelle/i,
  /thanks? (you )?for watching/i,
  /subtitles? by/i,
  /like,? (comment )?and subscribe/i,
  /transcri(bed|ption) by/i,
  /www\.[a-z0-9-]+\.[a-z]{2,}/i,
];

export type TranscribeOptions = {
  /** Pour les tests : remplace l'appel reseau. */
  fetch?: typeof fetch;
  /** Pour les tests : remplace le pretraitement ffmpeg. */
  prepare?: (bytes: Buffer) => Promise<PreparedAudio | null>;
  /** Journal (pino du userbot ou du worker) ; muet par defaut. */
  logger?: VoiceLogger;
  /** Biais de vocabulaire (par defaut : conversation entre un homme et une fille, phase 18). */
  prompt?: string;
};

type SttResult = { text: string; durationSec: number | null };

/** Nombre de mots (suites de lettres ou chiffres). */
function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

/**
 * Vrai si le transcript ressemble a une vraie parole : au moins deux lettres, pas une hallucination
 * connue, pas un seul mot repete en boucle, et pas ridiculement court pour la duree du vocal
 * (un seul mot pour dix secondes de son = un vocal pas compris).
 */
export function usableTranscript(text: string, durationSec: number | null): boolean {
  const t = text.trim();
  if (t.replace(/[^\p{L}]/gu, "").length < 2) return false;
  if (HALLUCINATIONS.some((re) => re.test(t))) return false;
  const words = t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length >= 6 && new Set(words).size === 1) return false;
  if (durationSec !== null && durationSec >= 10 && words.length < 2) return false;
  return true;
}

async function callStt(
  fetchFn: typeof fetch,
  apiKey: string,
  audio: PreparedAudio,
  language: string | null,
  logger: VoiceLogger,
  prompt: string,
): Promise<SttResult | null> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), audio.name);
  form.append("model", STT_MODEL);
  form.append("prompt", prompt);
  if (language) form.append("language", language);
  const res = await fetchFn(STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    logger.warn({ statut: res.status, langue: language ?? "auto" }, "transcription du vocal en echec");
    return null;
  }
  const json = (await res.json()) as { text?: unknown; duration?: unknown };
  return {
    text: typeof json.text === "string" ? json.text.trim() : "",
    durationSec: typeof json.duration === "number" && Number.isFinite(json.duration) ? json.duration : null,
  };
}

/** Texte du vocal, ou null si on n'a rien d'exploitable (le tour se fait quand meme, sans texte). */
export async function transcribe(
  apiKey: string,
  bytes: Buffer,
  mime: string,
  options: TranscribeOptions = {},
): Promise<string | null> {
  const logger = options.logger ?? silentVoiceLogger;
  const prompt = options.prompt ?? STT_PROMPT;
  if (bytes.length === 0) return null;
  if (bytes.length > MAX_BYTES) {
    logger.warn({ octets: bytes.length }, "vocal trop gros, non transcrit");
    return null;
  }
  const fetchFn = options.fetch ?? fetch;
  const prepare = options.prepare ?? ((b: Buffer) => prepareVoice(b, logger));
  try {
    const raw: PreparedAudio = { bytes, mime, name: "vocal.ogg" };
    let audio = (await prepare(bytes)) ?? raw;
    if (audio.bytes.length > MAX_UPLOAD_BYTES) {
      logger.warn({ octets: audio.bytes.length }, "vocal nettoye trop gros : envoye tel quel");
      audio = raw;
    }
    const prepared = audio !== raw;

    // Essai 1 : langue detectee par le modele.
    const first = await callStt(fetchFn, apiKey, audio, null, logger, prompt);
    if (first && usableTranscript(first.text, first.durationSec)) {
      logger.info(
        { essai: 1, duree: first.durationSec, nettoye: prepared, mots: wordCount(first.text) },
        "vocal transcrit",
      );
      return first.text;
    }

    // Essai 2 : on force le francais (une voix faible fait souvent echouer la detection de langue).
    const second = await callStt(fetchFn, apiKey, audio, FALLBACK_LANGUAGE, logger, prompt);
    if (second && usableTranscript(second.text, second.durationSec)) {
      logger.info(
        { essai: 2, duree: second.durationSec, nettoye: prepared, mots: wordCount(second.text) },
        "vocal transcrit",
      );
      return second.text;
    }

    logger.info(
      {
        duree: first?.durationSec ?? second?.durationSec ?? null,
        nettoye: prepared,
        essai1: first?.text.slice(0, 80) ?? null,
        essai2: second?.text.slice(0, 80) ?? null,
      },
      "vocal non compris",
    );
    return null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "transcription du vocal en erreur",
    );
    return null;
  }
}
