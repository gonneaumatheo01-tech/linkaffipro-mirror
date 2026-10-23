/**
 * Règles du Contrôle qualité propres à l'équipe Casino (pures) :
 * - « jamais de média non fourni » : sur un canal casino, tout média dont l'origine n'est pas HUMAN (produit par l'IA,
 *   ou d'origine inconnue) est refusé, quel que soit le niveau d'autonomie ou une validation ;
 * - offre présente : si le canal a une campagne, son bouton Offre doit pouvoir partir (offre active avec un lien, pas
 *   d'emojis animés qui feraient publier par le compte, sans bouton).
 */
import { hasCustomEmoji } from "@linkaffipro/core";

export function isCasinoTarget(teamKey: string, channelVertical: string | null | undefined): boolean {
  return teamKey === "casino" || channelVertical === "CASINO";
}

/** Motif du refus d'un média sur un canal casino, ou null s'il est fourni par le client. */
export function casinoMediaRefusal(asset: { origin: string | null } | null): string | null {
  if (!asset) return null;
  if (asset.origin === "HUMAN") return null;
  return asset.origin === "AI"
    ? "média produit par l'IA : jamais publié sur un canal casino"
    : "média sans origine connue : seuls les médias fournis par le client sont publiés sur un canal casino";
}

/** Problème du bouton Offre (null si tout va bien ou si le canal n'a pas de campagne). */
export function offerButtonProblem(
  i: { campaignId: string | null; offer: { name: string; buttonReady: boolean } | null; text: string },
): string | null {
  if (!i.campaignId) return null;
  if (!i.offer) return "la campagne liée au canal est introuvable : le bouton Offre ne peut pas partir";
  if (!i.offer.buttonReady) return `la campagne « ${i.offer.name} » n'a aucune offre active : le bouton Offre ne peut pas partir`;
  if (hasCustomEmoji(i.text)) return "emojis animés : le post partirait sans le bouton Offre";
  return null;
}
