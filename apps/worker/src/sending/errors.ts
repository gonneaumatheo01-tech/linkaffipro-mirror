import { GrammyError, HttpError } from "grammy";

export type TelegramFailure = {
  /** Réessayer plus tard ? */
  retryable: boolean;
  /** Attente imposée par Telegram (429), en ms. */
  retryAfterMs?: number;
  /**
   * La personne a bloqué le bot : Telegram répond « Forbidden: bot was blocked by the user » (phase 14, décision E1 :
   * seul vrai blocage connu par une erreur). Ne plus réessayer, marquer BLOCKED.
   */
  blocked: boolean;
  /**
   * Le bot ne peut pas écrire à cette personne, sans qu'elle l'ait bloqué (phase 14, décision E1) : elle n'a jamais
   * appuyé sur « Démarrer » et les 5 minutes après sa demande sont passées (« bot can't initiate conversation with a
   * user »), compte supprimé, chat privé introuvable, autre refus 403. Ne plus réessayer, marquer FAILED.
   */
  unreachable: boolean;
  /** Message lisible en français pour l'interface. */
  message: string;
  /** Erreur exacte de Telegram (« 403 Forbidden: bot can't initiate conversation with a user »), gardée dans les journaux. */
  telegramError: string | null;
};

/** Texte d'un message privé refusé parce que la personne n'a jamais démarré le bot (décision E1). */
export const DM_NEVER_STARTED_MESSAGE =
  "Le bot ne peut plus écrire à cette personne : elle n'a jamais appuyé sur « Démarrer » et les 5 minutes après sa demande sont passées.";
/** Texte d'un message privé refusé parce que la personne a bloqué le bot. */
export const DM_BLOCKED_MESSAGE = "Cette personne a bloqué le bot.";

/** Blocage par la personne (seul cas où le bot est réellement « bloqué »). */
const BLOCKED_BY_USER_RE = /bot was blocked by the user/i;
/** Le bot n'a pas le droit d'écrire en premier (jamais démarré, fenêtre de 5 minutes passée). */
const CANNOT_INITIATE_RE =
  /can't initiate conversation|can not initiate conversation|cannot initiate conversation/i;

const READABLE: Array<[RegExp, string]> = [
  [
    /PREMIUM_ACCOUNT_REQUIRED|PRIVACY_PREMIUM_REQUIRED/i,
    "Telegram Premium requis (emojis animés : abonnement du propriétaire des bots ?).",
  ],
  [
    /message is too long/i,
    "Texte trop long pour Telegram (4096 caractères, 1024 pour une légende).",
  ],
  [/caption is too long/i, "Légende trop longue (1024 caractères maximum)."],
  [
    /not enough rights|have no rights|CHAT_WRITE_FORBIDDEN|need administrator rights/i,
    "Le bot n'est pas administrateur du canal (ou n'a pas le droit de publier).",
  ],
  [/chat not found/i, "Canal introuvable : le bot n'y a plus accès."],
  [
    /can't parse entities|parse entities/i,
    "Mise en forme HTML invalide (balise non fermée ou non acceptée).",
  ],
  [
    /wrong file identifier|file is too big|IMAGE_PROCESS_FAILED|PHOTO_INVALID_DIMENSIONS/i,
    "Média refusé par Telegram (taille ou format).",
  ],
  [/BUTTON_URL_INVALID|wrong http url/i, "URL de bouton invalide."],
  [
    /message to delete not found|message can't be deleted/i,
    "Message déjà supprimé ou trop ancien pour être supprimé.",
  ],
  [/message to pin not found/i, "Message à épingler introuvable."],
  [BLOCKED_BY_USER_RE, DM_BLOCKED_MESSAGE],
  [CANNOT_INITIATE_RE, DM_NEVER_STARTED_MESSAGE],
  [
    /user is deactivated/i,
    "Compte Telegram supprimé : le bot ne peut plus écrire à cette personne.",
  ],
  [/bot was kicked/i, "Le bot a été retiré du canal ou du groupe."],
  [/Forbidden/i, "Telegram refuse que le bot écrive à ce destinataire."],
];

