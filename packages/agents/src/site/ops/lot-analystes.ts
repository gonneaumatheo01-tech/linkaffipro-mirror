/**
 * Phase 29 — métadonnées pour Kevin des opérations de la page Agents → Analyses (règle de la phase 34, voir
 * `../contract.ts`). Cœurs : `apps/web/lib/site-ops/ops/lot-analystes.ts`. Les entrées de catalogue de l'équipe
 * Analystes (`analyse_marché`, `tendances`, `compliance`, `sources_veille`…) restent les raccourcis de Kevin ; ces
 * opérations sont celles des boutons du site, avec les mêmes refus.
 * Activer une source (souvent trouvée par la veille) : OUI. Supprimer une source (ses entrées de veille partent avec
 * elle) : SUPPRIMER. Accepter / refuser une recommandation : aucune action externe, pas de confirmation.
 */
import type { SiteOpMeta } from "../contract";

type Schema = Record<string, unknown>;
const s = (description: string): Schema => ({ type: "string", description });
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const WEB = (fn: string) => `app/(admin)/agents/analyses/actions.ts#${fn}`;

const SOURCE = s("Source de la veille : son nom (« BlackHatWorld »), son adresse ou son identifiant");

export const LOT_ANALYSTES_OPS: SiteOpMeta[] = [
  {
    key: "agents.analyses_source_activer",
    domain: "agents",
    description: "Activer une source de la veille (forum, site d'actualité, canal public) : elle est lue au prochain passage",
    examples: ["active la source BlackHatWorld", "ajoute le forum que tu as trouvé à ta veille"],
    kind: "setting",
    role: "ADMIN",
    confirm: "yes",
    params: obj({ source: SOURCE }, ["source"]),
    serverActions: [WEB("activateSourceAction")],
  },
  {
    key: "agents.analyses_source_desactiver",
    domain: "agents",
    description: "Désactiver une source de la veille (elle n'est plus lue, ses entrées restent)",
    examples: ["arrête de lire Reddit r/gambling", "désactive la source iGaming Business"],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: obj({ source: SOURCE }, ["source"]),
    serverActions: [WEB("deactivateSourceAction")],
  },
  {
    key: "agents.analyses_source_supprimer",
    domain: "agents",
    description: "Supprimer une source de la veille et ses entrées (les règles publicitaires et les rapports restent)",
    examples: ["supprime la source STM Forum", "retire complètement ce forum de ta veille"],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: obj({ source: SOURCE }, ["source"]),
    serverActions: [WEB("deleteSourceAction")],
  },
  {
    key: "agents.analyses_recommandation",
    domain: "agents",
    description: "Accepter ou refuser une recommandation de l'analyse de marché (rien n'est changé chez Meta, TikTok, sur les canaux ni les budgets)",
    examples: ["j'accepte la recommandation 2 de l'analyse de marché", "refuse la recommandation sur les pubs dating en Espagne"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        id: s("Identifiant de la recommandation"),
        numero: s("Numéro dans la liste des recommandations à décider (la plus récente = 1)"),
        decision: { type: "string", enum: ["accepter", "refuser"], description: "Accepter ou refuser" },
        commentaire: s("Commentaire (facultatif)"),
      },
      ["decision"],
    ),
    serverActions: [WEB("decideMarketRecommendationAction")],
  },
];
