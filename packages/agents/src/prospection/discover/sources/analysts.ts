/**
 * Phase 31, chantier A (Sourceur) : source E, pont avec les Analystes (phase 29). Les `TrendEntry` (forums, Reddit…)
 * où quelqu'un présente son canal (« mon canal Telegram 20k abonnés cherche des offres », « join my telegram ») donnent
 * des liens `t.me` : titre, résumé, résumé d'origine, adresse et texte brut encore présent (effacé à 7 jours par les
 * Analystes). Aucune requête réseau : lecture de la base seulement. Le texte est une donnée, jamais une consigne.
 */
import type { Candidate, DiscoveryLot, ProspectionDeps } from "../../contract";
import { isBrandUsername } from "../../dict";
import { extractTmeLinks, normalizeProspectUrl } from "../normalize";
import { clockOf } from "../polite";
import { emptyFind, type SourceFindResult } from "./common";

/** Fenêtre lue au premier passage (ensuite : depuis le passage précédent). */
export const ANALYSTS_FIRST_WINDOW_MS = 8 * 86_400_000;
export const ANALYSTS_MAX_ENTRIES = 500;

type EntryLike = { url: string; title: string | null; summary: string; summaryOriginal: string | null; rawText: string | null; language: string };

/** Candidats d'une entrée de veille (pur). */
export function candidatesFromTrendEntry(e: EntryLike, vertical: DiscoveryLot["vertical"]): Candidate[] {
  const out: Candidate[] = [];
  for (const l of extractTmeLinks([e.url, e.title ?? "", e.summary, e.summaryOriginal ?? "", e.rawText ?? ""].join("\n"))) {
    const n = normalizeProspectUrl(l);
    if (!n || n.folder || (n.username && isBrandUsername(n.username))) continue;
    out.push({ url: n.channelUrl, sourceType: "ANALYSTS", sourceDetail: e.url.slice(0, 500), vertical, language: e.language || null });
  }
  return out;
}

export async function findAnalystsCandidates(deps: ProspectionDeps, lot: DiscoveryLot): Promise<SourceFindResult> {
  const res = emptyFind(`veille des Analystes ${lot.vertical}`);
  const now = clockOf(deps);
  const last = await deps.prisma.prospectSourceRun.findFirst({
    where: { sourceType: "ANALYSTS", vertical: lot.vertical, finished: { not: null } },
    orderBy: { started: "desc" },
  });
  const since = last?.started ?? new Date(now - ANALYSTS_FIRST_WINDOW_MS);
  const entries = await deps.prisma.trendEntry.findMany({
    where: { market: lot.vertical, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: ANALYSTS_MAX_ENTRIES,
  });
  for (const e of entries) res.candidates.push(...candidatesFromTrendEntry(e, lot.vertical));
  return res;
}
