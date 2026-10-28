/**
 * Phase 34 — cœurs des opérations du lot D (agents et univers, Réglages → IA et assistant de conversation) : fonctions
 * uniques appelées par le site et par Kevin. Chaque opération : paramètres de Kevin → formulaire du site (noms résolus,
 * valeurs actuelles gardées pour ce qu'il ne change pas) → MÊME cœur que l'action serveur (`./lot-d/*`).
 * Métadonnées pour Kevin : `packages/agents/src/site/ops/lot-d.ts` ; correspondance : `packages/agents/src/site/parity/lot-d.ts`.
 */
import type { SiteOpImpl } from "@linkaffipro/agents";
import { formOf, str, type Fail, type SiteOpActor, type SiteOpResult, type SiteOpRunOptions } from "./lot-d/kit";

type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };
type Core = (fd: FormData, actor: SiteOpActor, opts?: SiteOpRunOptions) => Promise<SiteOpResult>;
type In = Record<string, unknown>;

/** Une opération : préparation du formulaire (chargée à la demande) puis le cœur du site. */
function op(key: string, load: () => Promise<{ prepare: (input: In) => Prepared | Promise<Prepared>; core: Core }>): SiteOpImpl {
  return {
    key,
    async run(input, actor, opts) {
      const { prepare, core } = await load();
      const p = await prepare(input ?? {});
      if (!p.ok) return p.result;
      const r = await core(p.fd, actor, opts ?? {});
      // Champs propres au site (capture d'un test de connexion…) : laissés dans `data`, jamais à côté du contrat.
      if (r.ok) return { ok: true, message: r.message, ...(r.data ? { data: r.data } : {}), ...(r.preview ? { preview: r.preview } : {}) };
      return { ok: false, error: r.error, ...(r.field ? { field: r.field } : {}), ...(r.code ? { code: r.code } : {}) };
    },
  };
}

const plain = (fields: (input: In) => In) => (input: In): Prepared => ({ ok: true, fd: formOf(fields(input)) });
const none = plain(() => ({}));

const teams = () => import("./lot-d/teams");
const settings = () => import("./lot-d/settings");
const sports = () => import("./lot-d/sports");
const casino = () => import("./lot-d/casino");
const algo = () => import("./lot-d/algo");
const validations = () => import("./lot-d/validations");
const bookmakers = () => import("./lot-d/bookmakers");
const ads = () => import("./lot-d/ads");
const orders = () => import("./lot-d/orders");
const boss = () => import("./lot-d/boss");
const ai = () => import("./lot-d/ai");
const assistant = () => import("./lot-d/assistant");

