/** Phase 34 — correspondance des actions serveur du lot B (« <fichier relatif à apps/web>#<fonction> »). */
import type { SiteParityEntry } from "../contract";

const A = "app/(admin)/channels/actions.ts";
const F = "app/(admin)/channels/[id]/actions.ts";
const Q = "app/(admin)/channels/[id]/sequences/actions.ts";
const L = "app/(admin)/channels/[id]/share-links-actions.ts";
const W = "lib/approval/resend-welcome-action.ts";
const M = "app/(admin)/messages/actions.ts";
const MV = "app/(admin)/messages/move-action.ts";
const E = "app/(admin)/messages/emojis/actions.ts";
const CI = "app/(admin)/messages/categories/inline-actions.ts";
const C = "app/(admin)/settings/categories/actions.ts";
const P = "app/(admin)/pages/actions.ts";
const T = "app/(admin)/settings/tags/actions.ts";

export const LOT_B_PARITY: Record<string, SiteParityEntry> = {
  [`${A}#updateChannelAction`]: { op: "canaux.regler" },
  [`${A}#addChannelByLinkAction`]: { op: "canaux.ajouter" },
  [`${A}#recheckAllRightsAction`]: { op: "canaux.droits_reverifier_tous" },
  [`${A}#importChannelsFromAccountAction`]: { op: "canaux.importer_compte" },

  [`${F}#saveRuleAction`]: { op: "canaux.regle_enregistrer" },
  [`${F}#applyRuleToPendingAction`]: { op: "canaux.regle_appliquer_attente" },
  [`${F}#checkGateLinksAction`]: { op: "canaux.liens_verifier" },
  [`${F}#saveExceptionAction`]: { op: "canaux.exception_enregistrer" },
  [`${F}#toggleExceptionAction`]: { op: "canaux.exception_activer" },
  [`${F}#deleteExceptionAction`]: { op: "canaux.exception_supprimer" },
  [`${F}#moveExceptionAction`]: { op: "canaux.exception_deplacer" },
  [`${F}#reorderExceptionsAction`]: { op: "canaux.exceptions_ordonner" },
  [`${F}#approveMembershipAction`]: { op: "canaux.demande_accepter" },
  [`${F}#approveAllRequestsAction`]: { op: "canaux.demandes_tout_accepter" },
  [`${F}#declineMembershipAction`]: { op: "canaux.demande_refuser" },
  [`${F}#recomputeBestHoursAction`]: { op: "canaux.meilleurs_horaires" },
  [`${F}#recheckRightsAction`]: { op: "canaux.droits_reverifier" },

  [`${Q}#saveSequenceTextAction`]: { op: "canaux.accueil_texte" },
  [`${Q}#saveSequenceTranslationsAction`]: { op: "canaux.accueil_traductions" },
  [`${Q}#addSequenceLangAction`]: { op: "canaux.accueil_langue_ajouter" },
  [`${Q}#removeSequenceLangAction`]: { op: "canaux.accueil_langue_retirer" },
  [`${Q}#toggleSequenceAction`]: { op: "canaux.accueil_activer" },
  [`${Q}#setSequenceMediaAction`]: { op: "canaux.accueil_media" },
  [`${Q}#sendSequenceTestAction`]: { op: "canaux.accueil_tester" },

  [`${L}#createShareLinkAction`]: { op: "canaux.lien_partage_creer" },
  [`${L}#disableShareLinkAction`]: { op: "canaux.lien_partage_desactiver" },
  [`${W}#resendGateWelcomeAction`]: { op: "canaux.accueil_renvoyer" },

  [`${M}#createPostAction`]: { op: "messages.programmer" },
  [`${M}#updatePostAction`]: { op: "messages.modifier" },
  [`${M}#cancelPostAction`]: { op: "messages.annuler" },
  [`${M}#shiftPostAction`]: { op: "messages.decaler" },
  [`${M}#deleteOnTelegramAction`]: { op: "messages.supprimer_telegram" },
  [`${M}#discardPostAction`]: { op: "messages.retirer" },
  [`${M}#saveAsTemplateAction`]: { op: "messages.modele_enregistrer" },
  [`${M}#createTextOfferLinkAction`]: { op: "messages.lien_offre_texte" },
  [`${M}#checkAccountPublishAction`]: { op: "messages.compte_verifier" },
  [`${M}#accountPublishStatusAction`]: { op: "messages.compte_etat" },
  [`${MV}#movePostAction`]: { op: "messages.deplacer" },

  [`${E}#importPackAction`]: { op: "messages.emojis_pack_importer" },
  [`${E}#requestAccountImportAction`]: { op: "messages.emojis_compte_importer" },
  [`${E}#retryPreviewsAction`]: { op: "messages.emojis_apercus" },
  [`${E}#hideEmojiAction`]: { op: "messages.emoji_retirer" },
  [`${E}#restoreEmojiAction`]: { op: "messages.emoji_remettre" },
  [`${CI}#createCategoryInlineAction`]: { op: "messages.categorie_creer" },

  [`${C}#createCategoryAction`]: { op: "reglages.categorie_creer" },
  [`${C}#updateCategoryAction`]: { op: "reglages.categorie_modifier" },
  [`${C}#deleteCategoryAction`]: { op: "reglages.categorie_supprimer" },

  [`${P}#saveLandingPageAction`]: { op: "pages.creer" },
  [`${P}#retryLandingLinksAction`]: { op: "pages.liens_reessayer" },
  [`${P}#deleteLandingPageAction`]: { op: "pages.supprimer" },

  [`${T}#createTagAction`]: { op: "reglages.etiquette_creer" },
  [`${T}#updateTagAction`]: { op: "reglages.etiquette_modifier" },
  [`${T}#deleteTagAction`]: { op: "reglages.etiquette_supprimer" },
};
