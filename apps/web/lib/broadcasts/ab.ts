/**
 * Tests A/B des envois groupés : répartition déterministe des membres entre variantes,
 * lecture du formulaire, désignation du gagnant. Fonctions pures (testées).
 * La fonction de répartition est dupliquée à l'identique dans `apps/worker/src/broadcasts/ab.ts`
 * (le worker ne peut pas importer `apps/web`) : toute modification doit être faite aux deux endroits.
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

/** Part de A (en %) à partir de la variante et de la part stockée sur un envoi. */
export function splitAOf(variant: string | null | undefined, abSplit: number | null | undefined): number {
  const s = clampSplit(abSplit ?? AB_DEFAULT_SPLIT);
  return variant === "B" ? 100 - s : s;
}

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return AB_DEFAULT_SPLIT;
  return Math.min(AB_MAX_SPLIT, Math.max(AB_MIN_SPLIT, Math.round(value)));
}

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
