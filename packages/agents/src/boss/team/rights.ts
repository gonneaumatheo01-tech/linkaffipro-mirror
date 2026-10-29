/**
 * Phase 26, section 4 — droits de chacun auprès de Kevin (pur). Admin (`admin.telegramUserId`) : tout. Membre
 * présenté :
 * - MEMBER : liste FERMÉE (`BOSS_MEMBER_TEAM_KEYS`) : lecture (état, chiffres, stock, rapport, paris du jour,
 *   bilan, « qui fait quoi ? »), pause et reprise de SES équipes, « plus tard » et réponses aux demandes et
 *   validations qui lui sont adressées, une note sur lui-même. Rien d'autre (ni mode de capture, ni test du
 *   bookmaker, ni annulation d'un réglage, ni recommandations pubs, ni plafond, ni quota…) : Kevin le transmet à
 *   l'admin ;
 * - MANAGER (et ADMIN de l'équipe) : présenter, modifier, retirer des membres, et toutes les actions immédiates de
 *   toutes les équipes, sauf répondre à une demande réservée à l'admin (`teamAdminOnlyRequest`) ou adressée à un
 *   autre membre, ou posée dans une autre conversation.
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
  // Phase 33 : lire les ordres et ce qui reste impossible (jamais les lancer, modifier ou arrêter sur un vrai canal).
  "mes_ordres",
  "ordre_statut",
  "impossibles",
  // Phase 33, chantier C : voir ce que font et vont faire les équipes (écrites ici aussi : la liste ne dépend pas du
  // chargement de `catalog-view.ts`, qui les ajoute de son côté).
  "voir_plan",
  "voir_programme",
  "voir_paris_du_canal",
  "apercu_matchs",
  "voir_matchs_bookmaker",
  "voir_fait",
  "pourquoi_rien",
  "fiche_agent",
  "qu_attend_ma_validation",
]);

/** Gestion de l'équipe : admin et responsables seulement. */
export const BOSS_TEAM_ADMIN_KEYS = new Set(["presenter_membre", "modifier_membre", "retirer_membre"]);

/** Réservées à l'admin, quelle que soit la classe (démarrage guidé, annulation de SA confirmation, groupe). */
export const BOSS_ADMIN_ONLY_KEYS = new Set([
  // Envois programmés (29 octobre 2026) : envoyer nos données à quelqu'un, l'admin seul.
  "programmer_envoi",
  "arreter_envoi",
  "commencer",
  "annule",
  "groupe_equipe",
]);

/** Réponses aux demandes et décisions sur les validations : permises au membre à qui elles sont adressées. */
export const BOSS_ASSIGNED_KEYS = new Set(["repondre_demande", "plus_tard", "valider_post", "refuser_post", "corriger_post"]);

/** Réponses à la demande en cours (une `HumanRequest`), par opposition aux validations. */
export const BOSS_REQUEST_ANSWER_KEYS = new Set(["repondre_demande", "plus_tard"]);

/**
 * Actions immédiates qu'un simple membre (MEMBER) fait lui-même, dans SES équipes seulement. Liste fermée : toute
 * autre action (mode de capture, test du bookmaker, annulation d'un réglage, « fait » / « refuser » des pubs,
 * plafonds, quotas, plan d'un canal…) part chez l'admin.
 */
export const BOSS_MEMBER_TEAM_KEYS = new Set(["pause", "reprise"]);

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
  /**
   * Demande en cours (pour `repondre_demande` / `plus_tard` d'un responsable, voir `bossRequestScope`) : réservée à
   * l'admin, adressée à un autre membre, posée dans une autre conversation. Absent = inconnu = refusé au responsable.
   */
  request?: { adminOnly: boolean; assignedToOther: boolean; otherChat: boolean } | null;
};

/**
 * La personne qui parle peut-elle FAIRE cette action elle-même ? Faux = Kevin la transmet à l'admin (action à
 * confirmer ou hors de ses équipes) ou répond « Ça, c'est <admin> qui décide ».
 */
export function bossRightsAllow(action: Pick<BossAction, "key" | "cls" | "theme">, speaker?: BossSpeaker | null, scope: BossRightsScope = {}): boolean {
  if (!speaker || speaker.kind === "admin") return true;
  const cls = scope.cls ?? action.cls;
  if (BOSS_ADMIN_ONLY_KEYS.has(action.key)) return false;
  // Une action à confirmer (entrée par un lien d'invitation, par exemple) n'est jamais celle d'un membre, même
  // rangée parmi les lectures : elle part chez l'admin, qui seul confirme.
  if (cls === "confirm" && !BOSS_ASSIGNED_KEYS.has(action.key)) return false;
  if (BOSS_READ_KEYS.has(action.key)) return true;
  const manager = speaker.role === "MANAGER" || speaker.role === "ADMIN";
  if (BOSS_TEAM_ADMIN_KEYS.has(action.key)) return manager || (action.key === "modifier_membre" && scope.selfNoteOnly === true);
  if (BOSS_ASSIGNED_KEYS.has(action.key)) {
    if (scope.assignedToSpeaker === true) return true;
    if (!manager || cls !== "immediate") return false;
    // Un responsable ne répond pas à une question réservée à l'admin, adressée à quelqu'un d'autre, ou posée ailleurs.
    if (BOSS_REQUEST_ANSWER_KEYS.has(action.key)) {
      const r = scope.request;
      return !!r && !r.adminOnly && !r.assignedToOther && !r.otherChat;
    }
    return true;
  }
  if (cls === "confirm") return false;
  if (manager) return true;
  if (!BOSS_MEMBER_TEAM_KEYS.has(action.key)) return false;
  const team = actionTeam(action, scope.params);
  if (!team) return false;
  const teams = scope.teams ?? [];
  return teams.length === 0 || teams.includes(team);
}
