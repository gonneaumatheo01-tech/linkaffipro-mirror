import { csvNumber, toCsv } from "@/lib/members/csv";
import { sourcePublicUrl } from "./form";
import type { LandingFigures, LandingPageTable } from "./stats";

/**
 * Export CSV des chiffres d'une page d'atterrissage (phase 15) : une ligne par source, puis une ligne pour toute la
 * page. En-têtes avec le mot du client ; « join » expliqué dans l'en-tête (pas de survol dans un fichier).
 */
export const LANDING_CSV_HEADERS = [
  "Page",
  "Période",
  "Source",
  "Lien à coller",
  "Retirée",
  "Visites",
  "Clics",
  "% de clic",
  "Demandes (join)",
  "Acceptés",
  "% visite → join",
  "Pub reliée",
  "Dépense de la pub (€)",
  "Coût par join (€)",
] as const;

function pct(r: number | null): string {
  return r === null ? "" : csvNumber(r * 100, 1);
}

function figures(f: LandingFigures): unknown[] {
  return [f.visits, f.clicks, pct(f.clickRate), f.requests, f.approved, pct(f.visitToJoin)];
}

export function landingCsv(input: {
  page: {
    name: string;
    slug: string;
    sources: ReadonlyArray<{ key: string; ad: { name: string } | null }>;
  };
  table: LandingPageTable | null;
  periodText: string;
  trackingBase: string;
}): string {
  const { page, table, periodText, trackingBase } = input;
  const adOf = new Map(page.sources.map((s) => [s.key, s.ad?.name ?? ""] as const));
  const rows: unknown[][] = (table?.sources ?? []).map((s) => [
    page.name,
    periodText,
    s.key || "Lien principal",
    sourcePublicUrl(trackingBase, page.slug, s.key),
    s.isActive ? "" : "oui",
    ...figures(s),
    adOf.get(s.key) ?? "",
    csvNumber(s.spend),
    csvNumber(s.costPerJoin),
  ]);
  if (table)
    rows.push([
      page.name,
      periodText,
      "Toute la page",
      sourcePublicUrl(trackingBase, page.slug, ""),
      "",
      ...figures(table.totals),
      "",
      csvNumber(table.totals.spend),
      csvNumber(table.totals.costPerJoin),
    ]);
  return toCsv([...LANDING_CSV_HEADERS], rows);
}