export const LOT_D_IMPL: SiteOpImpl[] = [
  // ---------------------------------------------------------------------------------------------- équipes
  op("agents.mission_test", async () => {
    const m = await teams();
    return { prepare: m.kevinTestMissionForm, core: m.runCreateTestMission };
  }),
  op("agents.equipe_reglages", async () => {
    const m = await teams();
    return { prepare: m.kevinTeamSettingsForm, core: m.runSaveTeamSettings };
  }),
  op("agents.plan_canal", async () => {
    const m = await teams();
    return { prepare: m.kevinChannelPlanForm, core: m.runSaveChannelPlan };
  }),
  op("agents.post_test_rencontres", async () => {
    const m = await teams();
    return { prepare: m.kevinTestPostForm, core: m.runCreateTestPost };
  }),
  op("agents.banc_essai", async () => {
    const m = await teams();
    return { prepare: m.kevinBenchForm, core: m.runStartBench };
  }),
  // ------------------------------------------------------------------------------------ réglages des agents
  op("agents.budget_fournisseur", async () => {
    const m = await settings();
    return { prepare: m.kevinBudgetsForm, core: m.runSaveBudgets };
  }),
  op("agents.reglages_generaux", async () => {
    const m = await settings();
    return { prepare: m.kevinGeneralSettingsForm, core: m.runSaveGeneralSettings };
  }),
  op("reglages.agents_cle", async () => {
    const m = await settings();
    return { prepare: (i: In) => m.kevinSecretForm(i, true), core: m.runSaveSecret };
  }),
  op("reglages.agents_cle_verifier", async () => {
    const m = await settings();
    return { prepare: (i: In) => m.kevinSecretForm(i, false), core: m.runVerifySecret };
  }),
  op("reglages.agents_cle_retirer", async () => {
    const m = await settings();
    return { prepare: (i: In) => m.kevinSecretForm(i, false), core: m.runDeleteSecret };
  }),
  // ------------------------------------------------------------------------------------- demandes au client
  op("agents.demande_repondre", async () => {
    const m = await validations();
    return { prepare: (i: In) => m.kevinRequestForm(i, "answer"), core: m.runAnswerHumanRequest };
  }),
  op("agents.demande_passer", async () => {
    const m = await validations();
    return { prepare: (i: In) => m.kevinRequestForm(i, "skip"), core: m.runSkipHumanRequest };
  }),
  op("agents.demande_relancer", async () => {
    const m = await validations();
    return { prepare: (i: In) => m.kevinRequestForm(i, "relaunch"), core: m.runRelaunchHumanRequest };
  }),
  // ------------------------------------------------------------------------------------------ Paris sportifs
  op("univers.categorie_paris_regler", async () => {
    const m = await sports();
    return { prepare: m.kevinBetCategoryForm, core: m.runSaveBetCategory };
  }),
  op("agents.pari_test", async () => {
    const m = await sports();
    return { prepare: m.kevinTestBetForm, core: m.runCreateTestBet };
  }),
  op("univers.bookmaker_identifiants", async () => {
    const m = await sports();
    return { prepare: (i: In) => m.kevinBookmakerForm(i, true), core: m.runSaveBookmakerCredentials };
  }),
  op("univers.bookmaker_identifiants_retirer", async () => {
    const m = await sports();
    return { prepare: (i: In) => m.kevinBookmakerForm(i, false), core: m.runDeleteBookmakerCredentials };
  }),
  op("univers.bookmaker_tester_connexion", async () => {
    const m = await sports();
    return { prepare: (i: In) => m.kevinBookmakerForm(i, false), core: m.runTestBookmakerConnection };
  }),
  op("univers.proxy_capture", async () => {
    const m = await sports();
    return { prepare: plain((i) => ({ proxy: str(i.proxy) })), core: m.runSaveScreenshotProxy };
  }),
  op("univers.proxy_capture_retirer", async () => {
    const m = await sports();
    return { prepare: none, core: m.runDeleteScreenshotProxy };
  }),
  // ------------------------------------------------------------------------------------------------- Casino
  op("univers.media_casino_classer", async () => {
    const m = await casino();
    return { prepare: m.kevinClassifyForm, core: m.runClassifyCasinoMedia };
  }),
  op("agents.post_test_casino", async () => {
    const m = await casino();
    return { prepare: m.kevinCasinoTestPostForm, core: m.runCreateCasinoTestPost };
  }),
  op("univers.theme_casino_ajouter", async () => {
    const m = await casino();
    return { prepare: (i: In) => m.kevinThemeForm(i, false), core: m.runAddCasinoTheme };
  }),
  op("univers.theme_casino_renommer", async () => {
    const m = await casino();
    return { prepare: (i: In) => m.kevinThemeForm(i, true), core: m.runRenameCasinoTheme };
  }),
  op("univers.theme_casino_retirer", async () => {
    const m = await casino();
    return { prepare: (i: In) => m.kevinThemeForm(i, true), core: m.runRemoveCasinoTheme };
  }),
  // --------------------------------------------------------------------------------------------- Algorithme
  op("agents.algo_proposition", async () => {
    const m = await algo();
    return { prepare: m.kevinRecommendationForm, core: m.runRecommendation };
  }),
  op("agents.algo_rapport", async () => {
    const m = await algo();
    return { prepare: none, core: m.runAlgoReport };
  }),
  op("agents.algo_reglages", async () => {
    const m = await algo();
    return { prepare: m.kevinAlgoSettingsForm, core: m.runSaveAlgoSettings };
  }),
  // ---------------------------------------------------------------------------------------------- Bookmakers
  op("agents.bookmaker_tester", async () => {
    const m = await bookmakers();
    return { prepare: m.kevinSiteForm, core: m.runTestSite };
  }),
  op("agents.bookmaker_reapprendre", async () => {
    const m = await bookmakers();
    return { prepare: m.kevinSiteForm, core: m.runRelearnSite };
  }),
  op("agents.bookmaker_navigateur", async () => {
    const m = await bookmakers();
    return { prepare: m.kevinSiteForm, core: m.runOpenBrowser };
  }),
  op("agents.bookmaker_adresse", async () => {
    const m = await bookmakers();
    return { prepare: m.kevinSiteForm, core: m.runSetSiteUrl };
  }),
  op("agents.bookmaker_cible", async () => {
    const m = await bookmakers();
    return { prepare: m.kevinSiteTargetForm, core: m.runSetSiteTarget };
  }),
  op("agents.bookmaker_activer", async () => {
    const m = await bookmakers();
    return { prepare: m.kevinSiteActiveForm, core: m.runToggleSiteActive };
  }),
  // ----------------------------------------------------------------------------------------------- Agent Ads
  op("agents.ads_recommandation", async () => {
    const m = await ads();
    return { prepare: m.kevinAdsMarkForm, core: m.runMarkAdsRecommendation };
  }),
  op("agents.ads_seuils", async () => {
    const m = await ads();
    return { prepare: m.kevinAdsThresholdsForm, core: m.runSaveAdsThresholds };
  }),
  op("agents.ads_alertes", async () => {
    const m = await ads();
    return { prepare: m.kevinAdsAlertsForm, core: m.runSaveAdsAlertSettings };
  }),
  // ------------------------------------------------------------------------------------------------------ ordres
  op("agents.ordre_arreter", async () => {
    const m = await orders();
    return { prepare: m.kevinOrderForm, core: m.runStopOrder };
  }),
  op("agents.ordre_prolonger", async () => {
    const m = await orders();
    return { prepare: m.kevinOrderForm, core: m.runExtendOrder };
  }),
  // --------------------------------------------------------------------------------------------------- Kevin
  op("agents.kevin_plafond", async () => {
    const m = await boss();
    return { prepare: plain((i) => ({ euros: i.euros })), core: m.runSaveBossBudget };
  }),
  op("agents.kevin_prenom", async () => {
    const m = await boss();
    return { prepare: plain((i) => ({ name: i.name ?? i.prenom })), core: m.runSaveBossName };
  }),
  // ------------------------------------------------------------------------------------ Réglages → IA d'écriture
  op("reglages.ia", async () => {
    const m = await ai();
    return { prepare: (i: In) => m.kevinAiForm(i, false), core: m.runSaveAiSettings };
  }),
  op("reglages.ia_cle", async () => {
    const m = await ai();
    return { prepare: (i: In) => m.kevinAiForm(i, true), core: m.runSaveAiSettings };
  }),
  op("reglages.ia_verifier", async () => {
    const m = await ai();
    return { prepare: none, core: m.runVerifyAiKey };
  }),
  op("reglages.ia_cle_retirer", async () => {
    const m = await ai();
    return { prepare: none, core: m.runRemoveAiKey };
  }),
  // --------------------------------------------------------------------------- Réglages → IA de conversation
  op("reglages.assistant", async () => {
    const m = await assistant();
    return { prepare: (i: In) => m.kevinAssistantForm(i, false), core: m.runSaveAssistantSettings };
  }),
  op("reglages.assistant_cle", async () => {
    const m = await assistant();
    // Comme « Vérifier » avec une clé collée : enregistrée chiffrée d'abord, puis vérifiée (sans dépense).
    return { prepare: plain((i) => ({ apiKey: str(i.apiKey) })), core: m.runVerifyAssistantKey };
  }),
  op("reglages.assistant_verifier", async () => {
    const m = await assistant();
    return { prepare: none, core: m.runVerifyAssistantKey };
  }),
  op("reglages.assistant_cle_retirer", async () => {
    const m = await assistant();
    return { prepare: none, core: m.runRemoveAssistantKey };
  }),
];
