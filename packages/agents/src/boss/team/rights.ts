/**
 * Phase 26, section 4 — droits de chacun auprès de Kevin (pur). Admin (`admin.telegramUserId`) : tout. Membre
 * présenté :
 * - MEMBER : lecture (état, chiffres, stock, rapport, « qui fait quoi ? ») et actions immédiates dans les équipes
 *   qu'il couvre (pause, reprise, « plus tard », réponses aux demandes et validations qui lui sont adressées) ; il peut
 *   aussi ajouter une note sur lui-même ;
 * - MANAGER (et ADMIN de l'équipe) : présenter, modifier, retirer des membres, et toutes les actions immédiates de
 *   toutes les équipes.
 * Une action à confirmer (passage en vrai, hausse, dépense, publication) reste réservée à l'admin : Kevin la lui
 * transmet en le mentionnant. Personne ne se donne un rôle ou des droits par message (le rôle vient de la base).
 */
import type { BossAction, BossActionClass, BossSpeaker, TeamMemberTeam } from "../contract";
import { teamOf } from "../resolve";

/** Lecture seule : permise à tout membre présenté. */
export const BOSS_READ_KEYS = new Set([
  "etat_general",
  "rapport_du_jour",
  "depenses_du_mois",
  "resultats",
  "demandes_ouvertes",
  "validations_en_attente",
  "etat_equipe",
  "etat_canal",
  "personas",
  "stock_medias",
  "themes_casino",
  "categories_paris",
  "paris_du_jour",
  "bilan_paris",
  "reglages_semaine",
  "tests_en_cours",
  "recommandations_ads",
  "qui_fait_quoi",
  "aide",
]);

/** Gestion de l'équipe : admin et responsables seulement. */
export const BOSS_TEAM_ADMIN_KEYS = new Set(["presenter_membre", "modifier_membre", "retirer_membre"]);

/** Réservées à l'admin, quelle que soit la classe (démarrage guidé, annulation de SA confirmation, groupe). */
export const BOSS_ADMIN_ONLY_KEYS = new Set(["commencer", "annule", "groupe_equipe"]);

/** Réponses aux demandes et décisions sur les validations : permises au membre à qui elles sont adressées. */
export const BOSS_ASSIGNED_KEYS = new Set(["repondre_demande", "plus_tard", "valider_post", "refuser_post", "corriger_post"]);

const THEME_TEAM: Record<string, TeamMemberTeam> = {
  rencontres: "dating",
  casino: "casino",
  paris: "sports",
  algorithme: "algo",
  ads: "ads",
};

/** Équipe visée par une action (paramètre « équipe », sinon thème de l'action) ; null si aucune ou « tout » (pur). */
export function actionTeam(action: Pick<BossAction, "key" | "theme">, params?: Record<string, unknown> | null): TeamMemberTeam | null {
  const raw = params?.equipe;
  if (typeof raw === "string" && raw.trim()) {
    const t = teamOf(raw, { allowAll: true });
    return t && t !== "all" ? t : null;
  }
  return THEME_TEAM[action.theme] ?? null;
}

export type BossRightsScope = {
  /** Classe réelle de l'action avec ces paramètres (`classify`), sinon la classe de base. */
  cls?: BossActionClass;
  params?: Record<string, unknown> | null;
  /** Équipes couvertes par le membre (`TeamMember.responsibilities.teams` ; vide = toutes). */
  teams?: readonly TeamMemberTeam[];
  /** La demande en cours (ou la validation visée) est adressée à ce membre. */
  assignedToSpeaker?: boolean;
  /** La cible de `modifier_membre` est la personne qui parle et seule une note change. */
  selfNoteOnly?: boolean;
};

/**
 * La personne qui parle peut-elle FAIRE cette action elle-même ? Faux = Kevin la transmet à l'admin (action à
 * confirmer ou hors de ses équipes) ou répond « Ça, c'est <admin> qui décide ».
 */
export function bossRightsAllow(action: Pick<BossAction, "key" | "cls" | "theme">, speaker?: BossSpeaker | null, scope: BossRightsScope = {}): boolean {
  if (!speaker || speaker.kind === "admin") return true;
  const cls = scope.cls ?? action.cls;
  if (BOSS_ADMIN_ONLY_KEYS.has(action.key)) return false;
  if (BOSS_READ_KEYS.has(action.key)) return true;
  const manager = speaker.role === "MANAGER" || speaker.role === "ADMIN";
  if (BOSS_TEAM_ADMIN_KEYS.has(action.key)) return manager || (action.key === "modifier_membre" && scope.selfNoteOnly === true);
  if (BOSS_ASSIGNED_KEYS.has(action.key)) return scope.assignedToSpeaker === true || (manager && cls === "immediate");
  if (cls === "confirm") return false;
  if (manager) return true;
  const team = actionTeam(action, scope.params);
  if (!team) return false;
  const teams = scope.teams ?? [];
  return teams.length === 0 || teams.includes(team);
}
