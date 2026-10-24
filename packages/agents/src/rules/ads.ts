/**
 * Règles de recommandation de l'Agent Ads (PUR, testé). L'agent RECOMMANDE, il n'agit jamais : ces règles ne font
 * que produire des propositions justifiées par les chiffres (preuves, période, comparaison, seuil visible).
 * - Arrêter (STOP) : coût par inscription au-dessus du seuil sur les N derniers jours, assez de dépense, la pub
 *   dépense encore, et elle ne rapporte pas assez pour compenser (retour sur dépense sous le minimum).
 * - Augmenter (SCALE) : retour sur dépense au-dessus du minimum sur N jours, gains positifs, budget du jour non
 *   épuisé, tendance stable ou en hausse (7 jours contre les 7 d'avant, baisse de 10 % au plus).
 * - Tester (TEST) : à partir de ce qui marche (une pub à augmenter) : autre visuel dans le même groupe (même
 *   audience), même visuel dans un autre groupe de la campagne (autre audience).
 * - Surveiller (WATCH) : trop jeune ou trop peu de dépense pour conclure (jamais d'arrêt ni d'augmentation alors).
 */
import { comparableVariation } from "@linkaffipro/core";
import type { AdsMetrics, AdsThresholds } from "../ads/contracts";

export type AdsAction = "STOP" | "SCALE" | "TEST" | "WATCH";
export const ADS_ACTIONS: readonly AdsAction[] = ["STOP", "SCALE", "TEST", "WATCH"];
export const ADS_ACTION_LABELS: Record<AdsAction, string> = { STOP: "Arrêter", SCALE: "Augmenter", TEST: "Tester", WATCH: "Surveiller" };
export type AdsTargetLevel = "campaign" | "adset" | "ad";
export const ADS_TARGETS: Record<AdsTargetLevel, "CAMPAIGN" | "ADSET" | "AD"> = { campaign: "CAMPAIGN", adset: "ADSET", ad: "AD" };

export type AdsVerticalThresholds = AdsThresholds["CASINO"];

/** Baisse maximale du retour sur dépense (7 j contre 7 j) pour parler de tendance « stable ». */
export const SCALE_MAX_TREND_DROP_PCT = 10;
/** Budget du jour considéré épuisé à 98 % (les plateformes s'arrêtent un peu avant ou après). */
export const BUDGET_EXHAUSTED_RATIO = 0.98;
export const MAX_TESTS_PER_VERTICAL = 2;

export type AdsRuleInput = {
  level: AdsTargetLevel;
  id: string;
  name: string;
  vertical: string | null;
  campaignId: string | null;
  campaignName?: string | null;
  adSetId?: string | null;
  adSetName?: string | null;
  /** Jours depuis la première dépense. */
  ageDays: number | null;
  /** N derniers jours complets (N = jours d'observation). */
  window: AdsMetrics;
  windowFrom: string;
  windowTo: string;
  last7: AdsMetrics;
  prev7: AdsMetrics;
  /** Dépense d'hier (une pub qui ne dépense plus n'a pas besoin d'être arrêtée). */
  spendYesterday: number;
  /** Budget du jour de la campagne et dépense d'hier de la campagne. */
  budget: { daily: number | null; spentYesterday: number } | null;
};

export type AdsEvidence = {
  sentence: string;
  /** Même phrase (nom lu par la page Ads). */
  summary: string;
  period: { from: string; to: string; days: number };
  from: string;
  to: string;
  days: number;
  /** Chiffres complets de la fenêtre d'observation. */
  current: AdsMetrics;
  figures: Pick<AdsMetrics, "spend" | "registrations" | "costPerRegistration" | "commissions" | "gains" | "roas">;
  comparison: { last7: Pick<AdsMetrics, "spend" | "gains" | "roas" | "registrations">; previous7: Pick<AdsMetrics, "spend" | "gains" | "roas" | "registrations">; roasVariation: ReturnType<typeof comparableVariation> };
  /** Valeur du seuil appliqué (null pour « surveiller »), son nom, et les seuils de données. */
  threshold: number | null;
  thresholdName: "targetCostPerRegistration" | "minRoas" | "observation";
  observationDays: number;
  minSpend: number;
  priority: number;
  level: AdsTargetLevel;
  name: string;
  vertical: string | null;
  campaignId: string | null;
  /** Pour TEST : la pub qui marche, à partir de laquelle varier. */
  basedOn?: { id: string; name: string } | null;
};

export type AdsProposal = { action: AdsAction; level: AdsTargetLevel; targetId: string; evidence: AdsEvidence };

