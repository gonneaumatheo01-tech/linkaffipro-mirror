/**
 * Test A/B côté worker : la répartition déterministe vient de `@linkaffipro/core` (`packages/core/src/ab.ts`),
 * partagée avec le site. Ici : le contexte d'un envoi et le filtre des destinataires.
 */
import { variantFor } from "@linkaffipro/core";

export { hashBucket, splitAOf, variantFor } from "@linkaffipro/core";

export type AbContext = { mode: "variant"; groupId: string; letter: "A" | "B"; splitA: number } | { mode: "rest"; excluded: Set<string> } | null;

/** Un membre fait-il partie des destinataires de cet envoi, compte tenu du test A/B ? */
export function abAllows(ctx: AbContext, memberId: string): boolean {
  if (!ctx) return true;
  if (ctx.mode === "rest") return !ctx.excluded.has(memberId);
  return variantFor(memberId, ctx.groupId, ctx.splitA) === ctx.letter;
}
