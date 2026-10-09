/**
 * Tests A/B des envois groupés : répartition déterministe des membres entre les variantes.
 * Fonctions pures partagées par le site (apps/web) et le worker (apps/worker) : une seule implémentation.
 */

export const AB_MIN_SPLIT = 10;
export const AB_MAX_SPLIT = 90;
export const AB_DEFAULT_SPLIT = 50;
/** Nombre minimal d'envois par variante avant de désigner un gagnant. */
export const AB_MIN_SENT = 30;

/** Hachage FNV-1a 32 bits → entier 0..99, stable pour un couple (groupe, membre). */
export function hashBucket(groupId: string, memberId: string): number {
  const s = `${groupId}:${memberId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Variante d'un membre : « A » si son seau est sous la part de A, sinon « B ». */
export function variantFor(memberId: string, groupId: string, splitA: number): "A" | "B" {
  return hashBucket(groupId, memberId) < splitA ? "A" : "B";
}

/** Part de A bornée entre 10 et 90 % (valeur par défaut 50 si invalide). */
export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return AB_DEFAULT_SPLIT;
  return Math.min(AB_MAX_SPLIT, Math.max(AB_MIN_SPLIT, Math.round(value)));
}

/** Part de A (en %) à partir de la variante et de la part stockée sur un envoi. */
export function splitAOf(variant: string | null | undefined, abSplit: number | null | undefined): number {
  const s = clampSplit(abSplit ?? AB_DEFAULT_SPLIT);
  return variant === "B" ? 100 - s : s;
}

// ------------------------------------------------------------------
// Tests A/B des messages de canal (deux `Post` publiés, comparés après envoi)
// ------------------------------------------------------------------

/** Statistiques d'une variante de message de canal, telles que comparées. */
export type PostVariantStats = {
  variant: string;
  /** La variante a bien été publiée dans le canal. */
  sent: boolean;
  views: number;
  clicks: number;
  uniqueClickers: number;
  reactionsTotal: number;
};

export type PostWinnerResult =
  | { status: "winner"; variant: string; metric: "ctr" | "uniqueClickers" | "clicks"; value: number }
  | { status: "tie"; metric: "ctr" | "uniqueClickers" | "clicks" }
  | { status: "pending"; reason: "not_sent" | "no_data" };

/**
 * Gagnante provisoire d'un test A/B de canal.
 * Mesure : taux de clic (cliqueurs uniques / vues) si les deux variantes ont des vues ;
 * sinon cliqueurs uniques ; sinon clics. Égalité stricte → « tie ». Les deux variantes doivent être envoyées
 * et au moins une doit avoir un clic ou une réaction, sinon « pending ».
 */
export function pickPostWinner(variants: PostVariantStats[]): PostWinnerResult {
  const tested = variants.filter((v) => v.variant === "A" || v.variant === "B");
  if (tested.length < 2 || tested.some((v) => !v.sent)) return { status: "pending", reason: "not_sent" };
  const total = tested.reduce((s, v) => s + v.clicks + v.uniqueClickers + v.reactionsTotal, 0);
  if (total === 0) return { status: "pending", reason: "no_data" };
  const metric: "ctr" | "uniqueClickers" | "clicks" = tested.every((v) => v.views > 0)
    ? "ctr"
    : tested.some((v) => v.uniqueClickers > 0)
      ? "uniqueClickers"
      : "clicks";
  const score = (v: PostVariantStats): number =>
    metric === "ctr" ? v.uniqueClickers / v.views : metric === "uniqueClickers" ? v.uniqueClickers : v.clicks;
  const scored = tested.map((v) => ({ variant: v.variant, value: score(v) })).sort((a, b) => b.value - a.value);
  const [best, second] = scored as [{ variant: string; value: number }, { variant: string; value: number }];
  if (best.value === second.value) return { status: "tie", metric };
  return { status: "winner", variant: best.variant, metric, value: best.value };
}
