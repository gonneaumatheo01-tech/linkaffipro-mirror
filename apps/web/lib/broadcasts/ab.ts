/**
 * Tests A/B des envois groupés : lecture du formulaire, statistiques par variante, désignation du gagnant.
 * La répartition déterministe (hashBucket, variantFor, splitAOf, clampSplit) vit dans `@linkaffipro/core`
 * (`packages/core/src/ab.ts`), partagée avec le worker : plus de duplication.
 */

import { AB_DEFAULT_SPLIT, AB_MIN_SENT, clampSplit } from "@linkaffipro/core";

export { AB_DEFAULT_SPLIT, AB_MAX_SPLIT, AB_MIN_SENT, AB_MIN_SPLIT, clampSplit, hashBucket, splitAOf, variantFor } from "@linkaffipro/core";

export type AbFormInput = { enabled: false } | { enabled: true; textB: string; buttonsB: unknown; mediaAssetIdB?: string; split: number };

/** Lit les champs A/B du formulaire « Nouvel envoi ». */
export function parseAbForm(fd: FormData): AbFormInput {
  if (String(fd.get("abEnabled") ?? "") !== "1") return { enabled: false };
  let buttonsB: unknown = [];
  const raw = fd.get("buttonsB");
  if (typeof raw === "string" && raw !== "") {
    try {
      buttonsB = JSON.parse(raw);
    } catch {
      buttonsB = [];
    }
  }
  return {
    enabled: true,
    textB: String(fd.get("textB") ?? "").trim(),
    buttonsB,
    mediaAssetIdB: String(fd.get("mediaAssetIdB") ?? "") || undefined,
    split: clampSplit(Number(fd.get("abSplit") ?? AB_DEFAULT_SPLIT)),
  };
}

export type VariantStats = {
  id: string;
  variant: string;
  targeted: number;
  sent: number;
  failed: number;
  blocked: number;
  clicks: number;
  uniqueClicks: number;
  offerClicks: number;
  registrations: number;
  ftds: number;
};

/** Taux de clic : cliqueurs uniques / messages envoyés. */
export function ctr(v: Pick<VariantStats, "sent" | "uniqueClicks">): number | null {
  return v.sent > 0 ? v.uniqueClicks / v.sent : null;
}

export type WinnerResult = { status: "winner"; variant: string; ctr: number } | { status: "tie" } | { status: "insufficient"; minSent: number };

/** Gagnant provisoire : meilleur taux de clic, chaque variante ayant au moins `minSent` envois. */
export function pickWinner(variants: Array<Pick<VariantStats, "variant" | "sent" | "uniqueClicks">>, minSent = AB_MIN_SENT): WinnerResult {
  const tested = variants.filter((v) => v.variant === "A" || v.variant === "B");
  if (tested.length < 2 || tested.some((v) => v.sent < minSent)) return { status: "insufficient", minSent };
  const scored = tested.map((v) => ({ variant: v.variant, ctr: ctr(v) ?? 0 })).sort((a, b) => b.ctr - a.ctr);
  const [best, second] = scored as [{ variant: string; ctr: number }, { variant: string; ctr: number }];
  if (best.ctr === second.ctr) return { status: "tie" };
  return { status: "winner", variant: best.variant, ctr: best.ctr };
}

/** Membres du segment pas encore servis par le test (exclusion des destinataires déjà touchés). */
export function excludeServed(memberIds: readonly string[], served: ReadonlySet<string>): string[] {
  return memberIds.filter((id) => !served.has(id));
}

export function fmtPct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1).replace(".", ",")} %`;
}
