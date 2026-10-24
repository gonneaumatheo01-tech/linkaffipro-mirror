/**
 * Quota d'appels au fournisseur de cotes (phase 23) : chaque appel HTTP est compté dans `AgentUsage` (fournisseur
 * `odds`, colonne `calls`, mois de Paris). Au plafond mensuel réglable (`settings.sports.maxApiCallsPerMonth`,
 * 2 000 par défaut), l'appel est refusé (`OddsQuotaError`) : l'équipe s'arrête proprement et l'admin est prévenu une
 * fois par mois (80 % puis 100 %, drapeaux de la ligne du mois).
 */
import { agentEvent } from "../admin/journal";
import { parisMonth } from "../rules/time";
import type { AgentsDeps, TeamKey } from "../types";

export class OddsQuotaError extends Error {
  constructor(readonly used: number, readonly max: number) {
    super(`Plafond mensuel d'appels aux cotes atteint (${used} / ${max}) : équipe Paris sportifs arrêtée jusqu'au mois prochain ou à une hausse du plafond.`);
    this.name = "OddsQuotaError";
  }
}

export type OddsQuotaDeps = Pick<AgentsDeps, "prisma" | "admin" | "logger"> & { now: () => Date };

/** Appels déjà faits ce mois-ci. */
export async function oddsCallsThisMonth(prisma: AgentsDeps["prisma"], now: Date, teamKey: TeamKey = "sports"): Promise<number> {
  const row = await prisma.agentUsage.findUnique({ where: { teamKey_provider_month: { teamKey, provider: "odds", month: parisMonth(now) } } });
  return row?.calls ?? 0;
}

/** Seuil à signaler (pur) : 100 % prime sur 80 %, une seule fois chacun. */
export function quotaAlertLevel(used: number, max: number, flags: { alerted80: boolean; alerted100: boolean }): 80 | 100 | null {
  if (max <= 0) return null;
  if (used >= max && !flags.alerted100) return 100;
  if (used >= max * 0.8 && used < max && !flags.alerted80) return 80;
  return null;
}

async function maybeAlert(deps: OddsQuotaDeps, teamKey: TeamKey, max: number): Promise<void> {
  const month = parisMonth(deps.now());
  const row = await deps.prisma.agentUsage.findUnique({ where: { teamKey_provider_month: { teamKey, provider: "odds", month } } });
  if (!row) return;
  const level = quotaAlertLevel(row.calls, max, row);
  if (!level) return;
  const claimed = await deps.prisma.agentUsage.updateMany({
    where: { id: row.id, [level === 100 ? "alerted100" : "alerted80"]: false },
    data: level === 100 ? { alerted100: true, alerted80: true } : { alerted80: true },
  });
  if (claimed.count === 0) return;
  await agentEvent(deps as AgentsDeps, `agents.sports.odds_quota${level}`, { month, calls: row.calls, max });
  const text =
    level === 100
      ? `🔴 <b>Paris sportifs : plafond d'appels aux cotes atteint</b>\n${row.calls} appels sur ${max} ce mois-ci. L'équipe s'arrête jusqu'au mois prochain. Pour continuer, augmente le plafond dans Agents → Paris sportifs.`
      : `🟠 <b>Paris sportifs : 80 % des appels aux cotes</b>\n${row.calls} appels sur ${max} ce mois-ci.`;
  try {
    await deps.admin?.send(text);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[agents] alerte de quota non envoyée");
  }
}

/**
 * Fonction à appeler avant chaque appel HTTP : refuse au plafond, sinon compte l'appel. Comptage ATOMIQUE : la ligne
 * du mois est créée à part (à 0), puis l'appel n'est compté que si `calls < max` dans la même écriture
 * (`updateMany`) : deux appels simultanés à `max − 1` n'en laissent passer qu'un.
 */
export function createOddsQuota(deps: OddsQuotaDeps, max: number, teamKey: TeamKey = "sports"): () => Promise<void> {
  return async () => {
    const now = deps.now();
    const month = parisMonth(now);
    const where = { teamKey_provider_month: { teamKey, provider: "odds", month } };
    if (!(await deps.prisma.agentUsage.findUnique({ where }))) {
      try {
        await deps.prisma.agentUsage.create({ data: { teamKey, provider: "odds", month, cents: 0, calls: 0 } });
      } catch {
        // Créée en même temps par un autre appel : on continue avec la sienne.
      }
    }
    const claimed = await deps.prisma.agentUsage.updateMany({
      where: { teamKey, provider: "odds", month, calls: { lt: max } },
      data: { calls: { increment: 1 } },
    });
    if (claimed.count === 0) {
      await maybeAlert(deps, teamKey, max);
      throw new OddsQuotaError(await oddsCallsThisMonth(deps.prisma, now, teamKey), max);
    }
    await maybeAlert(deps, teamKey, max);
  };
}
