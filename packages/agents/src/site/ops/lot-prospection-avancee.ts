/**
 * Phase 32 — métadonnées pour Kevin des opérations des pages avancées de la Prospection (alertes, réseaux, affiliés
 * signés, calibrage, recherche par compte réel ; règle de la phase 34, voir `../contract.ts`). Cœurs :
 * `apps/web/lib/site-ops/ops/lot-prospection/advanced.ts`. Les raccourcis du catalogue de l'équipe (« alertes du
 * jour », « réseau de @x », « combien vaut @x ? ») restent ceux de Kevin ; ces opérations sont celles des boutons du
 * site, avec les mêmes refus. AUCUNE ne contacte un canal ou une personne, AUCUNE n'écrit dans Link Affi.
 * Calibrage : administrateurs, OUI (les estimations changent). Rallumer la recherche par compte réel n'est PAS une
 * opération du site (Kevin seul, avec confirmation) : le site peut seulement la couper.
 */
import type { SiteOpMeta } from "../contract";

type Schema = Record<string, unknown>;
const s = (description: string): Schema => ({ type: "string", description });
const list = (description: string): Schema => ({ type: "array", items: { type: "string" }, description });
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const WEB = (fn: string) => `app/(admin)/agents/prospection/advanced-actions.ts#${fn}`;

const CANAL = s("Canal de la prospection : son @nom, son lien t.me, son titre ou son identifiant");
const ACTION = { type: "string", enum: ["couper", "rétablir"], description: "Couper (par défaut) ou rétablir" };

export const LOT_PROSPECTION_AVANCEE_OPS: SiteOpMeta[] = [
  {
    key: "agents.prospection_alerte_vue",
    domain: "agents",
    description: "Marquer vue une alerte de la veille de la prospection (elle sort de la liste à voir)",
    examples: ["vu pour l'alerte 2", "j'ai vu l'alerte sur @parisfoot"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({ alerte: s("Numéro de l'alerte dans la liste des alertes à voir (la plus récente = 1) ou son identifiant") }, ["alerte"]),
    serverActions: [WEB("markAlertSeenAction")],
  },
  {
    key: "agents.prospection_alertes_canal",
    domain: "agents",
    description: "Ne plus recevoir d'alerte de la veille pour un canal de la prospection (« plus pour ce canal »), ou les rétablir ; le canal reste suivi",
    examples: ["plus d'alerte pour @parisfoot", "remets les alertes de @tipsitalia"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({ canal: CANAL, action: ACTION }, ["canal"]),
    serverActions: [WEB("muteProspectAlertsAction")],
  },
  {
    key: "agents.prospection_alertes_type",
    domain: "agents",
    description:
      "Couper ou rétablir un type d'alerte de la veille pour tous les canaux (a lâché une marque, nouvelle marque, en forte hausse, en baisse, ne publie plus, vend de la pub, contact changé, niveau en hausse ou en baisse, affilié qui ne poste pas nos liens, qui pousse un concurrent, phrase à risque)",
    examples: ["plus d'alertes de ce type : en baisse", "coupe les alertes contact changé", "rétablis les alertes en forte hausse"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({ type: s("Type d'alerte, en mots (« en baisse », « contact changé »…)"), action: ACTION }, ["type"]),
    serverActions: [WEB("muteAlertKindAction"), WEB("unmuteAlertKindAction")],
  },
  {
    key: "agents.prospection_reseau_fusionner",
    domain: "agents",
    description: "Regrouper plusieurs canaux de la prospection en un réseau (« c'est la même personne ») : une seule ligne, un seul accord à négocier",
    examples: ["@a et @b c'est la même personne", "regroupe @pronos1, @pronos2 et @pronos3 en un réseau"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({ canaux: list("Canaux à regrouper : au moins deux @noms ou liens t.me") }, ["canaux"]),
    serverActions: [WEB("mergeProspectsAction")],
  },
  {
    key: "agents.prospection_reseau_separer",
    domain: "agents",
    description: "Sortir un canal de son réseau (l'équipe ne le regroupera plus avec ces canaux)",
    examples: ["sépare @parisfoot de son réseau", "@tipsitalia n'est pas la même personne"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({ canal: CANAL }, ["canal"]),
    serverActions: [WEB("splitProspectAction")],
  },
  {
    key: "agents.prospection_affilie_rattacher",
    domain: "agents",
    description: "Rattacher un canal signé à son identifiant d'affilié Link Affi, pour lire ses vrais résultats chaque mois (lecture seule)",
    examples: ["@parisfoot = affilié 1234", "rattache @tipsitalia à l'affilié 5678"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({ canal: CANAL, affilie: s("Identifiant de l'affilié dans Link Affi") }, ["canal", "affilie"]),
    serverActions: [WEB("linkAffiliateAction")],
  },
  {
    key: "agents.prospection_calibrage_appliquer",
    domain: "agents",
    description: "Appliquer des propositions de calibrage de la valeur estimée (coefficients, poids de la note, répartition des recherches), dans les bornes, annulable",
    examples: ["applique 1 et 3", "applique le calibrage 2"],
    kind: "setting",
    role: "ADMIN",
    confirm: "yes",
    params: obj({ choix: list("Numéros des propositions à appliquer (la plus ancienne = 1)") }, ["choix"]),
    serverActions: [WEB("applyCalibrationAction")],
  },
  {
    key: "agents.prospection_calibrage_annuler",
    domain: "agents",
    description: "Annuler le dernier calibrage appliqué (les estimations reprennent les coefficients d'avant)",
    examples: ["annule le calibrage", "reviens au calibrage d'avant"],
    kind: "setting",
    role: "ADMIN",
    confirm: "yes",
    params: obj({}),
    serverActions: [WEB("undoCalibrationAction")],
  },
  {
    key: "agents.prospection_recherche_compte_couper",
    domain: "agents",
    description: "Couper la recherche de canaux par compte Telegram réel (la rallumer demande une confirmation à Kevin)",
    examples: ["coupe la recherche par compte", "arrête de chercher avec le compte"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({}),
    serverActions: [WEB("stopAccountSearchAction")],
  },
];
