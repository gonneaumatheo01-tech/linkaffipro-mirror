/**
 * Phase 32, chantier B — textes de la valeur estimée (pur), pour Kevin et le site. Règle 3 : toujours une fourchette
 * (jamais un chiffre seul, jamais « rapportera »), la confiance et « non calibrée » tant qu'aucun coefficient calibré
 * n'existe ; hypothèses visibles. Charte `docs/KEVIN-VOIX.md`.
 */
import { pick, voiceTemplate, type VoiceTable } from "../../boss/voice";
import type { ValueEstimate } from "../contract-advanced";
import { formatCount, formatEur, formatPct } from "../score/format";
import { segmentLabel } from "./segment";

const NBSP = "\u00a0";

/** « 1 150 » (espace insécable fine des milliers, comme le reste du site). */
export function formatEuroAmount(n: number): string {
  return Math.round(n).toLocaleString("fr-FR").replace(/[\u202f\u00a0 ]/g, NBSP);
}

export const CONFIDENCE_LABELS: Record<ValueEstimate["confidence"], string> = { low: "confiance faible", medium: "confiance moyenne", high: "confiance bonne" };

/** « non calibrée » ou « calibrée sur paris sportifs, FR ». */
export function calibrationText(v: Pick<ValueEstimate, "calibratedBy">): string {
  return v.calibratedBy === "default" ? "non calibrée" : `calibrée sur ${segmentLabel(v.calibratedBy)}`;
}

/** « 210 – 1 150 €/mois estimés, non calibrée ». Jamais un chiffre seul. */
export function formatValueRange(v: Pick<ValueEstimate, "low" | "high" | "calibratedBy">): string {
  if (v.high < 1) return `moins de 1${NBSP}€/mois estimé, ${calibrationText(v)}`;
  return `${formatEuroAmount(v.low)} – ${formatEuroAmount(v.high)}${NBSP}€/mois estimés, ${calibrationText(v)}`;
}

export type CalibrationState = "none" | "partial" | "all";

/** Fourchette de plusieurs prospects (somme des basses, somme des hautes) : « …, non calibrée » / « en partie calibrée ». */
export function formatRangeSum(low: number, high: number, state: CalibrationState): string {
  const label = state === "all" ? "calibrée" : state === "partial" ? "en partie calibrée" : "non calibrée";
  if (high < 1) return `moins de 1${NBSP}€/mois estimé, ${label}`;
  return `${formatEuroAmount(low)} – ${formatEuroAmount(high)}${NBSP}€/mois estimés, ${label}`;
}

/** Hypothèses en une ligne : portée, taux, deal, manques, réductions. */
export function formatValueAssumptions(v: ValueEstimate): string {
  const a = v.assumptions;
  const parts = [
    `${formatCount(a.promoReach)} vues de posts promo par mois (${formatPct(a.promoShare)} des posts)`,
    `${formatPct(a.ctr, 1)} de clics`,
    `${formatPct(a.regRate)} d'inscrits`,
    `${formatPct(a.ftdRate)} de premiers dépôts`,
  ];
  if (a.cpa !== null) parts.push(`CPA ${formatEur(a.cpa)}`);
  if (a.revsharePct !== null) parts.push(a.arpuMonth !== null ? `revshare ${a.revsharePct}${NBSP}% sur ${formatEur(a.arpuMonth)} par joueur et par mois` : `revshare ${a.revsharePct}${NBSP}% non compté`);
  let line = `Hypothèses : ${parts.join(", ")}.`;
  if (a.missing.includes("arpu_month")) line += " Il me manque le revenu mensuel par joueur pour la part revshare.";
  if (a.reductions.length) line += ` Réduit pour : ${a.reductions.join(", ")}.`;
  return line;
}

type ValueLine = { handle: string; range: string; confidence: string };

export const VALUE_VARIANTS = {
  one: voiceTemplate<ValueLine>(
    [{ handle: "@pronos_fr", range: `210 – 1${NBSP}150${NBSP}€/mois estimés, non calibrée`, confidence: "confiance moyenne" }],
    (p) => [`${p.handle} : ${p.range} (${p.confidence}).`, `Pour ${p.handle}, je compte ${p.range} (${p.confidence}).`],
  ),
  none: voiceTemplate<{ handle: string; reason: string }>(
    [{ handle: "@pronos_fr", reason: "offre sans montant : donne le montant pour estimer" }],
    (p) => [`Pas d'estimation pour ${p.handle} : ${p.reason}.`, `Je ne peux pas chiffrer ${p.handle} : ${p.reason}.`],
  ),
  pipeline: voiceTemplate<{ label: string; range: string; n: number }>(
    [{ label: "En négociation", range: `2${NBSP}100 – 11${NBSP}000${NBSP}€/mois estimés, non calibrée`, n: 3 }],
    (p) => [`${p.label} : ${p.n} canaux, ${p.range}.`, `${p.label} (${p.n} canaux) : ${p.range}.`],
  ),
  pipelineTitle: voiceTemplate<{ range: string }>(
    [{ range: `4${NBSP}000 – 22${NBSP}000${NBSP}€/mois estimés, non calibrée` }],
    (p) => [`Ton pipeline vaut ${p.range}.`, `Valeur de ton pipeline : ${p.range}.`],
  ),
  pipelineEmpty: ["Aucune valeur estimée pour l'instant : il me faut des canaux qualifiés avec une offre qui colle.", "Rien à chiffrer pour l'instant : aucun canal qualifié n'a d'offre qui colle."],
} satisfies VoiceTable;

/** « @x : 210 – 1 150 €/mois estimés, non calibrée (confiance moyenne). » */
export function valueSentence(handle: string, v: ValueEstimate | null, reason: string | null, chatKey?: string | null): string {
  if (!v) return pick(VALUE_VARIANTS.none({ handle, reason: reason ?? "pas assez de données" }), "prospection.value.none", chatKey);
  return pick(VALUE_VARIANTS.one({ handle, range: formatValueRange(v), confidence: CONFIDENCE_LABELS[v.confidence] }), "prospection.value.one", chatKey);
}
