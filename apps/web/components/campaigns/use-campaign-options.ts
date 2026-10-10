"use client";

import { useEffect, useState } from "react";
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";

let cached: Promise<CampaignOptionWithOffers[]> | null = null;

/** Charge nos campagnes et leurs offres depuis `/campaigns/options` (une seule fois par page), sauf si `initial` est fourni. */
export function useCampaignOptions(initial?: CampaignOptionWithOffers[] | null): { campaigns: CampaignOptionWithOffers[]; loading: boolean } {
  const [campaigns, setCampaigns] = useState<CampaignOptionWithOffers[]>(initial ?? []);
  const [loading, setLoading] = useState(!initial);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    cached ??= fetch("/campaigns/options", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((j: { campaigns?: CampaignOptionWithOffers[] }) => j.campaigns ?? [])
      .catch(() => {
        cached = null;
        return [];
      });
    cached.then((list) => {
      if (!alive) return;
      setCampaigns(list);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [initial]);
  return { campaigns, loading };
}
