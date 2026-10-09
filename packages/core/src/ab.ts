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
