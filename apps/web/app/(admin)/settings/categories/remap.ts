/**
 * Suppression ou fusion d'une catégorie : mise à jour des références stockées en JSON
 * (`AutomationRule.conditions.categoryIds`, `Broadcast.segment.clickedCategoryIds`).
 * Une liste vidée par une suppression sans remplacement élargirait la cible à « toutes les catégories » :
 * la règle est alors désactivée et l'envoi programmé repasse en brouillon (contrôle humain avant tout envoi).
 */
type Json = Record<string, unknown>;

const asObject = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Json) } : {};

export function remapCategoryIds(
  list: unknown,
  fromId: string,
  toId: string | null,
): { changed: boolean; ids: string[]; emptied: boolean } {
  if (!Array.isArray(list)) return { changed: false, ids: [], emptied: false };
  const ids = list.filter((x): x is string => typeof x === "string");
  if (!ids.includes(fromId)) return { changed: false, ids, emptied: false };
  const next: string[] = [];
  for (const id of ids) {
    const v = id === fromId ? toId : id;
    if (v && !next.includes(v)) next.push(v);
  }
  return { changed: true, ids: next, emptied: next.length === 0 };
}

export function remapRuleConditions(
  conditions: unknown,
  fromId: string,
  toId: string | null,
): { changed: boolean; conditions: Json; deactivate: boolean } {
  const c = asObject(conditions);
  const r = remapCategoryIds(c.categoryIds, fromId, toId);
  if (!r.changed) return { changed: false, conditions: c, deactivate: false };
  if (r.emptied) delete c.categoryIds;
  else c.categoryIds = r.ids;
  return { changed: true, conditions: c, deactivate: r.emptied };
}

export function remapBroadcastSegment(
  segment: unknown,
  fromId: string,
  toId: string | null,
): { changed: boolean; segment: Json; backToDraft: boolean } {
  const s = asObject(segment);
  const r = remapCategoryIds(s.clickedCategoryIds, fromId, toId);
  if (!r.changed) return { changed: false, segment: s, backToDraft: false };
  if (r.emptied) delete s.clickedCategoryIds;
  else s.clickedCategoryIds = r.ids;
  return { changed: true, segment: s, backToDraft: r.emptied };
}

/** Références d'une catégorie hors messages : automatisations et envois pas encore partis qui la citent. */
export type CategoryRefs = {
  rules: number;
  broadcasts: number;
  /** Automatisations dont c'est la seule catégorie (désactivées, ou filtre retiré, si on supprime sans remplacement). */
  rulesOnly: number;
  /** Envois dont c'est la seule catégorie (repassent en brouillon, ou filtre retiré, si on supprime sans remplacement). */
  broadcastsOnly: number;
};

function idsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((x): x is string => typeof x === "string"))];
}

/**
 * Compte, par catégorie, les automatisations (`conditions.categoryIds`) et les envois groupés
 * (`segment.clickedCategoryIds`, à passer déjà filtrés sur brouillon et programmé) qui la citent.
 */
export function countCategoryReferences(
  rules: Array<{ conditions: unknown }>,
  broadcasts: Array<{ segment: unknown }>,
): Map<string, CategoryRefs> {
  const out = new Map<string, CategoryRefs>();
  const get = (id: string) => {
    let r = out.get(id);
    if (!r) out.set(id, (r = { rules: 0, broadcasts: 0, rulesOnly: 0, broadcastsOnly: 0 }));
    return r;
  };
  for (const r of rules) {
    const ids = idsOf(asObject(r.conditions).categoryIds);
    for (const id of ids) {
      const c = get(id);
      c.rules += 1;
      if (ids.length === 1) c.rulesOnly += 1;
    }
  }
  for (const b of broadcasts) {
    const ids = idsOf(asObject(b.segment).clickedCategoryIds);
    for (const id of ids) {
      const c = get(id);
      c.broadcasts += 1;
      if (ids.length === 1) c.broadcastsOnly += 1;
    }
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Message de confirmation du bouton « Supprimer » / « Fusionner et supprimer » de Réglages → Catégories. */
export function deleteConfirmMessage(
  name: string,
  posts: number,
  refs: CategoryRefs | undefined,
): string {
  const rules = refs?.rules ?? 0;
  const broadcasts = refs?.broadcasts ?? 0;
  if (posts === 0 && rules === 0 && broadcasts === 0)
    return `La catégorie « ${name} » sera supprimée définitivement. Continuer ?`;
  const items = [
    posts > 0 ? plural(posts, "message", "messages") : "",
    rules > 0 ? plural(rules, "automatisation", "automatisations") : "",
    broadcasts > 0 ? plural(broadcasts, "envoi pas encore parti", "envois pas encore partis") : "",
  ].filter(Boolean);
  const list = items.length > 1 ? `${items.slice(0, -1).join(", ")} et ${items.at(-1)}` : items[0]!;
  const parts = [
    `La catégorie « ${name} » sera supprimée : ${list} passer${items.length > 1 || posts + rules + broadcasts > 1 ? "ont" : "a"} dans la catégorie choisie (ou sans catégorie).`,
  ];
  if ((refs?.rulesOnly ?? 0) > 0 || (refs?.broadcastsOnly ?? 0) > 0)
    parts.push(
      "Sans remplacement (« — sans catégorie — »), une automatisation qui ne visait que cette catégorie sera désactivée, un envoi programmé qui ne visait qu'elle repassera en brouillon, et un brouillon ou une automatisation déjà en pause perdra son filtre de catégorie : vérifiez leur cible ensuite.",
    );
  parts.push("Continuer ?");
  return parts.join(" ");
}
