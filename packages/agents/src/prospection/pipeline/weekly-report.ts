/**
 * Phase 31, chantier C — rapport de la semaine de la prospection (tâche `prospection.weekly-report`, lundi 09:00 Paris,
 * avant le Top du jour). Écrit par le code (aucun chiffre inventé possible) :
 * nouveaux qualifiés par niveau / pays / verticale, Top 5 de la semaine, pipeline par statut, conversions contacté →
 * répondu → signé avec délais médians, sources qui ont donné les meilleurs canaux, 3 suggestions au plus, pauses des
 * sources. Envoi après le QA Global (`REPORT`) ; refus ou panne → rien ne part, Kevin le dit (texte fixe).
 *
 * Export public sous `buildProspectionWeeklyReport` / `sendProspectionWeeklyReport` (l'équipe Analystes exporte déjà
 * un `buildWeeklyReport` à la racine du paquet).
 */
import { esc } from "../../admin/journal";
import { pick, voiceTemplate, type VoiceTable } from "../../boss/voice";
import { qaGate } from "../../qa-gates/gate";
import type { QaDeps } from "../../qa/contract";
import { parisDay } from "../../rules/time";
import { PROSPECTION_SETTINGS, PROSPECTION_TEAM_KEY, type ProspectionDeps, type ProspectStatus } from "../contract";
import { PROSPECT_STATUS_LABELS, SOURCE_TYPE_LABELS, VERTICAL_LABELS, capitalize, countryName, formatPct } from "../score/format";
import { DAY_MS, objectOf, rawProspectionSetting, stringArray } from "../score/settings";
import type { ProspectRow } from "../score/store";
import { sortForTop } from "./daily-top";
import { PIPELINE_STATUSES, formatProspectLine, medianOf, visibleProspects } from "./stats";

const NBSP = "\u00a0";

export const WEEKLY_REPORT_VARIANTS = {
  title: voiceTemplate<{ n: number }>([{ n: 12 }, { n: 0 }], (p) => [
    p.n ? `Ta semaine de prospection : ${p.n} nouveaux canaux à contacter.` : "Ta semaine de prospection : aucun nouveau canal à contacter.",
    p.n ? `Semaine de prospection : ${p.n} nouveaux canaux qualifiés.` : "Semaine de prospection : pas de nouveau canal qualifié.",
  ]),
  suggestCountry: voiceTemplate<{ country: string; pct: string }>([{ country: "L'Italie", pct: `30${NBSP}%` }], (p) => [`${p.country} donne ${p.pct} des A, je creuse ?`, `${p.country} fait ${p.pct} des A. Je cherche plus là-bas ?`]),
  suggestVertical: voiceTemplate<{ weak: string }>([{ weak: "casino" }], (p) => [`Peu de canaux ${p.weak} cette semaine, je cherche plus de ce côté ?`, `Le ${p.weak} est en retrait cette semaine. J'en cherche plus ?`]),
  suggestSource: voiceTemplate<{ source: string }>([{ source: "les transferts entre canaux" }], (p) => [`Les meilleurs canaux viennent surtout par ${p.source}, je continue par là.`, `C'est par ${p.source} que viennent les meilleurs, je garde ce cap.`]),
  suggestReminders: voiceTemplate<{ n: number }>([{ n: 5 }], (p) => [`${p.n} canaux contactés attendent une réponse, pense aux relances.`, `${p.n} contacts sans réponse, une relance peut aider.`]),
  qaRejected: ["Le rapport de la semaine n'a pas passé la vérification, je ne l'envoie pas.", "Je garde le rapport de la semaine : la vérification l'a bloqué."],
  qaUnavailable: ["La vérification ne répond pas, le rapport de la semaine attend.", "Je ne peux pas faire vérifier le rapport de la semaine pour l'instant, il attend."],
} satisfies VoiceTable;