const eur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dec = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const pick = <K extends keyof AdsMetrics>(m: AdsMetrics, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, m[k]])) as Pick<AdsMetrics, K>;
const CMP = ["spend", "gains", "roas", "registrations"] as const;
const FIG = ["spend", "registrations", "costPerRegistration", "commissions", "gains", "roas"] as const;

/** Assez de données pour conclure (pur). */
export function enoughAdsData(i: Pick<AdsRuleInput, "ageDays" | "window">, t: AdsVerticalThresholds): boolean {
  return i.ageDays !== null && i.ageDays >= t.observationDays && i.window.spend >= t.minSpend && i.window.spend > 0;
}

/** Budget du jour de la campagne épuisé hier (pur). */
export function budgetExhausted(b: AdsRuleInput["budget"]): boolean {
  return !!b && b.daily !== null && b.daily > 0 && b.spentYesterday >= b.daily * BUDGET_EXHAUSTED_RATIO;
}

/** Tendance stable ou en hausse du retour sur dépense (pur) ; sans semaine précédente, la pub est « nouvelle ». */
export function trendOk(last7: AdsMetrics, prev7: AdsMetrics): boolean {
  if (prev7.spend <= 0 || prev7.roas === null) return true;
  const v = comparableVariation(last7.roas, prev7.roas);
  if (v.kind === "pct") return v.pct >= -SCALE_MAX_TREND_DROP_PCT;
  return v.kind !== "unknown";
}

/** Dépasse le coût par inscription cible sur la fenêtre (sans inscription : la dépense seule dépasse la cible). */
export function overCostThreshold(w: AdsMetrics, target: number | null): boolean {
  if (target === null || w.spend <= 0) return false;
  return w.registrations === 0 ? w.spend > target : (w.costPerRegistration ?? 0) > target;
}

function evidence(i: AdsRuleInput, t: AdsVerticalThresholds, name: AdsEvidence["thresholdName"], sentence: string, priority: number): AdsEvidence {
  return {
    sentence,
    summary: sentence,
    period: { from: i.windowFrom, to: i.windowTo, days: t.observationDays },
    from: i.windowFrom,
    to: i.windowTo,
    days: t.observationDays,
    current: i.window,
    figures: pick(i.window, FIG),
    comparison: { last7: pick(i.last7, CMP), previous7: pick(i.prev7, CMP), roasVariation: comparableVariation(i.last7.roas, i.prev7.roas) },
    threshold: name === "targetCostPerRegistration" ? t.targetCostPerRegistration : name === "minRoas" ? t.minRoas : null,
    thresholdName: name,
    observationDays: t.observationDays,
    minSpend: t.minSpend,
    priority: Math.round(priority * 100) / 100,
    level: i.level,
    name: i.name,
    vertical: i.vertical,
    campaignId: i.campaignId,
  };
}

/** Arrêter, augmenter ou surveiller une ligne (pur) ; null = rien à dire. */
export function adsActionFor(i: AdsRuleInput, t: AdsVerticalThresholds): AdsProposal | null {
  const days = t.observationDays;
  if (!enoughAdsData(i, t)) {
    if (i.last7.spend <= 0) return null;
    const age = i.ageDays ?? 0;
    const sentence = `Trop tôt pour conclure : ${age} jour${age > 1 ? "s" : ""} de diffusion et ${eur(i.window.spend)} dépensés sur ${days} jours (il faut ${days} jours et ${eur(t.minSpend)}).`;
    return { action: "WATCH", level: i.level, targetId: i.id, evidence: evidence(i, t, "observation", sentence, i.last7.spend) };
  }
  const w = i.window;
  const roasOk = t.minRoas !== null && w.roas !== null && w.roas >= t.minRoas;
  if (i.spendYesterday > 0 && overCostThreshold(w, t.targetCostPerRegistration) && !roasOk) {
    const cpr = t.targetCostPerRegistration!;
    const sentence =
      w.registrations === 0
        ? `${eur(w.spend)} dépensés sur ${days} jours sans aucune inscription (seuil : ${eur(cpr)} par inscription).`
        : `${eur(w.costPerRegistration!)} par inscription sur ${days} jours (seuil : ${eur(cpr)}) : ${eur(w.spend)} dépensés pour ${w.registrations} inscription${w.registrations > 1 ? "s" : ""}, gains ${eur(w.gains)}.`;
    return { action: "STOP", level: i.level, targetId: i.id, evidence: evidence(i, t, "targetCostPerRegistration", sentence, 1000 + Math.max(0, -w.gains)) };
  }
  if (roasOk && w.gains > 0 && !budgetExhausted(i.budget) && trendOk(i.last7, i.prev7)) {
    const v = comparableVariation(i.last7.roas, i.prev7.roas);
    const trend = v.kind === "pct" ? (v.pct >= 0 ? `en hausse de ${dec(v.pct)} %` : `stable (${dec(v.pct)} %)`) : "nouvelle cette semaine";
    const sentence = `Retour sur dépense ${dec(w.roas!)} sur ${days} jours (minimum : ${dec(t.minRoas!)}), gains ${eur(w.gains)} ; tendance ${trend} sur 7 jours.`;
    return { action: "SCALE", level: i.level, targetId: i.id, evidence: evidence(i, t, "minRoas", sentence, 500 + w.gains) };
  }
  return null;
}

