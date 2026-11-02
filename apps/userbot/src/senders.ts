/**
 * Expéditeurs auxquels un compte réel ne répond jamais : comptes de service de Telegram (codes de connexion, alertes de
 * connexion : « Telegram » 777000, 42777, 333000) et support officiel (`support`). Leur texte (un code de connexion !)
 * ne doit jamais finir en base ni chez le fournisseur d'IA.
 */
const TELEGRAM_SERVICE_IDS: ReadonlySet<string> = new Set(["777000", "42777", "333000"]);

/** Vrai pour un compte de service ou de support de Telegram (identifiant connu, ou drapeau `support`). */
export function isTelegramServiceSender(sender: {
  id: { toString(): string } | string | number | bigint;
  support?: boolean | null;
}): boolean {
  return Boolean(sender.support) || TELEGRAM_SERVICE_IDS.has(String(sender.id));
}
