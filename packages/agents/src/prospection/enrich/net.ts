/**
 * Phase 31, chantier B — tout accès réseau de l'Enrichisseur passe par la lecture polie du Sourceur
 * (`discover/polite.ts` : 1 requête / 3 s sur t.me, robots.txt, pause d'une source sur 403 / captcha). Un seul endroit
 * pour l'appel : les autres modules de `enrich/` ne parlent jamais au réseau directement.
 */
import { politeProspectFetch } from "../discover/polite";
import type { ProspectionDeps } from "../contract";

export type EnrichFetchKind = "tme" | "linked";
export type EnrichFetchResult = { status: number; body: string; finalUrl: string };

/** Lecture d'une page publique. Erreur réseau ou source en pause → exception (l'appelant classe l'erreur). */
export async function enrichFetch(deps: ProspectionDeps, url: string, kind: EnrichFetchKind): Promise<EnrichFetchResult> {
  const res = (await politeProspectFetch(deps, url, { kind })) as Partial<EnrichFetchResult> & { status: number; body?: string };
  return { status: res.status, body: res.body ?? "", finalUrl: res.finalUrl ?? url };
}
