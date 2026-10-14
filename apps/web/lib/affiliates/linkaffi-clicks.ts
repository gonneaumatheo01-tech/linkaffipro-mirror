import type { TelegramCampaignsView } from "@/lib/linkaffi/telegram-campaigns";

/**
 * Clics des campagnes Telegram d'affiliés, comptés par Link Affi (phase 13, D6), pour la vue « Affiliés Link Affi ».
 * Aucune lecture propre du réglage « linkaffi.telegramCampaigns » : les chiffres viennent de la vue rendue par le seul
 * lecteur du réglage (`loadTelegramCampaignsView`, lib/linkaffi/telegram-campaigns.ts, sur parseTelegramCampaignsState
 * de @linkaffipro/linkaffi), le même que Réglages → Connexions. Chiffre absent : « inconnu » (affiché « — »), jamais un
 * zéro inventé. Fonctions pures, testées dans linkaffi-clicks.test.ts.
 */

export type LinkaffiClicks = {
  /** Dernière synchro réussie (null : jamais). */
  syncedAt: Date | null;
  /** Link Affi donne déjà des clics (au moins une campagne en a) ? */
  available: boolean;
  /** Clics par clé de campagne (null : inconnu). */
  clicks: Record<string, number | null>;
};

export function linkaffiClicksFrom(
  view: Pick<TelegramCampaignsView, "syncedAt" | "available" | "campaigns">,
): LinkaffiClicks {
  const clicks: Record<string, number | null> = {};
  for (const [key, c] of Object.entries(view.campaigns)) clicks[key] = c.clicks;
  return {
    syncedAt: view.syncedAt,
    available: view.available && Object.values(clicks).some((n) => n !== null),
    clicks,
  };
}

/** Phrase sous les chiffres : d'où viennent les clics et quand ils ont été relus. */
export function clicksNote(c: LinkaffiClicks, fmt: (d: Date) => string): string {
  if (!c.available || !c.syncedAt)
    return "Clics : comptés par Link Affi ; ils s'afficheront dès que Link Affi les partagera.";
  return `Clics : comptés par Link Affi depuis le début de chaque campagne, relus le ${fmt(c.syncedAt)}.`;
}
