"use client";

import { useEffect, useState } from "react";
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";

/**
 * Charge nos campagnes et leurs offres depuis `/campaigns/options` à chaque affichage du formulaire (aucun cache :
 * une campagne créée entre-temps apparaît tout de suite), sauf si `initial` est fourni par le serveur.
 */
export function useCampaignOptions(initial?: CampaignOptionWithOffers[] | null): {
  campaigns: CampaignOptionWithOffers[];
  loading: boolean;
} {
  const [loaded, setLoaded] = useState<CampaignOptionWithOffers[] | null>(null);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    fetch("/campaigns/options", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((j: { campaigns?: CampaignOptionWithOffers[] }) => j.campaigns ?? [])
      .catch(() => [] as CampaignOptionWithOffers[])
      .then((list) => {
        if (alive) setLoaded(list);
      });
    return () => {
      alive = false;
    };
  }, [initial]);
  if (initial) return { campaigns: initial, loading: false };
  return { campaigns: loaded ?? [], loading: loaded === null };
}
