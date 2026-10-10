import { prisma } from "@linkaffipro/db";
import { HelpTip } from "@/components/admin/help-tip";
import { PeriodSelect } from "@/components/admin/period-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta } from "@/components/dashboard/delta";
import { fmtMoney, fmtNum } from "@/lib/format";
import { computeMetrics, fmtRatio, type CampaignMetrics } from "@/lib/campaigns/metrics";
import { campaignDeltas, campaignTotals } from "@/lib/campaigns/queries";
import { previousPeriod } from "@/lib/periods";
import { CampaignForm } from "../../campaign-form";
import { LinkSuggestion } from "../../link-suggestion";
import { updateCampaignAction } from "../../actions";
import type { TabProps } from "./shared";

type TileKey = keyof CampaignMetrics;
/** Tuiles : clé, libellé, formatage, aide, et `invert` pour les coûts (une baisse est favorable). */
const TILES: Array<{ key: TileKey; label: string; fmt: (m: CampaignMetrics) => string; tip?: string; invert?: boolean }> = [
  { key: "spend", label: "Dépense", fmt: (m) => fmtMoney(m.spend), tip: "Coûts des pubs sur la période (compte connecté, CSV ou saisie).", invert: true },
  { key: "entryClicks", label: "Clics pub", fmt: (m) => fmtNum(m.entryClicks ?? 0), tip: "Clics sur les liens goolink d'entrée des pubs, hors robots." },
  { key: "members", label: "Membres", fmt: (m) => fmtNum(m.members), tip: "Demandes d'adhésion acceptées via les liens d'entrée de la campagne." },
  { key: "offerClicks", label: "Clics offre", fmt: (m) => fmtNum(m.offerClicks ?? 0), tip: "Clics « Offre » depuis le bot (avec identifiant de suivi sub-ID) par les membres de la campagne ou vers ses offres." },
  { key: "registrations", label: "Inscriptions", fmt: (m) => fmtNum(m.registrations), tip: "Joueurs inscrits chez le partenaire, rattachés à la campagne (sub-ID ou offre Link Affi de la campagne)." },
  { key: "ftds", label: "FTD", fmt: (m) => fmtNum(m.ftds), tip: "Premiers dépôts : joueurs rattachés qui ont déposé au moins une fois." },
  { key: "deposits", label: "Dépôts", fmt: (m) => `${fmtNum(m.deposits ?? 0)} · ${fmtMoney(m.depositAmount ?? 0)}`, tip: "Nombre et montant des dépôts (premiers et suivants) des joueurs rattachés, sur la période." },
  { key: "revenue", label: "NGR", fmt: (m) => fmtMoney(m.revenue), tip: "Revenu net (NGR) des joueurs rattachés, remonté par Link Affi." },
  { key: "cpl", label: "CPL", fmt: (m) => fmtMoney(m.cpl), tip: "Coût par membre arrivé = dépense / membres.", invert: true },
  { key: "cpa", label: "CPA", fmt: (m) => fmtMoney(m.cpa), tip: "Coût par inscrit = dépense / inscriptions.", invert: true },
  { key: "costPerFtd", label: "Coût / FTD", fmt: (m) => fmtMoney(m.costPerFtd), tip: "Dépense / premiers dépôts.", invert: true },
  { key: "roas", label: "ROAS", fmt: (m) => fmtRatio(m.roas), tip: "Retour sur dépense = NGR / dépense. 1,00× = remboursé." },
  { key: "profit", label: "Bénéfice", fmt: (m) => fmtMoney(m.profit), tip: "NGR − dépense." },
];

/** Vue d'ensemble : tuiles d'indicateurs (période + comparaison), liaison suggérée et formulaire de modification. */
export async function OverviewTab({ id, campaign, scope, period, compare }: TabProps) {
  const [metrics, previous, channels] = await Promise.all([
    campaignTotals(id, scope, period).then(computeMetrics),
    compare ? campaignTotals(id, scope, previousPeriod(period)).then(computeMetrics) : Promise.resolve(null),
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
  ]);
  const deltas = previous ? campaignDeltas(metrics, previous) : null;
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return (
    <>
      <LinkSuggestion campaignId={id} name={campaign.name} linkedIds={campaign.affiliateCampaignIds} />
      <div className="mb-3">
        <PeriodSelect period={period} compare={compare} action={`/campaigns/${id}`} extra={{ tab: "overview" }} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TILES.map((t) => (
          <Card key={t.key}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {t.label}
                {t.tip ? <HelpTip>{t.tip}</HelpTip> : null}
              </div>
              <div className="text-xl font-semibold tabular-nums">{t.fmt(metrics)}</div>
              {previous && deltas ? (
                <div className="text-xs">
                  <Delta value={deltas[t.key]} invert={t.invert} /> <span className="text-[10px] text-muted-foreground">(avant : {t.fmt(previous)})</span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mt-6 max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Modifier la campagne</CardTitle>
        </CardHeader>
        <CardContent>
          <CampaignForm
            action={updateCampaignAction}
            values={{
              id,
              name: campaign.name,
              adPlatform: campaign.adPlatform,
              vertical: campaign.vertical,
              status: campaign.status,
              budgetDaily: campaign.budgetDaily === null ? null : Number(campaign.budgetDaily),
              startAt: day(campaign.startAt),
              endAt: day(campaign.endAt),
              notes: campaign.notes,
              channelIds: scope.channelIds,
            }}
            channels={channels}
            submitLabel="Enregistrer"
          />
        </CardContent>
      </Card>
    </>
  );
}
