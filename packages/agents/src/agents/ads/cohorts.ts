/**
 * Cohortes par pub (pur) : ce que rapportent, 7, 14 et 30 jours après leur arrivée, les membres acquis par chaque pub.
 * Commissions = CPA nette datée (événements `CPA` + / `CPA_REVERSAL` −, règle de la phase 10) ; la part du revenu
 * n'est jamais attribuée à une pub. Un membre arrivé depuis moins de X jours compte pour ce qu'il a déjà rapporté.
 */
import type { AdsAnalysis } from "../../ads/contracts";
import { round2 } from "./metrics";

export const COHORT_DAYS = [7, 14, 30] as const;
/** Arrivées prises en compte : les 90 derniers jours. */
export const COHORT_WINDOW_DAYS = 90;
const DAY = 86_400_000;

export type CohortMember = { memberId: string; adId: string; arrivedAt: Date };
export type CohortCommission = { memberId: string; amount: number; at: Date };

export function adCohorts(
  members: readonly CohortMember[],
  commissions: readonly CohortCommission[],
  names: ReadonlyMap<string, string>,
): AdsAnalysis["cohorts"] {
  const byMember = new Map<string, CohortCommission[]>();
  for (const c of commissions) {
    const list = byMember.get(c.memberId) ?? [];
    list.push(c);
    byMember.set(c.memberId, list);
  }
  const rows = new Map<string, { adId: string; name: string; d7: number; d14: number; d30: number; members: number }>();
  for (const m of members) {
    const r = rows.get(m.adId) ?? { adId: m.adId, name: names.get(m.adId) ?? "Pub", d7: 0, d14: 0, d30: 0, members: 0 };
    r.members += 1;
    for (const c of byMember.get(m.memberId) ?? []) {
      const age = c.at.getTime() - m.arrivedAt.getTime();
      // Une commission d'avant l'arrivée (joueur déjà inscrit ailleurs) n'est pas due à la pub.
      if (age < 0) continue;
      if (age <= 7 * DAY) r.d7 = round2(r.d7 + c.amount);
      if (age <= 14 * DAY) r.d14 = round2(r.d14 + c.amount);
      if (age <= 30 * DAY) r.d30 = round2(r.d30 + c.amount);
    }
    rows.set(m.adId, r);
  }
  return [...rows.values()].sort((a, b) => b.d30 - a.d30 || b.members - a.members || a.name.localeCompare(b.name));
}
