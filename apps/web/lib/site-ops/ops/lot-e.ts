/** Phase 34 — cœurs des opérations du lot E (fonctions uniques appelées par le site et par Kevin). */
import type { SiteOpImpl } from "@linkaffipro/agents";
import * as ads from "./lot-e/connectors-ads";
import * as tg from "./lot-e/connectors-telegram";
import * as acc from "./lot-e/accounts";
import * as la from "./lot-e/connectors-linkaffi";
import * as team from "./lot-e/team";
import * as pb from "./lot-e/postbacks";
import * as al from "./lot-e/alerts";
import * as bots from "./lot-e/bots";
import * as st from "./lot-e/status";
import type { CoreRun } from "./lot-e/common";

const op = (key: string, run: CoreRun): SiteOpImpl => ({ key, run: (input, actor, opts) => run(input, actor, opts) });

export const LOT_E_IMPL: SiteOpImpl[] = [
  // Connecteurs : TikTok
  op("connecteurs.tiktok_application", ads.tiktokSaveApp),
  op("connecteurs.tiktok_verifier", ads.tiktokVerify),
  op("connecteurs.tiktok_connecter", ads.tiktokConnect),
  op("connecteurs.tiktok_comptes_proposes", ads.tiktokPendingAccounts),
  op("connecteurs.tiktok_choisir_comptes", ads.tiktokChooseAccounts),
  op("connecteurs.tiktok_annuler_connexion", ads.tiktokCancelPending),
  op("connecteurs.tiktok_bac_a_sable", ads.tiktokSandbox),
  op("connecteurs.tiktok_synchroniser", ads.tiktokSync),
  op("connecteurs.tiktok_deconnecter", ads.tiktokDisconnect),
  // Connecteurs : Meta
  op("connecteurs.meta_application", ads.metaSaveApp),
  op("connecteurs.meta_verifier", ads.metaVerify),
  op("connecteurs.meta_connecter", ads.metaConnect),
  op("connecteurs.meta_comptes_proposes", ads.metaPendingAccounts),
  op("connecteurs.meta_choisir_comptes", ads.metaChooseAccounts),
  op("connecteurs.meta_annuler_connexion", ads.metaCancelPending),
  op("connecteurs.meta_synchroniser", ads.metaSync),
  op("connecteurs.meta_deconnecter", ads.metaDisconnect),
  // Connecteurs : compte Telegram des vues
  op("connecteurs.telegram_application", tg.telegramSaveUserApi),
  op("connecteurs.telegram_envoyer_code", tg.telegramSendCode),
  op("connecteurs.telegram_mot_de_passe", tg.telegramCheckPassword),
  op("connecteurs.telegram_deconnecter", tg.telegramDisconnect),
  op("connecteurs.telegram_relever_vues", tg.telegramPollNow),
  // Connecteurs : vrais comptes Telegram (Réglages → Comptes)
  op("connecteurs.compte_ajouter", acc.accountAdd),
  op("connecteurs.compte_mot_de_passe", acc.accountSubmitPassword),
  op("connecteurs.compte_activer", acc.accountToggle),
  op("connecteurs.compte_persona", acc.accountSetPersona),
  op("connecteurs.compte_verifier", acc.accountRefresh),
  op("connecteurs.compte_deconnecter", acc.accountDisconnect),
  // Connecteurs : Link Affi et affiliés
  op("connecteurs.linkaffi_synchroniser", la.linkaffiSyncNow),
  op("connecteurs.affilies_cle", la.linkaffiKeyGenerate),
  op("connecteurs.affilies_secret", la.linkaffiSecretGenerate),
  op("connecteurs.affilies_adresse", la.linkaffiEventsUrlSave),
  op("connecteurs.affilies_test", la.linkaffiTestEvent),
  // Réglages
  op("reglages.niveaux_depense", la.spendThresholdsSave),
  op("reglages.taux_change", la.ratesSave),
  op("reglages.postback_creer", pb.postbackCreate),
  op("reglages.postback_modifier", pb.postbackUpdate),
  op("reglages.postback_activer", pb.postbackToggle),
  op("reglages.postback_nouvelle_adresse", pb.postbackRegenerateToken),
  op("reglages.postback_tester", pb.postbackTest),
  op("reglages.postback_import_apercu", pb.playersImportPreview),
  op("reglages.postback_importer", pb.playersImport),
  op("reglages.alertes_ouvertes", al.alertsOpen),
  op("reglages.alerte_resoudre", al.alertResolve),
  op("reglages.alertes_seuils", al.alertThresholdsSave),
  op("reglages.alertes_verifier", al.alertsCheckNow),
  op("reglages.conservation", al.retentionSave),
  op("reglages.purge", al.purgeNow),
  op("reglages.bot_ajouter", bots.botAdd),
  op("reglages.bot_connexion", bots.botResyncWebhook),
  op("reglages.bot_activer", bots.botToggle),
  op("reglages.bot_mode", bots.botSetMode),
  op("reglages.tache_relancer", st.jobRetry),
  op("reglages.taches_echouees_effacer", st.failedJobsClean),
  op("reglages.missions_relancer", st.agentMissionsResume),
  op("reglages.rapports", st.reportsConfigSave),
  op("reglages.rapport_envoyer", st.reportSendNow),
  // Équipe
  op("equipe.lister", team.teamList),
  op("equipe.inviter", team.teamInvite),
  op("equipe.invitation_annuler", team.teamRevokeInvitation),
  op("equipe.role", team.teamSetRole),
  // « Retirer » = désactiver le compte (aucune suppression d'utilisateur sur le site) ; « réactiver » = l'inverse.
  op("equipe.retirer", (input, actor, opts) => team.teamToggleUser({ ...input, active: false }, actor, opts)),
  op("equipe.reactiver", (input, actor, opts) => team.teamToggleUser({ ...input, active: true }, actor, opts)),
  op("equipe.mot_de_passe_lien", team.teamResetPassword),
];
