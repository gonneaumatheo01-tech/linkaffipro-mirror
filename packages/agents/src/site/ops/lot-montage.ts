/**
 * Phase 28 — métadonnées pour Kevin des opérations de la page Agents → Montage (règle de la phase 34, voir
 * `../contract.ts`). Cœurs : `apps/web/lib/site-ops/ops/lot-montage.ts`. Les boutons ✅ / ✏️ / ❌ d'un aperçu et les
 * entrées de catalogue de l'équipe (`montage_video`, `modifier_short`, `annuler_montage`…) restent les raccourcis de
 * Kevin ; ces opérations sont celles du site, avec les mêmes refus.
 * Refuser = archivé (rien n'est supprimé) : pas de confirmation. Annuler un montage arrête un travail en cours : OUI.
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
const WEB = (fn: string) => `app/(admin)/agents/montage/actions.ts#${fn}`;

const MONTAGE = s("Montage visé : identifiant, ou rien pour le plus récent");
const SHORT = s("Numéro du short dans le montage (« 3 ») ou son identifiant");

export const LOT_MONTAGE_OPS: SiteOpMeta[] = [
  {
    key: "agents.short_valider",
    domain: "agents",
    description: "Valider un short du montage (il est prêt dans la médiathèque ; rien n'est publié sans un ordre)",
    examples: ["valide le short 3", "le 5 est bon, garde-le"],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: obj({ short: SHORT, montage: MONTAGE }, ["short"]),
    serverActions: [WEB("approveShortAction")],
  },
  {
    key: "agents.short_modifier",
    domain: "agents",
    description: "Faire refaire un short avec une modification (durée, caméra, texte, sous-titres) ; un nouvel aperçu suit",
    examples: ["le short 5, raccourcis de 2 secondes", "refais le 2 avec la cam en bas à gauche"],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: obj({ short: SHORT, modification: s("Ce qu'il faut changer, en une phrase"), montage: MONTAGE }, ["short", "modification"]),
    serverActions: [WEB("modifyShortAction")],
  },
  {
    key: "agents.short_refuser",
    domain: "agents",
    description: "Refuser un short (archivé, pas supprimé)",
    examples: ["refuse le short 4", "le 7 je n'en veux pas"],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: obj({ short: SHORT, raison: s("Pourquoi (facultatif)"), montage: MONTAGE }, ["short"]),
    serverActions: [WEB("rejectShortAction")],
  },
  {
    key: "agents.montage_annuler",
    domain: "agents",
    description: "Annuler un montage en cours (shorts pas encore faits abandonnés, shorts validés gardés)",
    examples: ["annule le montage en cours", "arrête le découpage de la vidéo"],
    kind: "setting",
    role: "ADMIN",
    confirm: "yes",
    params: obj({ montage: MONTAGE }),
    serverActions: [WEB("cancelMontageAction")],
  },
];
