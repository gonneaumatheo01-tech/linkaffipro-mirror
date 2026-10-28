/**
 * Phase 32, chantier B — rapport mensuel « ce que rapporte la prospection » (le 1er du mois, après la lecture des
 * résultats et le calibrage). Écrit par le code (aucun chiffre inventé) : affiliés signés / actifs, premiers dépôts et
 * revenus réels du mois par affilié, estimé contre réel (fourchette, jamais un chiffre seul), meilleures sources et
 * meilleurs pays, délais médians, arrêts proposés, propositions de calibrage. QA Global (`REPORT`) avant l'envoi ;
 * refus ou panne → rien ne part, Kevin le dit.
 */
import { esc } from "../../admin/journal";
import { pick } from "../../boss/voice";
import { qaGate } from "../../qa-gates/gate";
import type { QaDeps } from "../../qa/contract";
import { PROSPECTION_TEAM_KEY, type ProspectStatus } from "../contract";
import type { ProspectionKevinDeps } from "../kevin-port";
import { medianOf } from "../pipeline/stats";
import { formatCount, handleOf } from "../score/format";
import { DAY_MS, prospectionNow } from "../score/settings";
import { estimatedVolumes, valueEstimateOf } from "../value/estimate";
import { formatEuroAmount } from "../value/format";
import { parisMonth } from "../../rules/time";
import { listCalibrationChoices } from "./apply";
import { attribution } from "./calibrate";
import { estimatedVsReal } from "./performance";
import { churnProposals, previousMonthOf } from "./pull";
import { REPORT_VARIANTS } from "./texts";

type Deps = ProspectionKevinDeps & QaDeps;

const NBSP = " ";
/** Affiliés détaillés au plus dans le rapport. */
export const REPORT_MAX_AFFILIATES = 8;

const fr1 = (n: number) => (Math.round(n * 10) / 10).toString().replace(".", ",");
const n0 = (n: number | null) => (n === null ? "?" : formatCount(n));

/** « octobre 2026 ». */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

type P = {
  id: string;
  username: string | null;
  title: string;
  status: ProspectStatus;
  linkAffiAffiliateId: string | null;
  contactedAt: Date | null;
  signedAt: Date | null;
  valueEstimate: unknown;
  tier: string | null;
  sourceType: string;
  countries: unknown;
  discoveredAt: Date;
};

export type MonthlyReportData = { month: string; text: string; signed: number; active: number; linked: number; ftd: number | null; revenueCents: number | null };

