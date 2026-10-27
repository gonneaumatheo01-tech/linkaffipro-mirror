/**
 * Phase 31, chantier B (Enrichisseur) — appels payants de l'IA pour l'équipe Prospection.
 *
 * - Plafond mensuel de l'équipe (`prospection.monthly_budget_cents`) vérifié AVANT chaque appel ; la dépense est comptée
 *   ensuite dans `AgentUsage` (équipe `prospection`, poste `llm`), comme les Analystes (phase 29).
 * - Le modèle est celui de la tâche (`PROSPECTION_MODELS`) ; un échec remonte en `EnrichAiError`, jamais d'essai
 *   silencieux sur un autre modèle (règle « jamais de repli d'Opus / Sonnet vers un modèle inférieur »).
 */
import { parisMonth } from "../../rules/time";
import type { LlmProvider, LlmRequest } from "../../types";
import { PROSPECTION_SETTINGS, PROSPECTION_TEAM_KEY, type ProspectionDeps } from "../contract";

export type EnrichAiErrorCode = "no_ai" | "budget" | "ai_failed" | "invalid_output";

/** Erreur claire (message en français courant, jamais de clé ni de texte lu). */
export class EnrichAiError extends Error {
  readonly code: EnrichAiErrorCode;
  constructor(code: EnrichAiErrorCode, message: string) {
    super(message);
    this.name = "EnrichAiError";
    this.code = code;
  }
}

/** Dépendances de l'Enrichisseur : celles de l'équipe + IA texte et plafond injectables (tests). */
export type EnrichDeps = ProspectionDeps & {
  /** IA texte de l'équipe (Haiku / Sonnet). Absente : `providers.llm` s'il n'est pas un faux fournisseur. */
  prospectionLlm?: LlmProvider | null;
  providers?: { llm?: LlmProvider | null } | null;
  /** Plafond imposé (centimes) ; sinon `Setting` puis valeur du contrat. */
  monthlyBudgetCents?: number;
};

export const enrichNow = (deps: Pick<ProspectionDeps, "now">): Date => (deps.now ? deps.now() : new Date());

export function enrichLlmOf(deps: EnrichDeps): LlmProvider | null {
  if (deps.prospectionLlm !== undefined) return deps.prospectionLlm;
  const ctx = deps.providers?.llm as (LlmProvider & { fake?: boolean }) | null | undefined;
  return ctx && !ctx.fake ? ctx : null;
}

/** Valeur numérique d'un réglage `Setting`, sinon la valeur par défaut. */
export async function enrichNumberSetting(deps: ProspectionDeps, key: string, fallback: number): Promise<number> {
  try {
    const row = await deps.prisma.setting.findUnique({ where: { key } });
    const v = row?.value as unknown;
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

async function budgetCap(deps: EnrichDeps): Promise<number> {
  if (typeof deps.monthlyBudgetCents === "number") return deps.monthlyBudgetCents;
  const n = await enrichNumberSetting(deps, PROSPECTION_SETTINGS.monthlyBudgetCents.key, PROSPECTION_SETTINGS.monthlyBudgetCents.value);
  return n >= 0 ? Math.round(n) : PROSPECTION_SETTINGS.monthlyBudgetCents.value;
}

async function monthSpent(deps: ProspectionDeps): Promise<number> {
  const rows = await deps.prisma.agentUsage.findMany({ where: { teamKey: PROSPECTION_TEAM_KEY, month: parisMonth(enrichNow(deps)) } });
  return rows.reduce((s, r) => s + r.cents, 0);
}

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

async function assertBudget(deps: EnrichDeps): Promise<void> {
  const [cap, spent] = await Promise.all([budgetCap(deps), monthSpent(deps)]);
  if (spent >= cap)
    throw new EnrichAiError("budget", `Plafond mensuel de la prospection atteint (${eur(spent)} pour ${eur(cap)}) : plus de lecture par l'IA jusqu'au mois prochain.`);
}

async function recordUsage(deps: ProspectionDeps, cents: number): Promise<void> {
  const month = parisMonth(enrichNow(deps));
  const add = Math.max(0, Math.round(cents));
  try {
    await deps.prisma.agentUsage.upsert({
      where: { teamKey_provider_month: { teamKey: PROSPECTION_TEAM_KEY, provider: "llm", month } },
      create: { teamKey: PROSPECTION_TEAM_KEY, provider: "llm", month, cents: add, calls: 1 },
      update: { cents: { increment: add }, calls: { increment: 1 } },
    });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[prospection] dépense non comptée");
  }
}

/** Un appel d'IA compté : plafond avant, dépense après, échec → `EnrichAiError("ai_failed")`. */
export async function callEnrichLlm(deps: EnrichDeps, req: LlmRequest, what: string): Promise<string> {
  const llm = enrichLlmOf(deps);
  if (!llm) throw new EnrichAiError("no_ai", `IA indisponible pour ${what} (clé Anthropic absente dans Réglages → IA).`);
  await assertBudget(deps);
  let res;
  try {
    res = await llm.complete(req);
  } catch (err) {
    throw new EnrichAiError("ai_failed", `L'IA n'a pas répondu pour ${what} : ${(err as Error).message.slice(0, 160)}`);
  }
  if (res.costCents > 0) await recordUsage(deps, res.costCents);
  return res.text;
}
