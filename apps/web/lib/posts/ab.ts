/**
 * Tests A/B des messages de canal : découpage du formulaire en variantes à créer (fonction pure, testée).
 * Deux `Post` partagent le même `abGroupId` ; B est publié dans le même canal N minutes après A (par défaut 30),
 * ou dans un autre canal à la même heure.
 */

import type { PostButtonRow } from "./buttons";

export const AB_DEFAULT_DELAY_MINUTES = 30;
export const AB_MIN_DELAY_MINUTES = 5;
export const AB_MAX_DELAY_MINUTES = 24 * 60;

export type AbMode = "same-channel" | "other-channel";

export type AbFormPart = {
  abEnabled: boolean;
  abMode: AbMode;
  abChannelId?: string;
  abDelayMinutes: number;
  textB: string;
  mediaAssetIdsB: string[];
  buttonsB: PostButtonRow[];
};

export type PostVariantPlan = {
  variant: "A" | "B";
  channelId: string;
  text: string;
  mediaAssetIds: string[];
  buttons: PostButtonRow[];
  /** Décalage en minutes par rapport à la date de A. */
  offsetMinutes: number;
};

/** Borne le délai entre A et B (5 min à 24 h ; 30 min par défaut si invalide). */
export function clampAbDelay(value: number): number {
  if (!Number.isFinite(value)) return AB_DEFAULT_DELAY_MINUTES;
  return Math.min(AB_MAX_DELAY_MINUTES, Math.max(AB_MIN_DELAY_MINUTES, Math.round(value)));
}

/**
 * Variantes à créer pour un canal A donné. Sans test A/B : une seule variante (A, sans groupe).
 * Lève une erreur lisible si le mode « autre canal » n'a pas de canal, ou si ce canal est le même que A.
 */
export function planVariants(
  a: { channelId: string; text: string; mediaAssetIds: string[]; buttons: PostButtonRow[] },
  ab: AbFormPart,
): PostVariantPlan[] {
  const first: PostVariantPlan = { variant: "A", ...a, offsetMinutes: 0 };
  if (!ab.abEnabled) return [first];
  const hasB = ab.textB.trim().length > 0 || ab.mediaAssetIdsB.length > 0;
  if (!hasB)
    throw new Error("Test A/B : écrivez le texte de la version B (ou ajoutez-lui un média).");
  let channelB = a.channelId;
  let offset = clampAbDelay(ab.abDelayMinutes);
  if (ab.abMode === "other-channel") {
    if (!ab.abChannelId)
      throw new Error("Test A/B : choisissez le canal qui recevra la version B.");
    if (ab.abChannelId === a.channelId)
      throw new Error(
        "Test A/B : le canal de la version B doit être différent de celui de la version A (ou choisissez « même canal »).",
      );
    channelB = ab.abChannelId;
    offset = 0;
  }
  return [
    first,
    {
      variant: "B",
      channelId: channelB,
      text: ab.textB,
      mediaAssetIds: ab.mediaAssetIdsB,
      buttons: ab.buttonsB,
      offsetMinutes: offset,
    },
  ];
}

/** Date de publication d'une variante à partir de celle de A (null reste null : brouillon sans date). */
export function variantScheduledAt(base: Date | null, offsetMinutes: number): Date | null {
  return base ? new Date(base.getTime() + offsetMinutes * 60_000) : null;
}
