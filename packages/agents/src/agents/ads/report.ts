/**
 * Rapports de l'Agent Ads. Les chiffres sont calculés par le code (JSON des faits), le modèle rapide ne fait que les
 * écrire en français simple ; contrôle codé : un nombre absent du JSON, une ligne trop longue ou du HTML font rejeter
 * toute la rédaction (lignes écrites par le code à la place). Sans clé IA (faux modèle), le code écrit tout.
 * Le lien vers la page n'est jamais écrit par le modèle.
 */
import { escapeHtml } from "@linkaffipro/core";
import type { LlmProvider } from "../../types";
import { allowedNumbers, inventedNumbers } from "../../rules/report-numbers";

export const ADS_DAILY_MAX_LINES = 4;
export const ADS_WEEKLY_MAX_LINES = 12;
export const ADS_LINE_MAX = 220;

export type AdsPubFact = { name: string; campaign: string | null; spend: number; gains: number; roas: number | null };

export type AdsDailyFacts = {
  kind: "daily";
  day: string;
  dayLabel: string;
  spend: number;
  commissions: number;
  gains: number;
  roas: number | null;
  connectorsMissing: boolean;
  best: AdsPubFact | null;
  worst: AdsPubFact | null;
  recommendations: { STOP: number; SCALE: number; TEST: number; WATCH: number; total: number };
};

export type AdsVerticalFact = { label: string; spend: number; gains: number; roas: number | null; gainsChangePct: number | null; spendChangePct: number | null };

export type AdsWeeklyFacts = {
  kind: "weekly";
  weekStart: string;
  weekLabel: string;
  spend: number;
  gains: number;
  roas: number | null;
  verticals: AdsVerticalFact[];
  cohort: { name: string; members: number; d30: number; perMember30: number } | null;
  recommendations: Array<{ rank: number; action: string; name: string; sentence: string }>;
  connectorsMissing: boolean;
};

export type AdsFacts = AdsDailyFacts | AdsWeeklyFacts;

const eur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dec = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const pct = (n: number | null) => (n === null ? null : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`);

/** Lignes écrites par le code (pur). */
export function adsCodeLines(f: AdsFacts): string[] {
  if (f.kind === "daily") {
    const lines: string[] = [];
    lines.push(
      f.spend > 0
        ? `Dépense pub d'hier : ${eur(f.spend)} ; gains ${eur(f.gains)}${f.roas !== null ? ` (retour sur dépense ${dec(f.roas)})` : ""}${f.connectorsMissing ? " ; coûts importés ou saisis" : ""}.`
        : `Aucune dépense pub hier${f.connectorsMissing ? " (aucun compte Meta ou TikTok branché)" : ""} ; commissions ${eur(f.commissions)}.`,
    );
    if (f.best) lines.push(`Meilleure pub : « ${f.best.name} », gains ${eur(f.best.gains)} pour ${eur(f.best.spend)} dépensés.`);
    if (f.worst && f.worst.name !== f.best?.name) lines.push(`Pire pub : « ${f.worst.name} », gains ${eur(f.worst.gains)} pour ${eur(f.worst.spend)} dépensés.`);
    const r = f.recommendations;
    lines.push(
      r.total
        ? `Recommandations : ${r.STOP} à arrêter, ${r.SCALE} à augmenter, ${r.TEST} à tester, ${r.WATCH} à surveiller.`
        : "Aucune recommandation aujourd'hui.",
    );
    return lines.slice(0, ADS_DAILY_MAX_LINES);
  }
  const lines: string[] = [`Semaine : ${eur(f.spend)} dépensés, gains ${eur(f.gains)}${f.roas !== null ? ` (retour sur dépense ${dec(f.roas)})` : ""}.`];
  for (const v of f.verticals) {
    const trend = pct(v.gainsChangePct);
    lines.push(`${v.label} : ${eur(v.spend)} dépensés, gains ${eur(v.gains)}${v.roas !== null ? `, retour ${dec(v.roas)}` : ""}${trend ? ` ; gains ${trend} sur la semaine d'avant` : ""}.`);
  }
  if (f.cohort)
    lines.push(`Membres des pubs : ceux de « ${f.cohort.name} » (${f.cohort.members}) ont rapporté ${eur(f.cohort.d30)} en 30 jours, soit ${eur(f.cohort.perMember30)} par membre.`);
  for (const r of f.recommendations) lines.push(`${r.rank}. ${r.action} « ${r.name} » : ${r.sentence}`);
  if (!f.recommendations.length) lines.push("Aucune recommandation cette semaine.");
  return lines.slice(0, ADS_WEEKLY_MAX_LINES);
}

