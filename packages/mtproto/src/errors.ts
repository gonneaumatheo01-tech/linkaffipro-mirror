/**
 * Erreurs typées du paquet MTProto. Les erreurs GramJS sont converties ici pour que le worker et le site
 * n'aient jamais à dépendre des classes internes de GramJS.
 */

/** Telegram demande d'attendre `seconds` secondes avant de réessayer (FLOOD_WAIT_X). */
export class MtprotoFloodWait extends Error {
  readonly seconds: number;
  constructor(seconds: number) {
    super(`Telegram demande d'attendre ${seconds} s (FLOOD_WAIT)`);
    this.name = "MtprotoFloodWait";
    this.seconds = seconds;
  }
}

/** Codes d'erreur Telegram qui signifient que la session n'est plus valable : il faut reconnecter le compte. */
export const AUTH_ERROR_CODES = [
  "AUTH_KEY_UNREGISTERED",
  "AUTH_KEY_INVALID",
  "AUTH_KEY_PERM_EMPTY",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "USER_DEACTIVATED",
  "USER_DEACTIVATED_BAN",
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** La session Telegram n'est plus valable (révoquée, expirée, compte désactivé) : à reconnecter, ne pas réessayer. */
export class MtprotoAuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode) {
    super(`Session Telegram invalide (${code}) : reconnectez le compte`);
    this.name = "MtprotoAuthError";
    this.code = code;
  }
}

/** Le compte a la validation en deux étapes : un mot de passe est nécessaire après le code (SESSION_PASSWORD_NEEDED). */
export class MtprotoPasswordNeeded extends Error {
  constructor() {
    super("Mot de passe de validation en deux étapes nécessaire");
    this.name = "MtprotoPasswordNeeded";
  }
}

/** Erreur Telegram « lisible » (code court, ex. PHONE_CODE_INVALID), avec un message en français quand on le connaît. */
export class MtprotoRpcError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? describeRpcCode(code));
    this.name = "MtprotoRpcError";
    this.code = code;
  }
}

const RPC_MESSAGES: Record<string, string> = {
  PHONE_CODE_INVALID: "Code incorrect : vérifiez le code reçu dans Telegram.",
  PHONE_CODE_EXPIRED: "Code expiré : recommencez à l'étape du numéro de téléphone.",
  PHONE_CODE_EMPTY: "Entrez le code reçu dans Telegram.",
  PHONE_NUMBER_INVALID: "Numéro de téléphone invalide : utilisez le format international (+33…).",
  PHONE_NUMBER_BANNED: "Ce numéro est bloqué par Telegram.",
  PHONE_NUMBER_UNOCCUPIED: "Aucun compte Telegram n'existe pour ce numéro.",
  PHONE_NUMBER_FLOOD: "Trop de demandes de code pour ce numéro : réessayez plus tard.",
  PHONE_PASSWORD_FLOOD: "Trop d'essais de mot de passe : réessayez plus tard.",
  PASSWORD_HASH_INVALID: "Mot de passe incorrect.",
  SESSION_PASSWORD_NEEDED: "Mot de passe de validation en deux étapes nécessaire.",
  API_ID_INVALID: "Identifiants d'application (api_id / api_hash) invalides : vérifiez-les sur my.telegram.org.",
  API_ID_PUBLISHED_FLOOD: "Cette application Telegram est trop utilisée : créez-en une nouvelle sur my.telegram.org.",
  CHANNEL_PRIVATE: "Le compte connecté n'a pas accès à ce canal (il doit en être membre ou administrateur).",
  CHANNEL_INVALID: "Canal introuvable pour le compte connecté.",
  PEER_ID_INVALID: "Canal introuvable pour le compte connecté (il doit en être membre).",
  CHAT_ADMIN_REQUIRED: "Le compte connecté doit être administrateur du canal.",
  MSG_ID_INVALID: "Identifiant de message invalide.",
  AUTH_RESTART: "Connexion à recommencer : relancez l'envoi du code.",
};

/** Message en français pour un code d'erreur Telegram connu, sinon le code lui-même. */
export function describeRpcCode(code: string): string {
  return RPC_MESSAGES[code] ?? `Erreur Telegram : ${code}`;
}

/** Forme minimale d'une erreur GramJS (RPCError) que l'on sait reconnaître sans importer GramJS. */
type RpcLike = { errorMessage?: unknown; seconds?: unknown; message?: unknown; code?: unknown };

/** Extrait le code court Telegram (ex. `FLOOD_WAIT_17`, `AUTH_KEY_UNREGISTERED`) d'une erreur GramJS, ou null. */
export function rpcCodeOf(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as RpcLike;
  if (typeof e.errorMessage === "string" && e.errorMessage) return e.errorMessage;
  if (typeof e.message === "string") {
    const m = /\b([A-Z][A-Z0-9_]{3,})\b/.exec(e.message);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Secondes d'attente d'une erreur FLOOD_WAIT (GramJS expose `seconds` ; sinon on lit le message), ou null. */
export function floodWaitSecondsOf(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as RpcLike;
  const code = rpcCodeOf(err) ?? "";
  if (typeof e.seconds === "number" && Number.isFinite(e.seconds) && e.seconds >= 0 && /FLOOD/.test(code)) return Math.ceil(e.seconds);
  const m = /FLOOD_WAIT_(\d+)/.exec(code) ?? /A wait of (\d+) seconds is required/.exec(String(e.message ?? ""));
  if (m?.[1]) return Number(m[1]);
  return null;
}

/**
 * Convertit n'importe quelle erreur GramJS en erreur typée du paquet. Fonction pure (testée) :
 * - FLOOD_WAIT_X → `MtprotoFloodWait`
 * - AUTH_KEY_UNREGISTERED, SESSION_REVOKED… → `MtprotoAuthError`
 * - SESSION_PASSWORD_NEEDED → `MtprotoPasswordNeeded`
 * - autre code Telegram → `MtprotoRpcError`
 * - sinon → l'erreur d'origine (Error) ou une Error construite à partir de sa représentation.
 */
export function classifyError(err: unknown): Error {
  if (
    err instanceof MtprotoFloodWait ||
    err instanceof MtprotoAuthError ||
    err instanceof MtprotoPasswordNeeded ||
    err instanceof MtprotoRpcError
  )
    return err;
  const seconds = floodWaitSecondsOf(err);
  if (seconds !== null) return new MtprotoFloodWait(seconds);
  const code = rpcCodeOf(err);
  if (code) {
    if ((AUTH_ERROR_CODES as readonly string[]).includes(code)) return new MtprotoAuthError(code as AuthErrorCode);
    if (code === "SESSION_PASSWORD_NEEDED") return new MtprotoPasswordNeeded();
    if (/^[A-Z][A-Z0-9_]+$/.test(code)) return new MtprotoRpcError(code);
  }
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Erreur Telegram inconnue");
}
