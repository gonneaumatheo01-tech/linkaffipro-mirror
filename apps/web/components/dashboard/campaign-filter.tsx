"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";

/**
 * Filtre « Campagne » du tableau de bord : menu déroulant autonome qui pose `?campaignId=` dans l'adresse
 * (les autres paramètres — période, univers, canal, onglet — sont conservés) et recharge la page.
 * Usage : `<CampaignFilter campaigns={await listCampaignOptions()} value={campaignId} />`.
 */
export function CampaignFilter({ campaigns, value, className }: { campaigns: Array<{ id: string; name: string }>; value: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  function change(id: string) {
    const p = new URLSearchParams(sp.toString());
    if (id) p.set("campaignId", id);
    else p.delete("campaignId");
    p.delete("page");
    const q = p.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  }
  return (
    <div className={className}>
      <Label htmlFor="dashboard-campaign" className="sr-only">
        Campagne
      </Label>
      <select
        id="dashboard-campaign"
        name="campaignId"
        value={value}
        onChange={(e) => change(e.target.value)}
        title="Limiter les statistiques aux canaux et liens d'une campagne"
        className="h-10 rounded-md border bg-background px-2 text-sm md:h-8"
      >
        <option value="">Toutes les campagnes</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
