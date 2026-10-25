/**
 * Phase 29, chantier A (veille) : socle des appels payants de l'équipe Analystes (IA texte et outils web de l'API).
 *
 * - Plafond mensuel de l'équipe (`ANALYSTS_SETTINGS.monthlyBudgetCents`, `Setting` `analysts.monthly_budget_cents`)
 *   vérifié AVANT chaque appel ; la dépense est comptée ensuite dans `AgentUsage` (équipe `analystes`, poste `llm`
 *   pour l'IA texte, `web` pour les recherches et lectures par les outils serveur).
 * - Le modèle est celui de la tâche (tableau « Modèles IA par agent ») ; un échec remonte en `AnalystsAiError`, jamais
 *   d'essai silencieux sur un autre modèle.
 */
import { extractJson, type ServerToolsClient } from "@linkaffipro/ai";
import { parisMonth } from "../../rules/time";
import type { LlmProvider, LlmRequest } from "../../types";
import { ANALYSTS_SETTINGS, ANALYSTS_TEAM_KEY, type AnalystsDeps } from "../contract";

export const CLASSIFY_MODEL = "claude-haiku-5-5";
export const SUMMARY_MODEL = "claude-sonnet-5-5";
/** Recherche et lecture web : variante 2026 des outils serveur, absente de Haiku 5.5. */
export const WEB_TOOLS_MODEL = "claude-sonnet-5-5";

export type AnalystsAiErrorCode = "no_ai" | "budget" | "ai_failed" | "invalid_output";

/** Erreur claire (message en français courant, jamais de clé ni de texte lu). */
export class AnalystsAiError extends Error {
  readonly code: AnalystsAiErrorCode;
  constructor(code: AnalystsAiErrorCode, message: string) {
    super(message);
    this.name = "AnalystsAiError";
    this.code = code;
  }
}

/** Dépendances de la veille : IA texte, outils serveur, attente et horloge injectables (tests). */
export type WatchDeps = AnalystsDeps & {
  /** IA texte de l'équipe (Haiku / Sonnet). Absente : `providers.llm` s'il n'est pas un faux fournisseur. */
  analystsLlm?: LlmProvider | null;
  providers?: { llm?: LlmProvider | null };
  /** Outils serveur de l'API Claude (recherche, lecture de repli). */
  serverTools?: ServerToolsClient | null;
  /** Plafond imposé (centimes) ; sinon `Setting` puis valeur du contrat. */
  monthlyBudgetCents?: number;
};

export const nowOf = (deps: Pick<AnalystsDeps, "now">): Date => (deps.now ? deps.now() : new Date());

export function llmOfAnalysts(deps: WatchDeps): LlmProvider | null {
  if (deps.analystsLlm !== undefined) return deps.analystsLlm;
  const ctx = deps.providers?.llm as (LlmProvider & { fake?: boolean }) | null | undefined;
  return ctx && !ctx.fake ? ctx : null;
}

/** Valeur d'un réglage `Setting` (nombre, chaîne ou booléen), sinon la valeur par défaut. */
export async function readSetting<T extends number | string | boolean>(deps: AnalystsDeps, key: string, fallback: T): Promise<T> {
  try {
    const row = await deps.prisma.setting.findUnique({ where: { key } });
    const v = row?.value as unknown;
    if (typeof fallback === "number") {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      return (Number.isFinite(n) ? n : fallback) as T;
    }
    if (typeof fallback === "boolean") return (typeof v === "boolean" ? v : fallback) as T;
    return (typeof v === "string" && v ? v : fallback) as T;
  } catch {
    return fallback;
  }
}

export async function analystsBudgetCap(deps: WatchDeps): Promise<number> {
  if (typeof deps.monthlyBudgetCents === "number") return deps.monthlyBudgetCents;
  const n = await readSetting(deps, ANALYSTS_SETTINGS.monthlyBudgetCents.key, ANALYSTS_SETTINGS.monthlyBudgetCents.value);
  return n >= 0 ? Math.round(n) : ANALYSTS_SETTINGS.monthlyBudgetCents.value;
}

/** Dépense du mois (centimes, tous postes de l'équipe). */
export async function analystsMonthSpent(deps: AnalystsDeps): Promise<number> {
  const rows = await deps.prisma.agentUsage.findMany({ where: { teamKey: ANALYSTS_TEAM_KEY, month: parisMonth(nowOf(deps)) } });
  return rows.reduce((s, r) => s + r.cents, 0);
}

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Refuse l'appel si le plafond est atteint (avant tout appel payant). */
export async function assertAnalystsBudget(deps: WatchDeps): Promise<void> {
  const [cap, spent] = await Promise.all([analystsBudgetCap(deps), analystsMonthSpent(deps)]);
  if (spent >= cap)
    throw new AnalystsAiError(
      "budget",
      `Plafond mensuel des analyses atteint (${eur(spent)} pour ${eur(cap)}) : plus d'appel à l'IA ni de recherche jusqu'au mois prochain ou à une hausse du plafond.`,
    );
}

export async function recordAnalystsUsage(deps: AnalystsDeps, provider: "llm" | "web", cents: number): Promise<void> {
  const month = parisMonth(nowOf(deps));
  const add = Math.max(0, Math.round(cents));
  try {
    await deps.prisma.agentUsage.upsert({
      where: { teamKey_provider_month: { teamKey: ANALYSTS_TEAM_KEY, provider, month } },
      create: { teamKey: ANALYSTS_TEAM_KEY, provider, month, cents: add, calls: 1 },
      update: { cents: { increment: add }, calls: { increment: 1 } },
    });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[analystes] dépense non comptée");
  }
}

/** Un appel d'IA texte compté : plafond avant, dépense après, échec → `AnalystsAiError("ai_failed")`. */
export async function callAnalystsLlm(deps: WatchDeps, req: LlmRequest, what: string): Promise<string> {
  const llm = llmOfAnalysts(deps);
  if (!llm) throw new AnalystsAiError("no_ai", `IA indisponible pour ${what} (clé Anthropic absente dans Réglages → IA).`);
  await assertAnalystsBudget(deps);
  let res;
  try {
    res = await llm.complete(req);
  } catch (err) {
    throw new AnalystsAiError("ai_failed", `L'IA n'a pas répondu pour ${what} : ${(err as Error).message.slice(0, 160)}`);
  }
  if (res.costCents > 0) await recordAnalystsUsage(deps, "llm", res.costCents);
  return res.text;
}

/** JSON objet de la réponse, ou erreur claire. */
export function parseAiObject(text: string, what: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    throw new AnalystsAiError("invalid_output", `Réponse de l'IA illisible pour ${what} (pas de JSON).`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new AnalystsAiError("invalid_output", `Réponse de l'IA illisible pour ${what}.`);
  return data as Record<string, unknown>;
}

/** Texte sur une ligne, sans balises ni caractères de contrôle, coupé à `max`. */
export function cleanLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    // eslint-disable-next-line no-control-regex -- caractères de contrôle retirés volontairement
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Coupe à `max` caractères sur une limite de mot (ajoute « … » si coupé). */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
