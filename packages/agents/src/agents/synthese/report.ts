/**
 * Rapport hebdomadaire « Ce qui marche » (agent Synthèse) : les chiffres sont calculés par le code (`TeamFacts`), puis
 * le modèle rapide les rédige en français simple, 5 lignes par équipe au plus. Garde-fou : un nombre écrit par le
 * modèle qui n'est pas dans les chiffres fournis fait rejeter sa rédaction de l'équipe (lignes du code à la place).
 * Sans clé d'IA (faux fournisseur), le rapport est assemblé par le code. Jamais de texte de conversation.
 */
import { escapeHtml } from "@linkaffipro/core";
import type { LlmProvider } from "../../types";
import { allowedNumbers, inventedNumbers } from "../../rules/report-numbers";

export const REPORT_TEAMS = ["dating", "casino", "sports"] as const;
export type ReportTeam = (typeof REPORT_TEAMS)[number];
export const REPORT_TEAM_LABELS: Record<ReportTeam, string> = { dating: "Rencontres", casino: "Casino", sports: "Paris sportifs" };
export const REPORT_MAX_LINES = 5;
export const REPORT_LINE_MAX = 200;

export type TeamFacts = {
  team: ReportTeam;
  posts7d: number;
  views7d: number;
  bestFormat: { label: string; ctrPct: number | null } | null;
  bestWindow: { day: string; start: string; end: string; channel: string } | null;
  best: { kind: "persona" | "canal"; label: string; ctrPct: number | null } | null;
  applied: number;
  proposed: number;
  testsRunning: number;
  testsClosed: string[];
  /** Profils de conversation (Rencontres) : meilleur taux de réponse. */
  conversation?: { label: string; replyRatePct: number | null; conversations: number } | null;
};

const fr = (n: number, d = 1) => n.toLocaleString("fr-FR", { maximumFractionDigits: d });

/** Lignes assemblées par le code (pur). */
export function codeLines(f: TeamFacts): string[] {
  const lines: string[] = [];
  lines.push(
    f.bestFormat
      ? `Meilleur type de post : ${f.bestFormat.label}${f.bestFormat.ctrPct !== null ? ` (${fr(f.bestFormat.ctrPct, 2)} % de clic sur l'offre)` : ""}.`
      : `Type de post : pas encore assez de données (${f.posts7d} post(s) cette semaine).`,
  );
  if (f.bestWindow) lines.push(`Meilleure fenêtre : ${f.bestWindow.day} ${f.bestWindow.start}-${f.bestWindow.end} (${f.bestWindow.channel}).`);
  if (f.best) lines.push(`Meilleur${f.best.kind === "persona" ? "e persona" : " canal"} : ${f.best.label}${f.best.ctrPct !== null ? ` (${fr(f.best.ctrPct, 2)} %)` : ""}.`);
  else if (f.conversation) lines.push(`Conversations : ${f.conversation.label}, ${f.conversation.replyRatePct === null ? "taux de réponse inconnu" : `${fr(f.conversation.replyRatePct, 0)} % de réponse`} (${f.conversation.conversations} conversations).`);
  lines.push(`Réglages : ${f.applied} appliqué(s), ${f.proposed} proposé(s).`);
  lines.push(`Tests A/B : ${f.testsRunning} en cours${f.testsClosed.length ? ` ; ${f.testsClosed[0]}` : ""}.`);
  return lines.slice(0, REPORT_MAX_LINES);
}

export const REPORT_SYSTEM = [
  "Tu rédiges le rapport hebdomadaire « Ce qui marche » d'une équipe de canaux Telegram, pour un patron non technique.",
  "Règles : français simple, phrases courtes, aucun jargon, 5 lignes au plus par équipe, une idée par ligne.",
  "Utilise UNIQUEMENT les chiffres fournis, sans en inventer, sans en calculer de nouveaux.",
  "Écris les nombres en chiffres, jamais en lettres ; jamais de « x fois », « double » ou « moitié » ; un nombre négatif est une baisse ou une perte.",
  'Réponds UNIQUEMENT par un objet JSON : {"teams": {"dating": ["ligne", …], "casino": […], "sports": […]}}',
].join("\n");

export function buildReportUser(facts: readonly TeamFacts[]): string {
  return ["Tâche : rapport-algo", "Chiffres de la semaine (JSON) :", JSON.stringify(facts)].join("\n");
}

/** Rédaction du modèle (validée) pour chaque équipe ; une équipe invalide est absente du résultat. */
export function parseReportOutput(raw: string, facts: readonly TeamFacts[]): Partial<Record<ReportTeam, string[]>> {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) return {};
  let data: unknown;
  try {
    data = JSON.parse(t.slice(s, e + 1));
  } catch {
    return {};
  }
  const teams = (data as { teams?: Record<string, unknown> }).teams ?? {};
  const out: Partial<Record<ReportTeam, string[]>> = {};
  for (const f of facts) {
    const lines = teams[f.team];
    if (!Array.isArray(lines) || !lines.length || lines.length > REPORT_MAX_LINES) continue;
    if (!lines.every((l) => typeof l === "string" && l.trim() && l.length <= REPORT_LINE_MAX && !/[<>]/.test(l))) continue;
    // Contrôle partagé avec l'Agent Ads (rules/report-numbers.ts).
    const allowed = allowedNumbers(f);
    if (!(lines as string[]).every((l) => inventedNumbers(l, allowed).length === 0)) continue;
    out[f.team] = (lines as string[]).map((l) => l.trim());
  }
  return out;
}

export type WrittenReport = { html: string; byTeam: Record<ReportTeam, string[]>; writtenBy: "ai" | "code"; costCents: number };

/** Rapport complet : rédaction par le modèle si `llm` est un vrai modèle, sinon par le code. */
export async function writeReport(
  facts: readonly TeamFacts[],
  opts: { weekLabel: string; llm: (LlmProvider & { fake?: boolean }) | null; model: string },
): Promise<WrittenReport> {
  let ai: Partial<Record<ReportTeam, string[]>> = {};
  let costCents = 0;
  if (opts.llm && !opts.llm.fake) {
    try {
      const res = await opts.llm.complete({ model: opts.model, system: REPORT_SYSTEM, user: buildReportUser(facts), maxTokens: 900 });
      costCents = res.costCents;
      ai = parseReportOutput(res.text, facts);
    } catch {
      ai = {};
    }
  }
  const byTeam = {} as Record<ReportTeam, string[]>;
  for (const f of facts) byTeam[f.team] = ai[f.team] ?? codeLines(f);
  const blocks = facts.map((f) => `<b>${escapeHtml(REPORT_TEAM_LABELS[f.team])}</b>\n${byTeam[f.team].map((l) => `• ${escapeHtml(l)}`).join("\n")}`);
  const html = [`📊 <b>Ce qui marche — semaine du ${escapeHtml(opts.weekLabel)}</b>`, ...blocks, "Détails et réglages : Agents → Ce qui marche."].join("\n\n");
  return { html, byTeam, writtenBy: Object.keys(ai).length ? "ai" : "code", costCents };
}
