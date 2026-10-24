/**
 * Phase 27, chantier B : résultats (pur), seulement sur les posts dont les vues sont visibles.
 * - vues médianes ;
 * - 3 meilleurs et 3 plus faibles posts (heure, forme, fond ; la valeur est le nombre de vues) ;
 * - corrélations simples avec l'effectif derrière chaque chiffre : longueur ↔ vues et heure ↔ vues (Pearson), vues
 *   médianes par moment de la journée et par type de média. Sous 10 posts avec vues : aucune corrélation (valeur
 *   null) ; un groupe de moins de 3 posts n'a pas de médiane.
 */
import type { Measure } from "../contract";
import { parisMinutes, parisWeekday } from "../../rules/time";
import { MEDIA_LABELS } from "./form";
import { slotOf, WEEKDAY_LABELS } from "./rhythm";
import { median, pearson, roundTo } from "./stats";
import type { AnalysisPost } from "./types";

export const MIN_CORRELATION_POSTS = 10;
export const MIN_GROUP_POSTS = 3;
export const TOP_POSTS = 3;

export const DAY_PERIODS = [
  { key: "nuit", label: "la nuit (0 h-6 h)", from: 0, to: 6 },
  { key: "matin", label: "le matin (6 h-12 h)", from: 6, to: 12 },
  { key: "apresMidi", label: "l'après-midi (12 h-18 h)", from: 12, to: 18 },
  { key: "soir", label: "le soir (18 h-24 h)", from: 18, to: 24 },
] as const;

/** Description courte d'un post (jamais son texte) : jour et heure de Paris, forme, fond. */
export function describePost(p: AnalysisPost): string {
  const traits: string[] = [];
  if (p.hasVipCall) traits.push("appel au VIP");
  if (p.hasOdds) traits.push("cote");
  if (p.isBetResult) traits.push("résultat");
  if (p.hasBonus) traits.push("bonus");
  if (p.questions > 0) traits.push("question");
  if (p.hasButton) traits.push("bouton");
  return [`${WEEKDAY_LABELS[parisWeekday(p.postedAt)]} ${slotOf(p.postedAt)}`, MEDIA_LABELS[p.mediaKind], `${p.length} caractères`, ...traits].join(", ");
}

export function resultsMeasures(posts: readonly AnalysisPost[]): Measure[] {
  const seen = posts.filter((p): p is AnalysisPost & { views: number } => typeof p.views === "number");
  const k = seen.length;
  const out: Measure[] = [
    { key: "viewsMedian", label: "Vues médianes par post", value: k ? Math.round(median(seen.map((p) => p.views))!) : null, unit: "vues", sampleSize: k },
  ];
  if (!k) return out;
  const ranked = [...seen].sort((a, b) => b.views - a.views || a.postedAt.getTime() - b.postedAt.getTime());
  const top = Math.min(TOP_POSTS, Math.floor(k / 2));
  ranked.slice(0, top).forEach((p, i) =>
    out.push({ key: `best.${i + 1}`, label: `Meilleur post n°${i + 1} : ${describePost(p)}`, value: p.views, unit: "vues", sampleSize: k }),
  );
  ranked
    .slice(-top)
    .reverse()
    .forEach((p, i) =>
      out.push({ key: `worst.${i + 1}`, label: `Post le plus faible n°${i + 1} : ${describePost(p)}`, value: p.views, unit: "vues", sampleSize: k }),
    );
  const enough = k >= MIN_CORRELATION_POSTS;
  const corr = (xs: number[]) => {
    const r = enough ? pearson(xs, seen.map((p) => p.views)) : null;
    return r === null ? null : roundTo(r, 2);
  };
  out.push(
    { key: "corr.lengthViews", label: "Lien longueur ↔ vues (de −1 à 1)", value: corr(seen.map((p) => p.length)), sampleSize: k },
    { key: "corr.hourViews", label: "Lien heure ↔ vues (de −1 à 1)", value: corr(seen.map((p) => parisMinutes(p.postedAt) / 60)), sampleSize: k },
  );
  const group = (key: string, label: string, list: (AnalysisPost & { views: number })[]) =>
    out.push({
      key,
      label,
      value: enough && list.length >= MIN_GROUP_POSTS ? Math.round(median(list.map((p) => p.views))!) : null,
      unit: "vues",
      sampleSize: list.length,
    });
  for (const d of DAY_PERIODS) {
    const list = seen.filter((p) => {
      const h = parisMinutes(p.postedAt) / 60;
      return h >= d.from && h < d.to;
    });
    if (list.length) group(`viewsByPeriod.${d.key}`, `Vues médianes ${d.label}`, list);
  }
  for (const kind of Object.keys(MEDIA_LABELS) as (keyof typeof MEDIA_LABELS)[]) {
    const list = seen.filter((p) => p.mediaKind === kind);
    if (list.length) group(`viewsByMedia.${kind}`, `Vues médianes, posts ${MEDIA_LABELS[kind]}`, list);
  }
  return out;
}
