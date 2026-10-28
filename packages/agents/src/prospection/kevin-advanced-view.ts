/**
 * Phase 32, chantier C — fiche du Veilleur et du Valorisateur pour Kevin (« qu'a fait le Veilleur ? », « que va faire
 * le Valorisateur ? ») : ce qu'ils ont fait (7 derniers jours) et ce qu'ils vont faire, en LECTURE SEULE, chiffres lus
 * en base. Appelé par `kevin-view.ts` (`prospectionAgentCard`).
 */
import { parisMinutes } from "../rules/time";
import type { AgentsDeps } from "../types";
import { WATCH_LIMITS } from "./contract-advanced";
import { accountSearchEnabled } from "./discover/sources/account-search";
import { plural } from "./kevin-texts";

export async function advancedAgentCard(deps: AgentsDeps, key: string, now: Date): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const week = new Date(now.getTime() - 7 * 86400_000);
  const digestAt = WATCH_LIMITS.digestHour * 60 + WATCH_LIMITS.digestMinute;
  const next = parisMinutes(now) < digestAt ? "aujourd'hui à 9 h 10" : "demain à 9 h 10";
  if (key === "veilleur") {
    const [snapshots, alerts, networks] = await Promise.all([
      deps.prisma.prospectSnapshot.count({ where: { takenAt: { gte: week } } as never }).catch(() => 0),
      deps.prisma.prospectAlert.count({ where: { createdAt: { gte: week } } as never }).catch(() => 0),
      deps.prisma.prospectNetwork.count().catch(() => 0),
    ]);
    return {
      facts: { relectures7Jours: snapshots, alertes7Jours: alerts, reseaux: networks, alertesMax: WATCH_LIMITS.digestMax },
      lines: [
        `Ces 7 jours : ${plural(snapshots, "canal relu", "canaux relus")}, ${plural(alerts, "alerte trouvée", "alertes trouvées")}, ${plural(networks, "réseau", "réseaux")} de canaux en tout.`,
        `Prochain message d'alertes : ${next}, ${WATCH_LIMITS.digestMax} au plus.`,
      ],
    };
  }
  const [valued, linked, results] = await Promise.all([
    deps.prisma.prospect.count({ where: { valueEstimate: { not: null } } as never }).catch(() => 0),
    deps.prisma.prospect.count({ where: { linkAffiAffiliateId: { not: null } } as never }).catch(() => 0),
    deps.prisma.affiliateResult.count().catch(() => 0),
  ]);
  const account = await accountSearchEnabled(deps);
  return {
    facts: { canauxEstimes: valued, affiliesRattaches: linked, moisDeResultats: results, rechercheParCompte: account },
    lines: [
      `${plural(valued, "canal estimé", "canaux estimés")} en euros, ${plural(linked, "affilié rattaché", "affiliés rattachés")} à Link Affi, ${plural(results, "mois de résultats lu", "mois de résultats lus")}.`,
      "Il relit les vrais résultats le 1er du mois, puis propose les réglages d'estimation.",
    ],
  };
}
