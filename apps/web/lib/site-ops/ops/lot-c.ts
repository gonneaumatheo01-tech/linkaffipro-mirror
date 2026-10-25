/** Phase 34 — cœurs des opérations du lot C (fonctions uniques appelées par le site et par Kevin). */
import type { SiteOpImpl } from "@linkaffipro/agents";
import { implOf } from "./lot-c/common";
import {
  addAd,
  addAdSet,
  addEntryLink,
  addManualCost,
  addOffer,
  attachImportedCampaign,
  attachLinkToAd,
  createCampaignWizard,
  deleteAd,
  deleteAdSet,
  deleteCampaign,
  dismissAffiliatesTutorial,
  removeOffer,
  updateCampaign,
  updateCampaignChannels,
} from "./lot-c/campaigns";
import { createEntryLinks, createGeneric, toggleLink } from "./lot-c/links";
import { confirmImport, previewImport } from "./lot-c/imports";
import {
  addNote,
  anonymizeMember,
  changeAffiliate,
  deleteNote,
  editNote,
  removeAffiliate,
  setMemberTags,
} from "./lot-c/members";
import {
  cancelBroadcast,
  createAndTest,
  createBroadcast,
  deleteDraft,
  schedule,
  sendNow,
  sendWinnerToRest,
  testToMe,
} from "./lot-c/broadcasts";
import {
  deleteRule,
  duplicateRule,
  saveCard,
  saveRuleCore,
  testRuleOnMe,
  toggleRule,
} from "./lot-c/automations";
import {
  block,
  close,
  deletePersonaCore,
  markHandled,
  release,
  savePersonaCore,
  savePersonaMediaCore,
  sendTeam,
  takeOver,
} from "./lot-c/conversations";
import { recomputeStats } from "./lot-c/dashboard";

export const LOT_C_IMPL: SiteOpImpl[] = [
  // Campagnes, liens, offres, affiliés, imports
  implOf("campagnes.creer", createCampaignWizard),
  implOf("campagnes.modifier", updateCampaign),
  implOf("campagnes.supprimer", deleteCampaign),
  implOf("campagnes.canaux", updateCampaignChannels),
  implOf("campagnes.offre_ajouter", addOffer),
  implOf("campagnes.offre_retirer", removeOffer),
  implOf("campagnes.groupe_ajouter", addAdSet),
  implOf("campagnes.groupe_supprimer", deleteAdSet),
  implOf("campagnes.pub_ajouter", addAd),
  implOf("campagnes.pub_supprimer", deleteAd),
  implOf("campagnes.pub_lien", attachLinkToAd),
  implOf("campagnes.lien_entree", addEntryLink),
  implOf("campagnes.rattacher_pub_importee", attachImportedCampaign),
  implOf("campagnes.depense_ajouter", addManualCost),
  implOf("campagnes.lien_suivi", createEntryLinks),
  implOf("campagnes.lien_generique", createGeneric),
  implOf("campagnes.lien_activer", toggleLink),
  implOf("campagnes.import_apercu", previewImport),
  implOf("campagnes.importer_couts", confirmImport),
  implOf("campagnes.tutoriel_affilies_masquer", dismissAffiliatesTutorial),
  // Statistiques
  implOf("statistiques.recalculer", recomputeStats),
  // Membres
  implOf("membres.note_ajouter", addNote),
  implOf("membres.note_modifier", editNote),
  implOf("membres.note_supprimer", deleteNote),
  implOf("membres.etiquettes", setMemberTags),
  implOf("membres.anonymiser", anonymizeMember),
  implOf("membres.affilie_changer", changeAffiliate),
  implOf("membres.affilie_retirer", removeAffiliate),
  // Envois groupés
  implOf("envois.creer", createBroadcast),
  implOf("envois.creer_et_tester", createAndTest),
  implOf("envois.envoyer_maintenant", sendNow),
  implOf("envois.programmer", schedule),
  implOf("envois.annuler", cancelBroadcast),
  implOf("envois.tester_sur_moi", testToMe),
  implOf("envois.gagnante_au_reste", sendWinnerToRest),
  implOf("envois.supprimer", deleteDraft),
  // Relances automatiques
  implOf("automatisations.enregistrer", saveRuleCore("editor")),
  implOf("automatisations.carte", saveCard),
  implOf("automatisations.activer", toggleRule),
  implOf("automatisations.dupliquer", duplicateRule),
  implOf("automatisations.supprimer", deleteRule),
  implOf("automatisations.tester_sur_moi", testRuleOnMe),
  // Conversations de l'assistante
  implOf("conversations.prendre_la_main", takeOver),
  implOf("conversations.rendre", release),
  implOf("conversations.fermer", close),
  implOf("conversations.bloquer", block),
  implOf("conversations.marquer_traitee", markHandled),
  implOf("conversations.ecrire", sendTeam),
  // Personas
  implOf("univers.persona_enregistrer", savePersonaCore),
  implOf("univers.persona_supprimer", deletePersonaCore),
  implOf("univers.persona_medias", savePersonaMediaCore),
];