/** Données et texte du rapport du mois (« AAAA-MM », défaut : mois précédent). */
export async function monthlyReportData(deps: Deps, month?: string | null): Promise<MonthlyReportData> {
  const now = prospectionNow(deps);
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : previousMonthOf(parisMonth(now));
  const label = monthLabel(m).replace(/\s\d{4}$/, "");
  const all = (await deps.prisma.prospect.findMany({ where: {} })) as unknown as P[];
  const signed = all.filter((p) => p.status === "SIGNED" || p.status === "ACTIVE" || p.status === "CHURNED");
  const active = signed.filter((p) => p.status === "ACTIVE");
  const linked = signed.filter((p) => p.linkAffiAffiliateId);
  const lines: string[] = [];
  if (!signed.length) {
    lines.push(pick(REPORT_VARIANTS.empty({ month: label }), "prospection.monthly.empty"));
    if (!deps.linkAffiReader) lines.push(pick(REPORT_VARIANTS.noReader, "prospection.monthly.noReader"));
    return { month: m, text: lines.join("\n"), signed: 0, active: 0, linked: 0, ftd: null, revenueCents: null };
  }
  lines.push(pick(REPORT_VARIANTS.title({ month: label, signed: signed.length, active: active.length }), "prospection.monthly.title"));
  if (!deps.linkAffiReader) lines.push(pick(REPORT_VARIANTS.noReader, "prospection.monthly.noReader"));

  // Résultats du mois par affilié rattaché.
  const results = (await deps.prisma.affiliateResult.findMany({ where: { month: m, prospectId: { in: linked.map((p) => p.id) } } })) as unknown as Array<{ prospectId: string; clicks: number | null; regs: number | null; ftd: number | null; revenueCents: number | null; missing: unknown }>;
  let ftdTotal: number | null = results.length ? 0 : null;
  let revTotal: number | null = results.length ? 0 : null;
  const ranked = linked
    .map((p) => ({ p, r: results.find((x) => x.prospectId === p.id) ?? null }))
    .sort((a, b) => (b.r?.ftd ?? -1) - (a.r?.ftd ?? -1) || (b.r?.clicks ?? -1) - (a.r?.clicks ?? -1));
  for (const { r } of ranked) {
    if (!r) continue;
    ftdTotal = ftdTotal === null || r.ftd === null ? null : ftdTotal + r.ftd;
    revTotal = revTotal === null || r.revenueCents === null ? null : revTotal + r.revenueCents;
  }
  for (const { p, r } of ranked.slice(0, REPORT_MAX_AFFILIATES)) {
    const h = esc(handleOf(p));
    if (!r) {
      lines.push(`${h} : rien lu dans Link Affi ce mois-ci.`);
      continue;
    }
    const est = valueEstimateOf(p.valueEstimate);
    const estFtd = est ? estimatedVolumes(est).ftd : null;
    const estText = estFtd !== null ? ` (estimé entre ${fr1(estFtd * 0.4)} et ${fr1(estFtd * 2.2)})` : "";
    const rev = r.revenueCents === null ? "revenus non fournis" : `${formatEuroAmount(r.revenueCents / 100)}${NBSP}€ de revenus`;
    lines.push(`${h} : ${n0(r.clicks)} clics, ${n0(r.regs)} inscrits, ${n0(r.ftd)} premiers dépôts${estText}, ${rev}`);
  }
  if (ftdTotal !== null || revTotal !== null)
    lines.push(`En tout : ${ftdTotal === null ? "?" : ftdTotal} premiers dépôts, ${revTotal === null ? "revenus incomplets" : `${formatEuroAmount(revTotal / 100)}${NBSP}€ de revenus`}.`);
  const unlinked = signed.length - linked.length;
  if (unlinked > 0) lines.push(pick(REPORT_VARIANTS.unlinked({ n: unlinked }), "prospection.monthly.unlinked"));

  // Estimé contre réel par groupe.
  const evr = await estimatedVsReal(deps);
  for (const s of evr.segments.filter((x) => x.withEnoughData > 0).slice(0, 4))
    lines.push(`${s.label} : réel ÷ estimé ${s.medianRatio.clicks === null ? "?" : fr1(s.medianRatio.clicks)} pour les clics, ${s.medianRatio.ftd === null ? "?" : fr1(s.medianRatio.ftd)} pour les premiers dépôts (${s.withEnoughData} affiliés)`);

  // Meilleures sources et meilleurs pays (signés).
  const bySource = attribution(all, "source").filter((r) => r.signed > 0).slice(0, 3);
  if (bySource.length) lines.push(`Signés par source : ${bySource.map((r) => `${r.label} ${r.signed} sur ${r.total}`).join(", ")}`);
  const byCountry = attribution(all, "country").filter((r) => r.signed > 0).slice(0, 3);
  if (byCountry.length) lines.push(`Signés par pays : ${byCountry.map((r) => `${r.label} ${r.signed} sur ${r.total}`).join(", ")}`);

  // Délais médians : contact → signature, signature → premier dépôt.
  const toSign = medianOf(signed.filter((p) => p.contactedAt && p.signedAt).map((p) => (p.signedAt!.getTime() - p.contactedAt!.getTime()) / DAY_MS));
  const activations = (await deps.prisma.prospectEvent.findMany({ where: { type: "STATUS_CHANGED", prospectId: { in: signed.map((p) => p.id) } } })) as unknown as Array<{ prospectId: string; payload: unknown; createdAt: Date }>;
  const toFtd = medianOf(
    activations
      .filter((e) => (e.payload as { to?: string } | null)?.to === "ACTIVE")
      .map((e) => {
        const p = signed.find((x) => x.id === e.prospectId);
        return p?.signedAt ? (e.createdAt.getTime() - p.signedAt.getTime()) / DAY_MS : NaN;
      }),
  );
  if (toSign !== null || toFtd !== null)
    lines.push(`Délais médians : ${toSign === null ? "?" : `${fr1(toSign)}${NBSP}j`} du contact à la signature, ${toFtd === null ? "?" : `${fr1(toFtd)}${NBSP}j`} de la signature au premier dépôt`);

  // Arrêts proposés et propositions de calibrage.
  const churn = await churnProposals(deps);
  if (churn.length) {
    const handles = churn.slice(0, 5).map((c) => esc(handleOf(all.find((p) => p.id === c.prospectId) ?? { title: "un canal" })));
    lines.push(pick(REPORT_VARIANTS.churn({ handles: handles.length > 1 ? `${handles.slice(0, -1).join(", ")} et ${handles.at(-1)}` : handles[0]! }), "prospection.monthly.churn"));
  }
  const { choices } = await listCalibrationChoices(deps);
  if (choices.length) lines.push(pick(REPORT_VARIANTS.proposals({ n: choices.length }), "prospection.monthly.proposals"));
  return { month: m, text: lines.join("\n"), signed: signed.length, active: active.length, linked: linked.length, ftd: ftdTotal, revenueCents: revTotal };
}

export async function buildMonthlyReport(deps: Deps, month?: string | null): Promise<string> {
  return (await monthlyReportData(deps, month)).text;
}

/** Rapport mensuel « ce que rapporte la prospection » (QA `REPORT`). Une fois par mois (repère posé par `jobs.ts`). */
export async function sendMonthlyReport(deps: Deps, month?: string | null): Promise<{ sent: boolean; qaBlocked: boolean }> {
  if (!deps.admin) return { sent: false, qaBlocked: false };
  const data = await monthlyReportData(deps, month);
  const gate = await qaGate(deps, { contentType: "REPORT", contentId: `prospection-monthly:${data.month}`, teamKey: PROSPECTION_TEAM_KEY, content: { text: data.text } });
  if (gate.kind !== "approved") {
    await deps.admin.send(pick(gate.kind === "unavailable" ? REPORT_VARIANTS.qaUnavailable : REPORT_VARIANTS.qaRejected, `prospection.monthly.qa.${gate.kind}`));
    return { sent: false, qaBlocked: true };
  }
  const res = await deps.admin.send(data.text);
  return { sent: !!res, qaBlocked: false };
}
