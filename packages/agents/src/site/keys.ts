/**
 * Phase 34, chantier A — clés partagées du déroulé « tout par Kevin » (sans import : lues par `boss/execute.ts`,
 * `boss/confirm.ts` et `boss/fast.ts` sans créer de cycle de chargement).
 */

/** Entrée cachée du catalogue exécutée après un OUI (`yes`, `send`). Journal fait par le cœur du site, pas par Kevin. */
export const SITE_OP_ACTION = "site_op";
/** Entrée cachée exécutée seulement après le mot exact SUPPRIMER (jamais par OUI ni par un bouton). */
export const SITE_OP_DELETE_ACTION = "site_op_delete";
/** Entrées dont l'`AuditLog` est écrit par le cœur du site (`via: "TELEGRAM"`) : `runConfirmedAction` n'en écrit pas. */
export const SITE_SELF_AUDITED_ACTIONS: ReadonlySet<string> = new Set([SITE_OP_ACTION, SITE_OP_DELETE_ACTION]);
/** Boutons de choix d'une valeur (`bsk:<flowId>:<n>`). */
export const SITE_CHOICE_PREFIX = "bsk:";
/** `Setting` d'un déroulé en cours (secret demandé, choix par boutons) : `boss.site.flow.<id>`, 30 minutes. */
export const SITE_FLOW_SETTING_PREFIX = "boss.site.flow.";
export const SITE_FLOW_TTL_MS = 30 * 60_000;
/** Suite d'une demande SECRET d'une opération du site (`registerAnswerAction`). */
export const SITE_SECRET_ANSWER_ACTION = "site-op-secret";
/** Préfixe des clés des demandes SECRET : `site.<opération>.<champ>` (rangées puis effacées après usage). */
export const SITE_SECRET_KEY_PREFIX = "site.";
/**
 * Valeurs montrées UNE seule fois par le site (clé et secret des affiliés, adresse d'un postback qui porte son jeton,
 * lien d'invitation ou de réinitialisation) : champ de `data` par opération. Kevin les envoie à l'admin EN PRIVÉ,
 * dans un message à part (jamais dans le groupe, jamais à l'IA, jamais dans sa mémoire) ; sans cela elles seraient
 * perdues (l'ancienne clé ne marche déjà plus).
 */
export const SITE_ONE_TIME_DATA: Readonly<Record<string, string>> = {
  "connecteurs.affilies_cle": "value",
  "connecteurs.affilies_secret": "value",
  "reglages.postback_creer": "url",
  "reglages.postback_nouvelle_adresse": "url",
  "equipe.inviter": "inviteUrl",
  "equipe.mot_de_passe_lien": "inviteUrl",
};