export function describeTelegramError(err: unknown): TelegramFailure {
  if (err instanceof GrammyError) {
    const retryAfter = err.parameters?.retry_after;
    const telegramError = `${err.error_code} ${err.description}`;
    const base = { blocked: false, unreachable: false, telegramError };
    if (err.error_code === 429)
      return {
        ...base,
        retryable: true,
        retryAfterMs: Math.max(1000, (retryAfter ?? 5) * 1000),
        message: `Telegram demande d'attendre ${retryAfter ?? 5} s (trop de messages).`,
      };
    const readable = READABLE.find(([re]) => re.test(err.description))?.[1];
    // « Premium requis » n'est pas un blocage par le membre : on ne le marque jamais comme ayant bloqué le bot.
    if (err.error_code === 403 && /PREMIUM/i.test(err.description))
      return {
        ...base,
        retryable: false,
        message: readable ?? `Accès refusé par Telegram : ${err.description}`,
      };
    // Seul vrai blocage connu par une erreur : « bot was blocked by the user » (décision E1).
    if (err.error_code === 403 && BLOCKED_BY_USER_RE.test(err.description))
      return { ...base, retryable: false, blocked: true, message: DM_BLOCKED_MESSAGE };
    // Tout autre refus 403 : le bot ne peut pas écrire à ce destinataire, sans blocage de sa part.
    if (err.error_code === 403)
      return {
        ...base,
        retryable: false,
        unreachable: true,
        message: readable ?? `Accès refusé par Telegram : ${err.description}`,
      };
    if (err.error_code >= 500)
      return { ...base, retryable: true, message: `Telegram indisponible (${err.error_code}).` };
    return {
      ...base,
      retryable: false,
      // Chat introuvable : pour un message privé, la personne est injoignable (jamais « bloqué »).
      unreachable: /chat not found/i.test(err.description),
      message: readable ?? `Telegram a refusé (${err.error_code}) : ${err.description}`,
    };
  }
  if (err instanceof HttpError)
    return {
      retryable: true,
      blocked: false,
      unreachable: false,
      telegramError: null,
      message: "Erreur réseau vers Telegram.",
    };
  return {
    retryable: false,
    blocked: false,
    unreachable: false,
    telegramError: null,
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Erreur d'un message privé (décision E1) : statut du message (BLOCKED seulement pour un vrai blocage), texte pour
 * l'équipe et erreur exacte de Telegram. Chat introuvable : texte d'un message privé, pas d'un canal.
 */
export function describeDmFailure(err: unknown): TelegramFailure & {
  status: "BLOCKED" | "FAILED";
} {
  const d = describeTelegramError(err);
  if (d.blocked) return { ...d, status: "BLOCKED" };
  if (d.unreachable && d.telegramError && /chat not found/i.test(d.telegramError))
    return {
      ...d,
      status: "FAILED",
      message: "Chat privé introuvable : le bot ne peut pas écrire à cette personne.",
    };
  return { ...d, status: "FAILED" };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Exécute un appel Telegram avec reprises : 429 → attente `retry_after` (sans compter comme échec, 5 fois max),
 * erreur réseau / 5xx → 3 tentatives avec attente croissante, autre erreur → remontée immédiate.
 */
export async function withTelegramRetry<T>(
  fn: () => Promise<T>,
  opts: {
    sleep?: (ms: number) => Promise<void>;
    maxNetworkAttempts?: number;
    max429?: number;
  } = {},
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let networkAttempts = 0;
  let waits429 = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const d = describeTelegramError(err);
      if (d.retryAfterMs !== undefined) {
        if (++waits429 > (opts.max429 ?? 5)) throw err;
        await sleep(d.retryAfterMs);
        continue;
      }
      if (d.retryable) {
        if (++networkAttempts >= (opts.maxNetworkAttempts ?? 3)) throw err;
        await sleep(1000 * 2 ** (networkAttempts - 1));
        continue;
      }
      throw err;
    }
  }
}
