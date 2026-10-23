/**
 * Plafond d'un poste de médias (vidéo ou photo) vérifié AVANT l'appel avec le coût estimé : jamais de dépassement.
 */
import { monthUsage } from "../../missions/usage";
import { PROVIDER_LABELS } from "../../orchestrator/budgets";
import type { AgentContext, ProviderKey } from "../../types";

const eur = (c: number) => `${(c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Règle pure : sans plafond tout passe ; un appel gratuit passe toujours ; sinon dépense + estimation ≤ plafond. */
export function budgetAllows(spent: number, cap: number | undefined, estimate: number): boolean {
  if (cap === undefined || estimate <= 0) return true;
  return spent + estimate <= cap;
}

export async function checkMediaBudget(
  ctx: AgentContext,
  provider: Extract<ProviderKey, "video" | "image">,
  estimate: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cap = ctx.settings.monthlyBudgetCents[provider];
  if (cap === undefined || estimate <= 0) return { ok: true };
  const spent = (await monthUsage(ctx.prisma, ctx.settings.teamKey, ctx.now())).find((u) => u.provider === provider)?.cents ?? 0;
  if (budgetAllows(spent, cap, estimate)) return { ok: true };
  return { ok: false, reason: `plafond ${PROVIDER_LABELS[provider]} du mois atteint (${eur(spent)} + ${eur(estimate)} estimés pour ${eur(cap)})` };
}
