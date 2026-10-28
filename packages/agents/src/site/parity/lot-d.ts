/**
 * Phase 34 — correspondance des actions serveur du lot D (« <fichier relatif à apps/web>#<fonction> »).
 *
 * Correspondances de catalogue : l'entrée de Kevin appelle la MÊME fonction métier que l'action du site, qui n'y
 * ajoute que la lecture du formulaire, le rôle et la redirection (droits de Kevin : `boss/team/rights.ts`, une action
 * à confirmer reste à l'admin) :
 * - pause / reprise d'une équipe et pause générale → `setTeamPaused` (catalogue « pause », « reprise » ; « tout ») ;
 * - niveau d'autonomie → `setAutonomyLevel` (« niveau », hausse confirmée par OUI) ;
 * - simulation / vrai → `setSimulation` (« simulation », passage en vrai confirmé par OUI) ;
 * - Publier / Corriger / Refuser un post → `decideValidation` (« valider_post », « corriger_post », « refuser_post »).
 * Tout le reste : une opération du site (cœur unique dans `apps/web/lib/site-ops/ops/lot-d/*`).
 */
import type { SiteParityEntry } from "../contract";

const A = (file: string, fn: string) => `app/(admin)/${file}#${fn}`;

export const LOT_D_PARITY: Record<string, SiteParityEntry> = {
  // Agents (tableau de bord, fiches d'équipe)
  [A("agents/actions.ts", "createTestMissionAction")]: { op: "agents.mission_test" },
  [A("agents/actions.ts", "setTeamPausedAction")]: { catalog: "pause" },
  [A("agents/actions.ts", "setAutonomyLevelAction")]: { catalog: "niveau" },
  [A("agents/actions.ts", "setSimulationAction")]: { catalog: "simulation" },
  [A("agents/[equipe]/actions.ts", "saveTeamSettingsAction")]: { op: "agents.equipe_reglages" },
  [A("agents/[equipe]/actions.ts", "saveChannelPlanAction")]: { op: "agents.plan_canal" },
  [A("agents/[equipe]/actions.ts", "createTestPostAction")]: { op: "agents.post_test_rencontres" },
  [A("agents/[equipe]/actions.ts", "startBenchAction")]: { op: "agents.banc_essai" },
  // Paris sportifs
  [A("agents/[equipe]/sports-actions.ts", "saveBetCategoryAction")]: { op: "univers.categorie_paris_regler" },
  [A("agents/[equipe]/sports-actions.ts", "createTestBetAction")]: { op: "agents.pari_test" },
  [A("agents/[equipe]/sports-actions.ts", "saveBookmakerCredentialsAction")]: { op: "univers.bookmaker_identifiants" },
  [A("agents/[equipe]/sports-actions.ts", "deleteBookmakerCredentialsAction")]: { op: "univers.bookmaker_identifiants_retirer" },
  [A("agents/[equipe]/sports-actions.ts", "testBookmakerConnectionAction")]: { op: "univers.bookmaker_tester_connexion" },
  [A("agents/[equipe]/sports-actions.ts", "saveScreenshotProxyAction")]: { op: "univers.proxy_capture" },
  [A("agents/[equipe]/sports-actions.ts", "deleteScreenshotProxyAction")]: { op: "univers.proxy_capture_retirer" },
  // Casino
  [A("agents/[equipe]/casino-actions.ts", "classifyCasinoMediaAction")]: { op: "univers.media_casino_classer" },
  [A("agents/[equipe]/casino-actions.ts", "createCasinoTestPostAction")]: { op: "agents.post_test_casino" },
  [A("agents/[equipe]/casino-actions.ts", "addCasinoThemeAction")]: { op: "univers.theme_casino_ajouter" },
  [A("agents/[equipe]/casino-actions.ts", "renameCasinoThemeAction")]: { op: "univers.theme_casino_renommer" },
  [A("agents/[equipe]/casino-actions.ts", "removeCasinoThemeAction")]: { op: "univers.theme_casino_retirer" },
  // Algorithme
  [A("agents/[equipe]/algo-actions.ts", "recommendationAction")]: { op: "agents.algo_proposition" },
  [A("agents/[equipe]/algo-actions.ts", "runAlgoReportNowAction")]: { op: "agents.algo_rapport" },
  [A("agents/[equipe]/algo-actions.ts", "saveAlgoSettingsAction")]: { op: "agents.algo_reglages" },
  // Réglages des agents
  [A("agents/settings/actions.ts", "saveSecretAction")]: { op: "reglages.agents_cle" },
  [A("agents/settings/actions.ts", "verifySecretAction")]: { op: "reglages.agents_cle_verifier" },
  [A("agents/settings/actions.ts", "deleteSecretAction")]: { op: "reglages.agents_cle_retirer" },
  [A("agents/settings/actions.ts", "saveGeneralSettingsAction")]: { op: "agents.reglages_generaux" },
  [A("agents/settings/actions.ts", "saveAllBudgetsAction")]: { op: "agents.budget_fournisseur" },
  [A("agents/settings/actions.ts", "setPausedAllAction")]: { catalog: "pause" },
  // Validations et demandes
  [A("agents/validations/actions.ts", "decideValidationAction")]: { catalog: "valider_post" },
  [A("agents/validations/actions.ts", "answerHumanRequestAction")]: { op: "agents.demande_repondre" },
  [A("agents/validations/actions.ts", "skipHumanRequestAction")]: { op: "agents.demande_passer" },
  [A("agents/validations/actions.ts", "relaunchHumanRequestAction")]: { op: "agents.demande_relancer" },
  // Bookmakers
  [A("agents/bookmakers/actions.ts", "testSiteAction")]: { op: "agents.bookmaker_tester" },
  [A("agents/bookmakers/actions.ts", "relearnSiteAction")]: { op: "agents.bookmaker_reapprendre" },
  [A("agents/bookmakers/actions.ts", "openBrowserAction")]: { op: "agents.bookmaker_navigateur" },
  [A("agents/bookmakers/actions.ts", "setSiteUrlAction")]: { op: "agents.bookmaker_adresse" },
  [A("agents/bookmakers/actions.ts", "setSiteTargetAction")]: { op: "agents.bookmaker_cible" },
  [A("agents/bookmakers/actions.ts", "toggleSiteActiveAction")]: { op: "agents.bookmaker_activer" },
  // Agent Ads
  [A("agents/ads/actions.ts", "markAdsRecommendationAction")]: { op: "agents.ads_recommandation" },
  [A("agents/ads/actions.ts", "saveAdsThresholdsAction")]: { op: "agents.ads_seuils" },
  [A("agents/ads/actions.ts", "saveAdsAlertSettingsAction")]: { op: "agents.ads_alertes" },
  // Ordres, Kevin
  [A("agents/orders/actions.ts", "stopOrderAction")]: { op: "agents.ordre_arreter" },
  [A("agents/orders/actions.ts", "extendOrderAction")]: { op: "agents.ordre_prolonger" },
  [A("agents/boss/actions.ts", "saveBossBudgetAction")]: { op: "agents.kevin_plafond" },
  [A("agents/boss/actions.ts", "saveBossNameAction")]: { op: "agents.kevin_prenom" },
  // Réglages → IA d'écriture et IA de conversation
  [A("settings/ai/actions.ts", "saveAiSettingsAction")]: { op: "reglages.ia" },
  [A("settings/ai/actions.ts", "verifyAiKeyAction")]: { op: "reglages.ia_verifier" },
  [A("settings/ai/actions.ts", "removeAiKeyAction")]: { op: "reglages.ia_cle_retirer" },
  [A("settings/assistant/actions.ts", "saveAssistantSettingsAction")]: { op: "reglages.assistant" },
  [A("settings/assistant/actions.ts", "verifyAssistantKeyAction")]: { op: "reglages.assistant_verifier" },
  [A("settings/assistant/actions.ts", "removeAssistantKeyAction")]: { op: "reglages.assistant_cle_retirer" },
};
