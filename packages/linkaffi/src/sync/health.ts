/**
 * Santé du sub-ID (contrat docs/LINKAFFI-SUBID.md, section 3), sur 7 jours glissants.
 * Les comptes sont calculés à partir de nos tables (Player, Click rattachés aux campagnes) : voir docs/LINKAFFI-SYNC.md.
 */
export const HEALTH_WINDOW_DAYS = 7;
export const HEALTH_TIME_MATCH_ALERT_THRESHOLD = 5;

export type SubIdHealthCounts = {
  /** Joueurs des 7 derniers jours avec `subIdSource = postback`. */
  postback: number;
  /** Joueurs des 7 derniers jours avec `subIdSource = time_match`. */
  timeMatch: number;
  /** Joueurs des 7 derniers jours sans sub-ID alors que nous avons envoyé des clics avec sub-ID sur la même campagne. */
  missingWithClicks: number;
  /** Clics d'offre avec sub-ID envoyés sur la période (contexte). */
  offerClicks: number;
};

export type SubIdHealth = SubIdHealthCounts & {
  status: "ok" | "warning" | "alert" | "idle";
  message: string;
};

export const SUB_ID_ALERT_MESSAGE =
  "Le casino tronque ou altère probablement la valeur combinée : demander à Lovable un encodage sans point.";

/** Évalue l'état à partir des comptes. */
export function evaluateSubIdHealth(c: SubIdHealthCounts): SubIdHealth {
  if (c.postback === 0 && c.timeMatch > HEALTH_TIME_MATCH_ALERT_THRESHOLD) {
    return { ...c, status: "alert", message: SUB_ID_ALERT_MESSAGE };
  }
  if (c.postback === 0 && c.timeMatch === 0 && c.offerClicks === 0) {
    return { ...c, status: "idle", message: "Aucun clic d'offre avec identifiant de suivi sur les 7 derniers jours : rien à vérifier encore." };
  }
  if (c.postback === 0 && (c.timeMatch > 0 || c.missingWithClicks > 0)) {
    return { ...c, status: "warning", message: "Aucun joueur rattaché par le retour du casino pour l'instant : à surveiller dès les premiers inscrits." };
  }
  if (c.missingWithClicks > c.postback) {
    return { ...c, status: "warning", message: "Beaucoup de joueurs sans identifiant de suivi malgré des clics qui en portaient un : vérifier les liens d'offre utilisés." };
  }
  return { ...c, status: "ok", message: "La chaîne pub → membre → clic → inscription fonctionne (identifiants de suivi bien reçus par le casino)." };
}
