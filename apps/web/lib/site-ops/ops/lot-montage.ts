/**
 * Phase 28 — cœurs des opérations de l'équipe Montage (page Agents → Montage), appelés par le site et par Kevin
 * (règle de la phase 34). Métadonnées pour Kevin : `packages/agents/src/site/ops/lot-montage.ts` ; correspondance :
 * `packages/agents/src/site/parity/lot-montage.ts`. Cœurs : `./lot-montage/shorts.ts`.
 */
import type { SiteOpImpl } from "@linkaffipro/agents";
import type { CoreRun, Fail } from "./lot-d/kit";

type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };
type In = Record<string, unknown>;
type Shorts = typeof import("./lot-montage/shorts");

function op(key: string, pick: (m: Shorts) => { prepare: (input: In) => Promise<Prepared>; core: CoreRun }): SiteOpImpl {
  return {
    key,
    async run(input, actor, opts) {
      const { prepare, core } = pick(await import("./lot-montage/shorts"));
      const p = await prepare(input ?? {});
      if (!p.ok) return p.result;
      const r = await core(p.fd, actor, opts ?? {});
      if (r.ok) return { ok: true, message: r.message, ...(r.data ? { data: r.data } : {}), ...(r.preview ? { preview: r.preview } : {}) };
      return { ok: false, error: r.error, ...(r.field ? { field: r.field } : {}), ...(r.code ? { code: r.code } : {}) };
    },
  };
}

export const LOT_MONTAGE_IMPL: SiteOpImpl[] = [
  op("agents.short_valider", (m) => ({ prepare: m.kevinShortForm, core: m.runApproveShort })),
  op("agents.short_modifier", (m) => ({ prepare: m.kevinShortForm, core: m.runModifyShort })),
  op("agents.short_refuser", (m) => ({ prepare: m.kevinShortForm, core: m.runRejectShort })),
  op("agents.montage_annuler", (m) => ({ prepare: m.kevinMontageForm, core: m.runCancelMontage })),
];
