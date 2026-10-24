/**
 * Plafonds mensuels par équipe et par fournisseur (`AgentUsage`). Une étape payante n'est lancée que sous le plafond ;
 * au-delà, la mission passe en `BLOCKED_BUDGET` avec un motif clair. Alertes à 80 % et à 100 %, une fois par mois
 * chacune (drapeaux `alerted80` / `alerted100` de la ligne du mois).
 */
import { escapeHtml } from "@linkaffipro/core";
import { agentEvent } from "../admin/journal";
import { monthUsage } from "../missions/usage";
import { parisMonth } from "../rules/time";
import { TEAM_LABELS, type AgentsDeps, type ProviderKey, type TeamKey, type TeamSettings } from "../types";
import { copyAlertToGroup } from "../boss/team/morning";

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  llm: "IA texte",
  video: "vidéo",
  image: "images",
  odds: "cotes",
  screenshot: "captures",
};

export type BudgetState = { allowed: boolean; spent: number; cap: number | null; reason: string | null };

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Règle pure : plafond absent = aucune limite ; 0 = aucun appel payant ; sinon refus dès que la dépense l'atteint. */
export function budgetState(teamKey: TeamKey, provider: ProviderKey, spent: number, cap: number | undefined): BudgetState {
  if (cap === undefined) return { allowed: true, spent, cap: null, reason: null };
  if (spent < cap) return { allowed: true, spent, cap, reason: null };
  return {
    allowed: false,
    spent,
    cap,
    reason: `Plafond mensuel ${PROVIDER_LABELS[provider]} de l'équipe ${TEAM_LABELS[teamKey]} atteint (${eur(spent)} pour ${eur(cap)}) : mission arrêtée jusqu'au mois prochain ou à une hausse du plafond.`,
  };
}

/** Le premier fournisseur au-dessus du plafond, ou null si tout est permis. */
export async function checkBudgets(
  deps: AgentsDeps,
  settings: TeamSettings,
  providers: readonly ProviderKey[],
  now: Date,
): Promise<BudgetState | null> {
  if (!providers.length) return null;
  const usage = await monthUsage(deps.prisma, settings.teamKey, now);
  for (const p of providers) {
    const spent = usage.find((u) => u.provider === p)?.cents ?? 0;
    const s = budgetState(settings.teamKey, p, spent, settings.monthlyBudgetCents[p]);
    if (!s.allowed) return s;
  }
  return null;
}

/** Seuil franchi à signaler (pur) : 100 % prime sur 80 %, chaque seuil une seule fois par mois. */
export function budgetAlertLevel(spent: number, cap: number | undefined, flags: { alerted80: boolean; alerted100: boolean }): 80 | 100 | null {
  if (!cap || cap <= 0) return null;
  if (spent >= cap && !flags.alerted100) return 100;
  if (spent >= cap * 0.8 && !flags.alerted80 && spent < cap) return 80;
  return null;
}

/** Après une dépense : alerte 80 / 100 % si un seuil vient d'être franchi (drapeau posé avant l'envoi). */
export async function maybeAlertBudget(deps: AgentsDeps, settings: TeamSettings, provider: ProviderKey, now: Date): Promise<80 | 100 | null> {
  const month = parisMonth(now);
  const row = await deps.prisma.agentUsage.findUnique({
    where: { teamKey_provider_month: { teamKey: settings.teamKey, provider, month } },
  });
  if (!row) return null;
  const cap = settings.monthlyBudgetCents[provider];
  const level = budgetAlertLevel(row.cents, cap, row);
  if (!level) return null;
  const claimed = await deps.prisma.agentUsage.updateMany({
    where: { id: row.id, [level === 100 ? "alerted100" : "alerted80"]: false },
    data: level === 100 ? { alerted100: true, alerted80: true } : { alerted80: true },
  });
  if (claimed.count === 0) return null;
  const team = TEAM_LABELS[settings.teamKey];
  const text =
    level === 100
      ? `🔴 <b>Agents : plafond atteint</b>\nÉquipe ${escapeHtml(team)}, ${PROVIDER_LABELS[provider]} : ${eur(row.cents)} pour un plafond de ${eur(cap!)}. Les missions qui en ont besoin sont arrêtées jusqu'au mois prochain. Pour continuer, augmente le plafond dans Agents → Réglages.`
      : `🟠 <b>Agents : 80 % du plafond</b>\nÉquipe ${escapeHtml(team)}, ${PROVIDER_LABELS[provider]} : ${eur(row.cents)} sur ${eur(cap!)} ce mois-ci.`;
  await agentEvent(deps, `agents.budget.alert${level}`, { teamKey: settings.teamKey, provider, month, cents: row.cents, cap: cap ?? null });
  try {
    await deps.admin?.send(text);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[agents] alerte de plafond non envoyée");
  }
  // Phase 26 : plafond atteint → copie dans le groupe de l'équipe, au membre qui s'occupe de cette équipe.
  if (level === 100)
    await copyAlertToGroup(deps, settings.teamKey, `🔴 Plafond ${PROVIDER_LABELS[provider]} atteint pour l'équipe ${escapeHtml(team)} : les missions qui en ont besoin attendent le mois prochain (ou un plafond plus haut).`);
  return level;
}
