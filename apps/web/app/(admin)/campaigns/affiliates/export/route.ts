import {
  affiliateFtdsCsv,
  affiliatesCsv,
  type CampaignColumn,
  type FtdColumn,
} from "@/lib/affiliates/csv";
import { parseAffiliatesFilters } from "@/lib/affiliates/page-params";
import { loadAffiliatesPage } from "@/lib/affiliates/queries";
import { periodLabel } from "@/lib/periods";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** En-têtes de l'export des campagnes : mot du client, terme technique entre parenthèses (pas de survol). */
const CAMPAIGN_LABELS: Record<CampaignColumn, string> = {
  affiliate: "Affilié",
  affiliateId: "Identifiant de l'affilié (Link Affi)",
  campaign: "Campagne Telegram",
  campaignKey: "Clé de la campagne",
  channel: "Canal",
  active: "Active",
  attribution: "Attribution",
  period: "Période",
  clicks: "Clics (Link Affi, depuis le début)",
  requests: "Demandes",
  approved: "Acceptés",
  present: "Présents (en ce moment)",
  left: "Partis",
  offerClicks: "Clics sur les offres",
  registrations: "Inscriptions",
  ftds: "Premiers dépôts (FTD)",
  deposits: "Dépôts (nombre)",
  depositAmount: "Dépôts (€)",
  revenue: "Revenu net (NGR, €)",
};

/** En-têtes de la liste des premiers dépôts. */
const FTD_LABELS: Record<FtdColumn, string> = {
  affiliate: "Affilié",
  campaign: "Campagne Telegram",
  channel: "Canal",
  member: "Membre",
  ftdAt: "Premier dépôt (FTD), date",
  amount: "Montant (€)",
  offer: "Offre",
};

/**
 * Export CSV de la page « Affiliés Link Affi » (phase 13), mêmes filtres que la page (période, canal, affilié) :
 * - par défaut : une ligne par campagne Telegram d'affilié (clics Link Affi, demandes, acceptés, présents, partis,
 *   clics sur les offres, inscriptions, premiers dépôts, dépôts, revenu net) et une ligne de total ;
 * - `kind=ftds` : la liste des premiers dépôts de la période (affilié, campagne, canal, membre, date, montant, offre).
 * ADMIN et MANAGER (comme la page).
 */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const f = parseAffiliatesFilters(Object.fromEntries(url.searchParams.entries()));
  const data = await loadAffiliatesPage({
    period: f.period,
    channelId: f.channelId,
    affiliateId: f.affiliateId,
  });
  const ftds = url.searchParams.get("kind") === "ftds";
  const csv = ftds
    ? affiliateFtdsCsv(data.affiliates, FTD_LABELS)
    : affiliatesCsv(data.affiliates, data.totals, periodLabel(f.period), CAMPAIGN_LABELS);
  const name = ftds ? "affilies-premiers-depots" : "affilies-link-affi";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${f.period.from}-${f.period.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