export const ADS_REPORT_SYSTEM = [
  "Tu rédiges le rapport des publicités (Meta, TikTok) d'une équipe d'affiliation, pour un patron non technique.",
  "Règles : français simple, phrases courtes, aucun jargon, une idée par ligne, pas de HTML, pas de lien.",
  "Utilise UNIQUEMENT les chiffres fournis, sans en inventer, sans en calculer de nouveaux, sans les arrondir autrement.",
  'Réponds UNIQUEMENT par un objet JSON : {"lines": ["ligne", …]}',
].join("\n");

export function adsReportUser(f: AdsFacts): string {
  const max = f.kind === "daily" ? ADS_DAILY_MAX_LINES : ADS_WEEKLY_MAX_LINES;
  return [`Tâche : rapport-ads-${f.kind === "daily" ? "quotidien" : "hebdomadaire"} (${max} lignes au plus)`, "Chiffres (JSON) :", JSON.stringify(f)].join("\n");
}

/** Rédaction du modèle validée, ou null (format faux, trop de lignes, HTML, nombre absent du JSON). */
export function parseAdsReportOutput(raw: string, f: AdsFacts): string[] | null {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  let data: unknown;
  try {
    data = JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
  const lines = (data as { lines?: unknown }).lines;
  const max = f.kind === "daily" ? ADS_DAILY_MAX_LINES : ADS_WEEKLY_MAX_LINES;
  if (!Array.isArray(lines) || !lines.length || lines.length > max) return null;
  if (!lines.every((l) => typeof l === "string" && l.trim() && l.length <= ADS_LINE_MAX && !/[<>]/.test(l) && !/https?:|www\./i.test(l))) return null;
  const allowed = allowedNumbers(f);
  if (!(lines as string[]).every((l) => inventedNumbers(l, allowed).length === 0)) return null;
  return (lines as string[]).map((l) => l.trim());
}

export type WrittenAdsReport = { html: string; lines: string[]; writtenBy: "ai" | "code"; costCents: number; rejected: boolean };

export async function writeAdsReport(
  f: AdsFacts,
  opts: { llm: (LlmProvider & { fake?: boolean }) | null; model: string; pageUrl: string },
): Promise<WrittenAdsReport> {
  let ai: string[] | null = null;
  let costCents = 0;
  let rejected = false;
  if (opts.llm && !opts.llm.fake) {
    try {
      const res = await opts.llm.complete({ model: opts.model, system: ADS_REPORT_SYSTEM, user: adsReportUser(f), maxTokens: f.kind === "daily" ? 500 : 1200 });
      costCents = res.costCents;
      ai = parseAdsReportOutput(res.text, f);
      rejected = ai === null;
    } catch {
      ai = null;
    }
  }
  const lines = ai ?? adsCodeLines(f);
  const title = f.kind === "daily" ? `📣 <b>Pubs — ${escapeHtml(f.dayLabel)}</b>` : `📣 <b>Pubs — semaine du ${escapeHtml(f.weekLabel)}</b>`;
  const html = [title, ...lines.map((l) => `• ${escapeHtml(l)}`), `Détail et recommandations : ${escapeHtml(opts.pageUrl)}`].join("\n");
  return { html, lines, writtenBy: ai ? "ai" : "code", costCents, rejected };
}
