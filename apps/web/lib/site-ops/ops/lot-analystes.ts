/**
 * Phase 29 — cœurs des opérations de l'équipe Analystes (page Agents → Analyses), appelés par le site et par Kevin
 * (règle de la phase 34). Métadonnées pour Kevin : `packages/agents/src/site/ops/lot-analystes.ts` ; correspondance :
 * `packages/agents/src/site/parity/lot-analystes.ts`. Cœurs : `./lot-analystes/cores.ts`.
 */
import type { SiteOpImpl } from "@linkaffipro/agents";
import type { CoreRun, Fail } from "./lot-d/kit";

type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };
type In = Record<string, unknown>;
type Cores = typeof import("./lot-analystes/cores");

function op(key: string, pick: (m: Cores) => { prepare: (input: In) => Promise<Prepared>; core: CoreRun }): SiteOpImpl {
  return {
    key,
    async run(input, actor, opts) {
      const { prepare, core } = pick(await import("./lot-analystes/cores"));
      const p = await prepare(input ?? {});
      if (!p.ok) return p.result;
      return core(p.fd, actor, opts ?? {});
    },
  };
}

export const LOT_ANALYSTES_IMPL: SiteOpImpl[] = [
  op("agents.analyses_source_activer", (m) => ({ prepare: m.kevinSourceForm, core: m.runActivateSource })),
  op("agents.analyses_source_desactiver", (m) => ({ prepare: m.kevinSourceForm, core: m.runDeactivateSource })),
  op("agents.analyses_source_supprimer", (m) => ({ prepare: m.kevinSourceForm, core: m.runDeleteSource })),
  op("agents.analyses_recommandation", (m) => ({ prepare: m.kevinRecommendationForm, core: m.runDecideMarketRecommendation })),
];
