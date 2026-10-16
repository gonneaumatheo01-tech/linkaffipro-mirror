import { csvNumber, toCsv } from "@/lib/members/csv";
import { sourcePublicUrl } from "./form";
import type { EscapeFigures, LandingFigures, LandingPageTable } from "./stats";

/**
 * Export CSV des chiffres d'une page d'atterrissage (phase 15) : une ligne par source, puis une ligne pour toute la
 * page. En-têtes avec le mot du client ; « join » et « Sortis de TikTok » expliqués dans l'en-tête (pas de survol
 * dans un fichier). Phase 16 : la sortie de TikTok vient après les colonnes de la phase 15, qui gardent leur place :
 * aide affichée, sortis (dont après l'aide, dont sans l'aide), % sortis (sortis après
 * l'aide ÷ aide affichée), puis iPhone et Android (aide affichée, sortis après l'aide, %), et Telegram ouvert après la
 * sortie (dont tout seul). Mêmes règles qu'à l'écran (`escapeFigures`).
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
  "Aide affichée",
  "Sortis de TikTok (vers Safari ou Chrome)",
  "dont sortis après l'aide",
  "dont sortis sans l'aide (page ouverte dans Safari ou Chrome avant l'appui, ou lien ouvert hors de l'appli)",
  "% sortis (sortis après l'aide ÷ aide affichée)",
  "Aide affichée iPhone",
  "Sortis après l'aide iPhone",
  "% sortis iPhone",
  "Aide affichée Android",
  "Sortis après l'aide Android",
  "% sortis Android",
  "Telegram ouvert après la sortie",
  "dont Telegram ouvert tout seul",
] as const;

function pct(r: number | null): string {
  return r === null ? "" : csvNumber(r * 100, 1);
}

function figures(f: LandingFigures): unknown[] {
  return [f.visits, f.clicks, pct(f.clickRate), f.requests, f.approved, pct(f.visitToJoin)];
}

/** Sortie de TikTok : toute la ligne, puis iPhone et Android (0, et « % sortis » vide, sans aide sur ce système). */
function escapeColumns(f: LandingFigures): unknown[] {
  const e = f.escape;
  const sys = (os: "IOS" | "ANDROID"): Pick<EscapeFigures, "help" | "helpedEscaped" | "rate"> =>
    e.systems.find((s) => s.os === os) ?? { help: 0, helpedEscaped: 0, rate: null };
  const cols = (x: Pick<EscapeFigures, "help" | "helpedEscaped" | "rate">) => [
    x.help,
    x.helpedEscaped,
    pct(x.rate),
  ];
  return [
    e.help,
    e.escaped,
    e.helpedEscaped,
    e.direct,
    pct(e.rate),
    ...cols(sys("IOS")),
    ...cols(sys("ANDROID")),
    e.openedAfter,
    e.autoOpened,
  ];
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
    ...escapeColumns(s),
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
      ...escapeColumns(table.totals),
    ]);
  return toCsv([...LANDING_CSV_HEADERS], rows);
}
