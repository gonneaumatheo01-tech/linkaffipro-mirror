/**
 * Répartition déterministe des membres d'un test A/B. Copie exacte de la fonction de
 * `apps/web/lib/broadcasts/ab.ts` (le worker ne peut pas importer `apps/web`) : modifier les deux ensemble.
 */
export function hashBucket(groupId: string, memberId: string): number {
  const s = `${groupId}:${memberId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

export function variantFor(memberId: string, groupId: string, splitA: number): "A" | "B" {
  return hashBucket(groupId, memberId) < splitA ? "A" : "B";
}

/** Part de A (en %) à partir de la variante et de la part stockée sur un envoi. */
export function splitAOf(variant: string | null | undefined, abSplit: number | null | undefined): number {
  const s = Math.min(90, Math.max(10, Math.round(abSplit ?? 50)));
  return variant === "B" ? 100 - s : s;
}

export type AbContext = { mode: "variant"; groupId: string; letter: "A" | "B"; splitA: number } | { mode: "rest"; excluded: Set<string> } | null;

/** Un membre fait-il partie des destinataires de cet envoi, compte tenu du test A/B ? */
export function abAllows(ctx: AbContext, memberId: string): boolean {
  if (!ctx) return true;
  if (ctx.mode === "rest") return !ctx.excluded.has(memberId);
  return variantFor(memberId, ctx.groupId, ctx.splitA) === ctx.letter;
}
