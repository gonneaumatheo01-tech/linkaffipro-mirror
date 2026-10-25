/**
 * Phase 34, chantier A — chaque opération du site devient une capacité du registre de la phase 33 (équipe
 * `transverse`, clé = clé de l'opération) : le planificateur Opus peut enchaîner plusieurs réglages pour une demande
 * composée (« crée la campagne Celsius FR et donne-moi un lien TikTok dessus »). `check` et `plan` = essai à blanc
 * (`dryRun`, rien d'écrit) ; `run` = l'opération pour de vrai par `deps.siteOps` (mêmes fonctions, mêmes droits, même
 * journal que le site). Seules les lectures, réglages et créations à confirmation `none` / `yes` sont des capacités :
 * une suppression (mot SUPPRIMER), un envoi à des membres (aperçu exact), un secret (demande privée) ou une connexion
 * (navigateur) passent toujours par le déroulé de Kevin (`site/flow.ts`), jamais par un ordre.
 */
import { adminTelegramId, telegramActorUserId } from "../admin/journal";
import type { AgentsDeps } from "../types";
import type { Capability, CapabilityCheck, OrderStep, StepResult } from "../orders/contract";
import type { SiteOpActor, SiteOpMeta, SiteOpResult } from "./contract";
import { colleagueRules } from "./errors";
import { choicesFor } from "./choices";
import { listSiteOps } from "./registry";
import { publicParamsOf } from "./tools";

export const SITE_CAPABILITY_TEAM = "transverse" as const;

/** Une opération peut-elle être une étape d'un ordre (pur) ? */
export function isOrderableSiteOp(op: Pick<SiteOpMeta, "kind" | "confirm" | "secretParams">): boolean {
  return (op.kind === "read" || op.kind === "setting" || op.kind === "create") && (op.confirm === "none" || op.confirm === "yes") && !(op.secretParams ?? []).length;
}

async function adminActor(deps: AgentsDeps, userId?: string | null): Promise<SiteOpActor> {
  const tg = await adminTelegramId(deps).catch(() => null);
  return { userId: userId ?? (await telegramActorUserId(deps).catch(() => null)), role: "ADMIN", via: "TELEGRAM", telegramUserId: tg != null ? tg.toString() : null };
}

async function call(deps: AgentsDeps, op: SiteOpMeta, input: Record<string, unknown>, dryRun: boolean, actor?: SiteOpActor): Promise<SiteOpResult> {
  if (!deps.siteOps) return { ok: false, error: "", code: "unavailable" };
  try {
    return await deps.siteOps({ op: op.key, input, actor: actor ?? (await adminActor(deps)), dryRun });
  } catch {
    return { ok: false, error: "", code: "unavailable" };
  }
}

/** Raison lisible d'un refus (règles de la voix ; sinon une phrase simple, jamais le texte brut s'il ne passe pas). */
function reasonOf(r: Extract<SiteOpResult, { ok: false }>, op: SiteOpMeta): string {
  if (r.code === "unavailable") return "le site ne répond pas pour l'instant";
  if (r.code === "forbidden") return "c'est réservé à l'admin";
  return colleagueRules(r.error ?? "") ?? `le site refuse « ${op.description} » tel quel`;
}

/** Capacité d'une opération du site. */
export function siteCapability(op: SiteOpMeta): Capability<Record<string, unknown>> {
  const pub = publicParamsOf(op);
  const schema = { ...pub, type: "object", additionalProperties: false, properties: (pub.properties ?? {}) as Record<string, unknown> };
  const allowed = new Set(Object.keys(schema.properties));
  const step = (summary: string, p: Record<string, unknown>): OrderStep => ({
    stepKey: op.key,
    capability: op.key,
    teamKey: SITE_CAPABILITY_TEAM,
    summary,
    params: p,
    // Lecture du niveau équipe : rien de touché. Réglage ou création : réglage durable, réservé à l'admin et toujours
    // confirmé. Une lecture réservée à l'admin (liste des comptes, test d'un bookmaker…) est marquée `setting` : un
    // membre ne la lance jamais lui-même par un ordre (`adminOnlyOrder`), elle passe par l'admin.
    touches:
      op.kind === "read" ? (op.role === "ADMIN" ? { channelIds: [], setting: true } : { channelIds: [] }) : { channelIds: [], teamWide: true, setting: true },
  });
  return {
    teamKey: SITE_CAPABILITY_TEAM,
    key: op.key,
    description: `${op.description} (site ; exemple : « ${op.examples[0] ?? op.description} »)`,
    agents: [],
    params: schema,
    parse(input) {
      if (input === undefined || input === null) return { ok: true, params: {} };
      if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "paramètres : objet attendu" };
      // Schéma strict : un champ inconnu (ou secret) est refusé ; les valeurs, elles, sont validées par le site.
      for (const k of Object.keys(input as Record<string, unknown>)) if (!allowed.has(k)) return { ok: false, error: `paramètre inconnu : ${k}` };
      return { ok: true, params: { ...(input as Record<string, unknown>) } };
    },
    limits: { modes: ["simulation", "real"] },
    async check(deps, p): Promise<CapabilityCheck> {
      const r = await call(deps, op, p, true);
      if (r.ok) return { ok: true };
      const alternatives = choicesFor(op, r.field, r.error ?? "").map((c) => ({
        label: c.label,
        capability: { teamKey: SITE_CAPABILITY_TEAM, key: op.key, params: { ...p, ...(r.field ? { [r.field]: c.value } : {}) } },
      }));
      return { ok: false, reason: reasonOf(r, op), alternatives: alternatives.slice(0, 4) };
    },
    async plan(deps, p) {
      const r = await call(deps, op, p, true);
      return [step(r.ok ? (r.preview?.summary ?? op.description) : op.description, p)];
    },
    async run(deps, order, s): Promise<StepResult> {
      const r = await call(deps, op, s.params, false, await adminActor(deps, order.createdById));
      if (r.ok) return { ok: true, message: r.message };
      return { ok: false, message: reasonOf(r, op), retryable: r.code === "unavailable" };
    },
    async report() {
      return {};
    },
  };
}

/** Capacités de toutes les opérations du site qui peuvent entrer dans un ordre. */
export function siteCapabilities(list: readonly SiteOpMeta[] = listSiteOps()): Capability<Record<string, unknown>>[] {
  return list.filter(isOrderableSiteOp).map(siteCapability);
}