const counts = (values: readonly string[]) => {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const daysText = (n: number | null) => (n === null ? "?" : `${(Math.round(n * 10) / 10).toString().replace(".", ",")}${NBSP}j`);

export type WeeklyReportData = {
  text: string;
  newQualified: number;
  topIds: string[];
  suggestions: string[];
};

/** Données et texte du rapport (pur à partir de la base). */
export async function weeklyReportData(deps: ProspectionDeps, now: Date): Promise<WeeklyReportData> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const all = await visibleProspects(deps);
  const visibleStatuses = new Set<ProspectStatus>(PIPELINE_STATUSES);
  const isNew = (p: ProspectRow) => (p.enrichedAt ?? p.discoveredAt).getTime() >= since.getTime();
  const fresh = all.filter((p) => isNew(p) && (p.tier === "A" || p.tier === "B" || p.tier === "C") && visibleStatuses.has(p.status));
  const lines: string[] = [pick(WEEKLY_REPORT_VARIANTS.title({ n: fresh.length }), "prospection.weekly.title")];

  if (fresh.length) {
    const tiers = counts(fresh.map((p) => p.tier!)).sort((a, b) => a[0].localeCompare(b[0]));
    lines.push(`Par niveau : ${tiers.map(([t, n]) => `${n} ${t}`).join(", ")}`);
    lines.push(`Par pays : ${counts(fresh.map((p) => stringArray(p.countries)[0]?.toUpperCase() ?? "?")).slice(0, 8).map(([c, n]) => `${n} ${c}`).join(", ")}`);
    lines.push(`Par univers : ${counts(fresh.map((p) => VERTICAL_LABELS[p.vertical] ?? "Autre")).map(([v, n]) => `${n} ${v.toLowerCase()}`).join(", ")}`);
  }
  const top = sortForTop(fresh.filter((p) => p.status === "QUALIFIED")).slice(0, 5);
  if (top.length) {
    lines.push("Top 5 de la semaine :");
    for (const p of top) lines.push(formatProspectLine(p));
  }

  const pipe = PIPELINE_STATUSES.map((s) => [s, all.filter((p) => p.status === s).length] as const).filter(([, n]) => n > 0);
  if (pipe.length) lines.push(`Suivi : ${pipe.map(([s, n]) => `${PROSPECT_STATUS_LABELS[s]} ${n}`).join(" · ")}`);

  const contacted = all.filter((p) => p.contactedAt);
  if (contacted.length) {
    const responded = contacted.filter((p) => p.respondedAt);
    const signed = contacted.filter((p) => p.signedAt);
    const toResp = medianOf(responded.map((p) => (p.respondedAt!.getTime() - p.contactedAt!.getTime()) / DAY_MS));
    const toSign = medianOf(signed.map((p) => (p.signedAt!.getTime() - p.contactedAt!.getTime()) / DAY_MS));
    lines.push(
      `Conversions : ${contacted.length} contactés → ${responded.length} réponses (${formatPct(responded.length / contacted.length)}, en ${daysText(toResp)}) → ${signed.length} signés (en ${daysText(toSign)})`,
    );
  }

  // Sources des meilleurs canaux (A et B de la semaine).
  const best = fresh.filter((p) => p.tier === "A" || p.tier === "B");
  const bySource = counts(best.map((p) => p.sourceType));
  if (bySource.length) lines.push(`Meilleurs canaux par source : ${bySource.slice(0, 4).map(([s, n]) => `${SOURCE_TYPE_LABELS[s] ?? "autre"} ${n}`).join(", ")}`);

  // Suggestions (3 au plus).
  const suggestions: string[] = [];
  const aTier = fresh.filter((p) => p.tier === "A");
  const aByCountry = counts(aTier.map((p) => stringArray(p.countries)[0]?.toUpperCase() ?? "?")).filter(([c]) => c !== "?");
  const topCountry = aByCountry[0];
  if (topCountry && aTier.length >= 3 && topCountry[1] >= 2 && topCountry[1] / aTier.length >= 0.3)
    suggestions.push(pick(WEEKLY_REPORT_VARIANTS.suggestCountry({ country: capitalize(countryName(topCountry[0], true)), pct: formatPct(topCountry[1] / aTier.length) }), "prospection.weekly.country"));
  if (fresh.length >= 5) {
    const sports = fresh.filter((p) => p.vertical === "SPORTS" || p.vertical === "BOTH").length;
    const casino = fresh.filter((p) => p.vertical === "CASINO" || p.vertical === "BOTH").length;
    if (sports / fresh.length < 0.2) suggestions.push(pick(WEEKLY_REPORT_VARIANTS.suggestVertical({ weak: "paris sportifs" }), "prospection.weekly.vertical"));
    else if (casino / fresh.length < 0.2) suggestions.push(pick(WEEKLY_REPORT_VARIANTS.suggestVertical({ weak: "casino" }), "prospection.weekly.vertical"));
  }
  if (bySource[0] && bySource[0][1] >= 3 && suggestions.length < 3)
    suggestions.push(pick(WEEKLY_REPORT_VARIANTS.suggestSource({ source: SOURCE_TYPE_LABELS[bySource[0][0]] ?? "une source" }), "prospection.weekly.source"));
  const waiting = all.filter((p) => p.status === "CONTACTED" && !p.respondedAt && p.contactedAt && now.getTime() - p.contactedAt.getTime() > 5 * DAY_MS).length;
  if (waiting >= 3 && suggestions.length < 3) suggestions.push(pick(WEEKLY_REPORT_VARIANTS.suggestReminders({ n: waiting }), "prospection.weekly.reminders"));
  lines.push(...suggestions.slice(0, 3));

  // Sources en pause.
  const pauses = objectOf(await rawProspectionSetting(deps, PROSPECTION_SETTINGS.sourcePauses.key));
  const paused = Object.entries(pauses)
    .map(([src, v]) => [src, objectOf(v)] as const)
    .filter(([, v]) => typeof v.until === "string" && Date.parse(v.until) > now.getTime());
  if (paused.length)
    lines.push(`En pause : ${paused.map(([src, v]) => `${esc(SOURCE_LABELS_BY_KEY[src] ?? src)} jusqu'au ${parisDay(new Date(String(v.until))).split("-").reverse().slice(0, 2).join("/")}`).join(", ")}`);

  return { text: lines.join("\n"), newQualified: fresh.length, topIds: top.map((p) => p.id), suggestions: suggestions.slice(0, 3) };
}

/** Sources de découverte (clés `prospection.source_pauses`) en français. */
const SOURCE_LABELS_BY_KEY: Record<string, string> = {
  directories: "les annuaires",
  web_search: "la recherche web",
  social: "les réseaux sociaux",
  graph: "le graphe des canaux",
  analysts: "la veille des Analystes",
  manual: "tes ajouts",
};

export async function buildWeeklyReport(deps: ProspectionDeps, now: Date): Promise<string> {
  return (await weeklyReportData(deps, now)).text;
}

export async function sendWeeklyReport(deps: ProspectionDeps & QaDeps, now: Date): Promise<{ sent: boolean; qaBlocked: boolean }> {
  if (!deps.admin) return { sent: false, qaBlocked: false };
  const data = await weeklyReportData(deps, now);
  const gate = await qaGate(deps, { contentType: "REPORT", contentId: `prospection-weekly:${parisDay(now)}`, teamKey: PROSPECTION_TEAM_KEY, content: { text: data.text } });
  if (gate.kind !== "approved") {
    await deps.admin.send(pick(gate.kind === "unavailable" ? WEEKLY_REPORT_VARIANTS.qaUnavailable : WEEKLY_REPORT_VARIANTS.qaRejected, `prospection.weekly.qa.${gate.kind}`));
    return { sent: false, qaBlocked: true };
  }
  const res = await deps.admin.send(data.text);
  return { sent: !!res, qaBlocked: false };
}
