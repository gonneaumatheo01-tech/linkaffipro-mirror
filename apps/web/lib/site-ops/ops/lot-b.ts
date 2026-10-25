/**
 * Phase 34 — cœurs des opérations du lot B (fonctions uniques appelées par le site et par Kevin) : canaux, messages,
 * pages d'atterrissage, étiquettes, catégories. Métadonnées pour Kevin : `packages/agents/src/site/ops/lot-b.ts`.
 */
import type { SiteOpImpl } from "@linkaffipro/agents";
import type { CoreRun } from "./lot-b/common";
import {
  channelAdd,
  channelRecheckRights,
  channelUpdate,
  channelsImportFromAccount,
  channelsRecheckAll,
} from "./lot-b/channel-settings";
import {
  channelBestHoursRecompute,
  channelExceptionDelete,
  channelExceptionMove,
  channelExceptionSave,
  channelExceptionToggle,
  channelExceptionsReorder,
  channelGateLinksCheck,
  channelRequestApprove,
  channelRequestDecline,
  channelRequestsApproveAll,
  channelRuleApplyPending,
  channelRuleSave,
} from "./lot-b/channel-rules";
import {
  sequenceLangAdd,
  sequenceLangRemove,
  sequenceMediaSet,
  sequenceTestSend,
  sequenceTextSave,
  sequenceToggle,
  sequenceTranslationsSave,
} from "./lot-b/sequences";
import { shareLinkCreate, shareLinkDisable, welcomeResend } from "./lot-b/share-links";
import {
  accountPublishCheck,
  accountPublishStatusRead,
  postCancel,
  postDeleteOnTelegram,
  postDiscard,
  postDraft,
  postMove,
  postSaveAsTemplate,
  postSchedule,
  postShift,
  postUpdate,
  textOfferLinkCreate,
} from "./lot-b/posts";
import { emojiHide, emojiImportAccount, emojiImportPack, emojiRestore, emojiRetryPreviews } from "./lot-b/emojis";
import { categoryCreate, categoryCreateInline, categoryDelete, categoryUpdate } from "./lot-b/categories";
import { pageCreate, pageDelete, pageRetryLinks, pageUpdate } from "./lot-b/pages";
import { tagCreate, tagDelete, tagUpdate } from "./lot-b/tags";

const CORES: Record<string, CoreRun> = {
  "canaux.ajouter": channelAdd,
  "canaux.regler": channelUpdate,
  "canaux.importer_compte": channelsImportFromAccount,
  "canaux.droits_reverifier": channelRecheckRights,
  "canaux.droits_reverifier_tous": channelsRecheckAll,
  "canaux.regle_enregistrer": channelRuleSave,
  "canaux.regle_appliquer_attente": channelRuleApplyPending,
  "canaux.liens_verifier": channelGateLinksCheck,
  "canaux.exception_enregistrer": channelExceptionSave,
  "canaux.exception_activer": channelExceptionToggle,
  "canaux.exception_supprimer": channelExceptionDelete,
  "canaux.exception_deplacer": channelExceptionMove,
  "canaux.exceptions_ordonner": channelExceptionsReorder,
  "canaux.demande_accepter": channelRequestApprove,
  "canaux.demandes_tout_accepter": channelRequestsApproveAll,
  "canaux.demande_refuser": channelRequestDecline,
  "canaux.meilleurs_horaires": channelBestHoursRecompute,
  "canaux.accueil_texte": sequenceTextSave,
  "canaux.accueil_traductions": sequenceTranslationsSave,
  "canaux.accueil_langue_ajouter": sequenceLangAdd,
  "canaux.accueil_langue_retirer": sequenceLangRemove,
  "canaux.accueil_activer": sequenceToggle,
  "canaux.accueil_media": sequenceMediaSet,
  "canaux.accueil_tester": sequenceTestSend,
  "canaux.lien_partage_creer": shareLinkCreate,
  "canaux.lien_partage_desactiver": shareLinkDisable,
  "canaux.accueil_renvoyer": welcomeResend,

  "messages.programmer": postSchedule,
  "messages.brouillon": postDraft,
  "messages.modifier": postUpdate,
  "messages.annuler": postCancel,
  "messages.decaler": postShift,
  "messages.deplacer": postMove,
  "messages.supprimer_telegram": postDeleteOnTelegram,
  "messages.retirer": postDiscard,
  "messages.modele_enregistrer": postSaveAsTemplate,
  "messages.lien_offre_texte": textOfferLinkCreate,
  "messages.compte_verifier": accountPublishCheck,
  "messages.compte_etat": accountPublishStatusRead,
  "messages.emojis_pack_importer": emojiImportPack,
  "messages.emojis_compte_importer": emojiImportAccount,
  "messages.emojis_apercus": emojiRetryPreviews,
  "messages.emoji_retirer": emojiHide,
  "messages.emoji_remettre": emojiRestore,
  "messages.categorie_creer": categoryCreateInline,

  "pages.creer": pageCreate,
  "pages.modifier": pageUpdate,
  "pages.liens_reessayer": pageRetryLinks,
  "pages.supprimer": pageDelete,

  "reglages.etiquette_creer": tagCreate,
  "reglages.etiquette_modifier": tagUpdate,
  "reglages.etiquette_supprimer": tagDelete,
  "reglages.categorie_creer": categoryCreate,
  "reglages.categorie_modifier": categoryUpdate,
  "reglages.categorie_supprimer": categoryDelete,
};

export const LOT_B_IMPL: SiteOpImpl[] = Object.entries(CORES).map(([key, run]) => ({
  key,
  run: (input, actor, opts) => run(input, actor, opts),
}));
