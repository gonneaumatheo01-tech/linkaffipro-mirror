/**
 * Phase 31, chantier B — mesures calculées par le code (section 3.3, fonctions pures). Fenêtre : 30 jours avant
 * `now`. Le code mesure, l'IA ne donne aucun chiffre (règle 7).
 *
 * Décisions :
 * - Lecture coupée à 100 posts : si le plus ancien post lu est plus récent que le début de la fenêtre, le rythme se
 *   calcule sur la durée réellement couverte (un canal à 10 posts par jour n'a que 10 jours lus).
 * - Fenêtre vide (canal silencieux depuis plus de 30 jours) : vues et ratios calculés sur tous les posts lus (dernières
 *   mesures connues) ; le rythme reste 0 et le filtre « abandonné » tranche.
 * - Réactions / commentaires : null quand aucun post ne les affiche (désactivés ou invisibles), jamais 0 par défaut.
 */
import { parisParts } from "../../rules/time";
import { PROSPECTION_LIMITS, type ProspectMetrics, type ProspectPost } from "../contract";

const DAY = 86_400_000;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Coefficient de variation (écart type de population ÷ moyenne) ; null sous 2 valeurs ou moyenne nulle. */
export function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  if (m <= 0) return null;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance) / m;
}

const round = (v: number | null, digits = 4): number | null => (v === null ? null : Number(v.toFixed(digits)));

/** Le post contient-il un lien externe (texte ou bouton) ? Les liens vers t.me ne comptent pas. */
export function hasExternalLink(p: Pick<ProspectPost, "links" | "buttons">): boolean {
  const ext = (u: string) => /^https?:\/\//i.test(u) && !/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i.test(u);
  return p.links.some(ext) || p.buttons.some((b) => ext(b.url));
}

export function computeMetrics(posts: ProspectPost[], subscribers: number | null, now: Date): ProspectMetrics {
  const sorted = [...posts].sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  const windowStart = now.getTime() - PROSPECTION_LIMITS.metricsWindowDays * DAY;
  const inWindow = sorted.filter((p) => p.postedAt.getTime() >= windowStart && p.postedAt.getTime() <= now.getTime() + DAY);
  const base = inWindow.length ? inWindow : sorted;
  const empty: ProspectMetrics = {
    postsPerDay: null,
    medianViews: null,
    avgViews: null,
    viewRate: null,
    viewVarianceCv: null,
    forwardRatio: null,
    reactionRate: null,
    commentRate: null,
    linkDensity: null,
    postingHours: null,
    firstSeenPostAt: null,
    lastPostAt: null,
    posts30d: 0,
    postCount: 0,
  };
  if (!sorted.length) return empty;

  // Rythme : posts de la fenêtre ÷ jours couverts (30, ou moins si la lecture a été coupée à 100 posts).
  const oldest = sorted[sorted.length - 1]!.postedAt.getTime();
  const capped = sorted.length >= PROSPECTION_LIMITS.maxPostsPerChannel && oldest > windowStart;
  const spanDays = capped ? Math.max(1, (now.getTime() - oldest) / DAY) : PROSPECTION_LIMITS.metricsWindowDays;
  const postsPerDay = inWindow.length / spanDays;

  const views = base.map((p) => p.views).filter((v): v is number => typeof v === "number" && v >= 0);
  const med = median(views);
  const avg = mean(views);
  const viewRate = med !== null && subscribers && subscribers > 0 ? med / subscribers : null;

  const withReactions = base.filter((p) => p.reactions !== null);
  const reactViews = withReactions.reduce((s, p) => s + (p.views ?? 0), 0);
  const reactionRate = withReactions.length && reactViews > 0 ? withReactions.reduce((s, p) => s + (p.reactions ?? 0), 0) / reactViews : null;
  const withComments = base.filter((p) => p.comments !== null);
  const comViews = withComments.reduce((s, p) => s + (p.views ?? 0), 0);
  const commentRate = withComments.length && comViews > 0 ? withComments.reduce((s, p) => s + (p.comments ?? 0), 0) / comViews : null;

  const hours = new Array<number>(24).fill(0);
  for (const p of inWindow) hours[parisParts(p.postedAt).hour]!++;

  return {
    postsPerDay: round(postsPerDay, 3),
    medianViews: med === null ? null : Math.round(med),
    avgViews: avg === null ? null : Math.round(avg),
    viewRate: round(viewRate),
    viewVarianceCv: round(coefficientOfVariation(views)),
    forwardRatio: round(base.filter((p) => p.forwardedFrom !== null).length / base.length),
    reactionRate: round(reactionRate, 5),
    commentRate: round(commentRate, 5),
    linkDensity: round(base.filter(hasExternalLink).length / base.length),
    postingHours: inWindow.length ? hours : null,
    firstSeenPostAt: new Date(oldest),
    lastPostAt: sorted[0]!.postedAt,
    posts30d: inWindow.length,
    postCount: sorted.length,
  };
}
