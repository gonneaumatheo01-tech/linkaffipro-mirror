/**
 * Lecture du résumé de supervision (phase 25) : une seule source, `agentsOverview` du moteur, partagée par la page
 * `/agents`, la carte « Agents » de l'État du système, la commande « agents » du bot et `pnpm agents:status`.
 * Une panne ne fait jamais tomber la page : elle s'affiche dans un encadré.
 */
import { agentsOverview, type AgentsOverview } from "@linkaffipro/agents";
import { prisma, type PrismaClient } from "@linkaffipro/db";

export type OverviewResult = { ok: true; overview: AgentsOverview } | { ok: false; error: string };

export async function loadAgentsOverview(now = new Date()): Promise<OverviewResult> {
  try {
    // Le client partagé omet `Channel.photoSmall` : même base, type plus étroit que le `PrismaClient` du contrat.
    const overview = await agentsOverview(prisma as unknown as PrismaClient, { now });
    return { ok: true, overview };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type AppliedRecommendation = AgentsOverview["algoAppliedThisWeek"][number] & {
  /** Relus en base : décident du droit d'annuler (gros réglage = administrateurs) et de l'état actuel. */
  size: string;
  target: string;
  status: string;
};

/** Complète les réglages appliqués cette semaine avec leur taille et leur état (droit d'annuler). */
export async function loadAppliedDetails(rows: AgentsOverview["algoAppliedThisWeek"]): Promise<AppliedRecommendation[]> {
  if (!rows.length) return [];
  const found = await prisma.recommendation.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: { id: true, size: true, target: true, status: true },
  });
  const byId = new Map(found.map((r) => [r.id, r]));
  return rows.flatMap((r) => {
    const d = byId.get(r.id);
    return d ? [{ ...r, size: d.size, target: d.target, status: d.status }] : [];
  });
}
