/**
 * Phase 34, chantier A — valeurs proposées en boutons quand une valeur manque (pur) : la liste `enum` du schéma du
 * champ (8 au plus), sinon les quelques choix cités par le message d'erreur du site (« parmi : a, b ou c »).
 */
import type { SiteOpMeta } from "./contract";

/** Choix proposés en boutons : `enum` du schéma du champ (8 au plus), sinon peu de choix cités par l'erreur. */
export function choicesFor(meta: Pick<SiteOpMeta, "params">, field: string | null | undefined, error: string): { label: string; value: unknown }[] {
  const props = (meta.params?.properties ?? {}) as Record<string, { enum?: unknown[] } | undefined>;
  const values = field ? props[field]?.enum : undefined;
  if (Array.isArray(values) && values.length >= 2 && values.length <= 8) return values.map((v) => ({ label: String(v), value: v }));
  const m = /(?:parmi|au choix|choix possibles?|choisis(?:sez)?(?: entre)?|valeurs? possibles?)\s*:?\s*(.+?)\s*\.?$/iu.exec(error);
  if (!m) return [];
  const items = m[1]!
    .split(/\s*,\s*|\s+ou\s+|\s+et\s+/u)
    .map((x) => x.replace(/^[«"“\s]+|[»"”\s.]+$/gu, "").trim())
    .filter((x) => x.length > 0 && x.length <= 40);
  return items.length >= 2 && items.length <= 6 ? items.map((x) => ({ label: x, value: x })) : [];
}

