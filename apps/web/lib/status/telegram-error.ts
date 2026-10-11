/**
 * Erreurs Telegram des bots, en français simple (fonction pure, testée dans telegram-error.test.ts). Le texte brut
 * renvoyé par Telegram ou par la bibliothèque (« Call to 'getWebhookInfo' failed! (401: Unauthorized) ») est une
 * trace technique en anglais : il n'est jamais affiché en surface, seulement dans « Détail technique » (et au
 * survol). Utilisé par Réglages → Bots et Réglages → État du système.
 *
 * `source` : d'où vient l'erreur.
 * - `check` : notre lecture de la connexion auprès de Telegram (getWebhookInfo) a échoué ;
 * - `delivery` : Telegram signale qu'il n'arrive pas à transmettre les messages au site ;
 * - `bot` : le bot a rencontré une erreur en traitant un message.
 */

export type TelegramErrorSource = "check" | "delivery" | "bot";

export type TelegramErrorKind = "token" | "network" | "rate" | "delivery" | "other";

export type TelegramErrorView = {
  kind: TelegramErrorKind;
  /** Mot court de la pastille (« Jeton refusé », « Telegram injoignable »…). */
  label: string;
  /** Une phrase : ce qui se passe et quoi faire. */
  sentence: string;
  /** Texte brut, pour « Détail technique » et le survol. */
  raw: string;
};

const TOKEN = /\b401\b|unauthori[sz]ed|invalid (bot )?token|\b404\b[^a-z]*not found/i;
const RATE = /\b429\b|too many requests|retry after|flood/i;
const NETWORK =
  /network request|fetch failed|timed? ?out|timeout|etimedout|econnreset|econnrefused|enotfound|eai_again|socket hang up|abort|getaddrinfo|network/i;

const SENTENCES: Record<TelegramErrorKind, { label: string; sentence: string }> = {
  token: {
    label: "Jeton refusé",
    sentence:
      "Telegram refuse le jeton de ce bot (supprimé ou régénéré dans @BotFather) : collez le nouveau jeton avec « Ajouter un bot ».",
  },
  network: {
    label: "Telegram injoignable",
    sentence: "Telegram ne répond pas, réessayez dans quelques minutes.",
  },
  rate: {
    label: "Trop de demandes",
    sentence: "Telegram demande de patienter quelques secondes : le bot reprend tout seul.",
  },
  delivery: {
    label: "Messages non transmis",
    sentence:
      "Telegram n'arrive pas à transmettre les messages au site : vérifiez que le site est en ligne, puis cliquez sur « Reposer la connexion ».",
  },
  other: {
    label: "Erreur Telegram",
    sentence:
      "Telegram a renvoyé une erreur : cliquez sur « Reposer la connexion » ; si elle revient, prévenez la personne technique.",
  },
};

const BOT_ERROR_SENTENCE =
  "Le bot a rencontré une erreur en traitant un message. Si elle se répète, prévenez la personne technique.";

/** Nature d'une erreur Telegram, d'après son texte brut. */
export function telegramErrorKind(raw: string, source: TelegramErrorSource): TelegramErrorKind {
  if (TOKEN.test(raw)) return "token";
  if (RATE.test(raw)) return "rate";
  // Une erreur de transmission signalée par Telegram (« Connection timed out », « Wrong response from the
  // webhook ») veut dire que Telegram n'atteint pas le site, pas que Telegram est injoignable.
  if (source === "delivery") return "delivery";
  if (NETWORK.test(raw)) return "network";
  return "other";
}

/** Libellé et phrase d'une erreur Telegram ; `null` sans erreur. */
export function telegramErrorText(
  raw: string | null | undefined,
  source: TelegramErrorSource = "check",
): TelegramErrorView | null {
  const text = raw?.trim();
  if (!text) return null;
  const kind = telegramErrorKind(text, source);
  const base = SENTENCES[kind];
  if (source === "bot" && kind === "other")
    return { kind, label: "Erreur du bot", sentence: BOT_ERROR_SENTENCE, raw: text };
  return { kind, ...base, raw: text };
}
