import { GrammyError, HttpError } from "grammy";

export type TelegramFailure = {
  /** Réessayer plus tard ? */
  retryable: boolean;
  /** Attente imposée par Telegram (429), en ms. */
  retryAfterMs?: number;
  /** Le destinataire a bloqué le bot / chat introuvable : ne plus réessayer, marquer BLOCKED. */
  blocked: boolean;
  /** Message lisible en français pour l'interface. */
  message: string;
};

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
  [
    /bot was kicked|bot was blocked|user is deactivated|chat not found|Forbidden/i,
    "Le destinataire a bloqué le bot ou le chat n'existe plus.",
  ],
];

export function describeTelegramError(err: unknown): TelegramFailure {
  if (err instanceof GrammyError) {
    const retryAfter = err.parameters?.retry_after;
    if (err.error_code === 429)
      return {
        retryable: true,
        retryAfterMs: Math.max(1000, (retryAfter ?? 5) * 1000),
        blocked: false,
        message: `Telegram demande d'attendre ${retryAfter ?? 5} s (trop de messages).`,
      };
    const readable = READABLE.find(([re]) => re.test(err.description))?.[1];
    // « Premium requis » n'est pas un blocage par le membre : on ne le marque jamais comme ayant bloqué le bot.
    if (err.error_code === 403 && /PREMIUM/i.test(err.description))
      return {
        retryable: false,
        blocked: false,
        message: readable ?? `Accès refusé par Telegram : ${err.description}`,
      };
    if (err.error_code === 403)
      return {
        retryable: false,
        blocked: true,
        message: readable ?? `Accès refusé par Telegram : ${err.description}`,
      };
    if (err.error_code >= 500)
      return {
        retryable: true,
        blocked: false,
        message: `Telegram indisponible (${err.error_code}).`,
      };
    return {
      retryable: false,
      blocked: /chat not found/i.test(err.description),
      message: readable ?? `Telegram a refusé (${err.error_code}) : ${err.description}`,
    };
  }
  if (err instanceof HttpError)
    return { retryable: true, blocked: false, message: "Erreur réseau vers Telegram." };
  return {
    retryable: false,
    blocked: false,
    message: err instanceof Error ? err.message : String(err),
  };
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