/** Variations à tester à partir des lignes qui marchent (pur). */
export function testProposals(scale: readonly AdsProposal[], inputs: readonly AdsRuleInput[], thresholds: AdsThresholds): AdsProposal[] {
  const byId = new Map(inputs.map((i) => [`${i.level}:${i.id}`, i]));
  const out: AdsProposal[] = [];
  const perVertical = new Map<string, number>();
  const winners = scale.filter((p) => p.action === "SCALE").sort((a, b) => b.evidence.priority - a.evidence.priority);
  for (const p of winners) {
    const i = byId.get(`${p.level}:${p.targetId}`);
    if (!i || !i.vertical) continue;
    const t = thresholds[i.vertical as keyof AdsThresholds];
    if (!t) continue;
    const count = perVertical.get(i.vertical) ?? 0;
    if (count >= MAX_TESTS_PER_VERTICAL) continue;
    const roas = dec(i.window.roas ?? 0);
    const base = { id: i.id, name: i.name };
    if (i.level === "ad" && i.adSetId) {
      // Même audience (le groupe), un autre visuel.
      const ev = evidence(i, t, "minRoas", `La pub « ${i.name} » marche (retour sur dépense ${roas}) : essayez un autre visuel ou un autre texte dans le même groupe « ${i.adSetName ?? "groupe"} » (même audience).`, 200 + (i.window.roas ?? 0));
      out.push({ action: "TEST", level: "adset", targetId: i.adSetId, evidence: { ...ev, level: "adset", name: i.adSetName ?? i.name, basedOn: base } });
      perVertical.set(i.vertical, count + 1);
      // Même visuel, une autre audience : seulement s'il existe un autre groupe dans la campagne.
      const other = inputs.find((x) => x.level === "adset" && x.campaignId === i.campaignId && x.id !== i.adSetId);
      if (other && (perVertical.get(i.vertical) ?? 0) < MAX_TESTS_PER_VERTICAL) {
        const ev2 = evidence(i, t, "minRoas", `Essayez le visuel de « ${i.name} » (retour sur dépense ${roas}) sur une autre audience, par exemple le groupe « ${other.name} ».`, 150 + (i.window.roas ?? 0));
        out.push({ action: "TEST", level: "ad", targetId: i.id, evidence: { ...ev2, basedOn: base } });
        perVertical.set(i.vertical, (perVertical.get(i.vertical) ?? 0) + 1);
      }
    } else {
      const ev = evidence(i, t, "minRoas", `« ${i.name} » marche (retour sur dépense ${roas}) : essayez une nouvelle pub avec la même audience et un autre visuel.`, 200 + (i.window.roas ?? 0));
      out.push({ action: "TEST", level: i.level, targetId: i.id, evidence: { ...ev, basedOn: base } });
      perVertical.set(i.vertical, count + 1);
    }
  }
  return out;
}

/**
 * Toutes les recommandations, classées : arrêter, augmenter, tester, surveiller ; dans chaque action, par enjeu.
 * `inputs` : les lignes qui portent les recommandations (pubs, et groupes / campagnes sans pub) ; `context` : toutes
 * les lignes (groupes d'une campagne pour proposer une autre audience).
 */
export function adsRecommendations(inputs: readonly AdsRuleInput[], thresholds: AdsThresholds, context: readonly AdsRuleInput[] = inputs): AdsProposal[] {
  const main: AdsProposal[] = [];
  for (const i of inputs) {
    const t = i.vertical ? thresholds[i.vertical as keyof AdsThresholds] : undefined;
    if (!t) continue;
    const p = adsActionFor(i, t);
    if (p) main.push(p);
  }
  const tests = testProposals(main, context, thresholds);
  // Une même cible ne reçoit qu'une proposition par action.
  const seen = new Set<string>();
  const all = [...main, ...tests].filter((p) => {
    const k = `${p.level}:${p.targetId}:${p.action}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const rank = (a: AdsAction) => ADS_ACTIONS.indexOf(a);
  return all.sort((a, b) => rank(a.action) - rank(b.action) || b.evidence.priority - a.evidence.priority);
}
