/**
 * Phase 34, chantier A — entrées CACHÉES du catalogue du Boss pour les opérations du site confirmées. L'IA ne les voit
 * jamais ; elles ne s'exécutent qu'après la confirmation de l'admin (`runConfirmedAction`) :
 * - `site_op` : après un OUI (`yes`, `send`) ;
 * - `site_op_delete` : filet de sécurité. Une suppression ne s'exécute QUE par le mot exact SUPPRIMER
 *   (`siteDeleteWordReply`, chemin rapide) ; si un OUI arrivait jusqu'ici, rien n'est supprimé.
 * L'`AuditLog` est écrit par le cœur du site (`SITE_SELF_AUDITED_ACTIONS`), jamais en double par Kevin.
 */
import type { BossAction } from "../boss/contract";
import { pick } from "../boss/voice";
import { SITE_FLOW_VARIANTS, executeSiteFlow, flowOfParams } from "./flow";
import { SITE_OP_ACTION, SITE_OP_DELETE_ACTION } from "./keys";

function parseFlow(input: unknown): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  const flow = flowOfParams(input);
  return flow ? { ok: true, params: { flow } } : { ok: false, error: "déroulé illisible" };
}

export const siteOpConfirmed: BossAction = {
  key: SITE_OP_ACTION,
  description: "",
  theme: "guide",
  cls: "confirm",
  params: { type: "object", additionalProperties: false, properties: {} },
  parse: parseFlow,
  async summarize(_deps, params) {
    return flowOfParams(params)?.op ?? "";
  },
  async execute(deps, params) {
    const flow = flowOfParams(params);
    if (!flow) return { reply: pick(SITE_FLOW_VARIANTS.expired, "site.flow.expired") };
    const { status: _s, ...reply } = await executeSiteFlow(deps, flow);
    return reply;
  },
};

export const siteOpDeleteGuard: BossAction = {
  key: SITE_OP_DELETE_ACTION,
  description: "",
  theme: "guide",
  cls: "confirm",
  params: { type: "object", additionalProperties: false, properties: {} },
  parse: parseFlow,
  async summarize(_deps, params) {
    return flowOfParams(params)?.op ?? "";
  },
  async execute() {
    return { reply: pick(SITE_FLOW_VARIANTS.deleteYesNotEnough, "site.flow.delete.notenough") };
  },
};

export const SITE_HIDDEN_ACTIONS: BossAction[] = [siteOpConfirmed, siteOpDeleteGuard];
