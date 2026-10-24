/**
 * Phase 26 (chantier A) : point d'accroche de l'enregistrement du Boss pour le dialogue admin. Le bot et le worker
 * branchent `registerBossFromToken` (`@linkaffipro/telegram`) ici au démarrage ; le chemin rapide du Boss (commande
 * exacte `jeton boss <valeur>`, réponse à la demande SECRET de clé `boss.token`) l'appelle sans dépendre de grammY.
 * Le jeton n'est jamais journalisé ni renvoyé ; l'appelant supprime le message qui le contenait.
 */

/** Rend le nom d'utilisateur du Boss enregistré ; lève avec un message en français si le jeton est refusé. */
export type BossRegisterPort = (token: string) => Promise<{ username: string }>;

/** Clé de la demande SECRET « jeton boss ». */
export const BOSS_TOKEN_SECRET_KEY = "boss.token";

let port: BossRegisterPort | null = null;

export function setBossRegisterPort(next: BossRegisterPort | null): void {
  port = next;
}

/** Port branché, ou `null` (site sans bot, tests) : le Boss répond alors que l'enregistrement se fait dans Réglages → Bots. */
export function bossRegisterPort(): BossRegisterPort | null {
  return port;
}
