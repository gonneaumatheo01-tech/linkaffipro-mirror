/**
 * Phase 34, chantier A — registre des cœurs d'opérations du site (`SITE_OP_IMPLS` de `./ops`, un lot par chantier).
 * Une clé = un cœur ; un doublon casse au chargement (jamais deux fonctions pour la même opération).
 */
import type { SiteOpImpl } from "@linkaffipro/agents";
import { SITE_OP_IMPLS } from "./ops";

export function indexSiteOpImpls(list: readonly SiteOpImpl[]): Map<string, SiteOpImpl> {
  const map = new Map<string, SiteOpImpl>();
  for (const impl of list) {
    if (map.has(impl.key)) throw new Error(`Cœur d'opération du site en double : « ${impl.key} »`);
    map.set(impl.key, impl);
  }
  return map;
}

let index: Map<string, SiteOpImpl> | null = null;

/** Cœur d'une opération, ou null. */
export function siteOpImpl(key: string): SiteOpImpl | null {
  index ??= indexSiteOpImpls(SITE_OP_IMPLS);
  return index.get(key) ?? null;
}

export function siteOpImplKeys(): string[] {
  index ??= indexSiteOpImpls(SITE_OP_IMPLS);
  return [...index.keys()];
}
