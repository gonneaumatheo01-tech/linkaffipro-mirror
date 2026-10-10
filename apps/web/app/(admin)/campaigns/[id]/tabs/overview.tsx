import { prisma } from "@linkaffipro/db";
import { HelpTip } from "@/components/admin/help-tip";
import { PeriodSelect } from "@/components/admin/period-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta } from "@/components/dashboard/delta";
import { fmtMoney, fmtNum } from "@/lib/format";
import { computeMetrics, fmtRatio, type CampaignMetrics } from "@/lib/campaigns/metrics";
import { campaignDeltas, campaignTotals, listActiveConnections } from "@/lib/campaigns/queries";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { previousPeriod } from "@/lib/periods";
import { CampaignForm } from "../../campaign-form";
import { LinkSuggestion } from "../../link-suggestion";
import { deleteCampaignAction, updateCampaignAction } from "../../actions";
import type { TabProps } from "./shared";

type TileKey = keyof CampaignMetrics;
/** Tuiles : clé, libellé, formatage, aide, et `invert` pour les coûts (une baisse est favorable). */
const TILES: Array<{
  key: TileKey;
  label: string;
  fmt: (m: CampaignMetrics) => string;
  tip?: string;
  invert?: boolean;
}> = [
  {
    key: "spend",
    label: "Dépense",
    fmt: (m) => fmtMoney(m.spend),
    tip: "Coûts des pubs sur la période (compte connecté, CSV ou saisie).",
    invert: true,
  },
  {
    key: "entryClicks",
    label: "Clics pub",
    fmt: (m) => fmtNum(m.entryClicks ?? 0),
    tip: "Clics sur les liens goolink d'entrée des pubs, hors robots.",
  },
  {
    key: "members",
    label: "Membres",
    fmt: (m) => fmtNum(m.members),
    tip: "Demandes d'adhésion acceptées via les liens d'entrée de la campagne.",
  },
  {
    key: "offerClicks",
    label: "Clics offre",
    fmt: (m) => fmtNum(m.offerClicks ?? 0),
    tip: "Clics « Offre » depuis le bot (avec identifiant de suivi sub-ID) par les membres de la campagne ou vers ses offres.",
  },
  {
    key: "registrations",
    label: "Inscriptions",
    fmt: (m) => fmtNum(m.registrations),
    tip: "Joueurs inscrits chez le partenaire, rattachés à la campagne (sub-ID ou offre Link Affi de la campagne).",
  },
  {
    key: "ftds",
    label: "FTD",
    fmt: (m) => fmtNum(m.ftds),
    tip: "Premiers dépôts : joueurs rattachés qui ont déposé au moins une fois.",
  },
  {
    key: "deposits",
    label: "Dépôts",
    fmt: (m) => `${fmtNum(m.deposits ?? 0)} · ${fmtMoney(m.depositAmount ?? 0)}`,
    tip: "Nombre et montant des dépôts (premiers et suivants) des joueurs rattachés, sur la période.",
  },
  {
    key: "revenue",
    label: "NGR",
    fmt: (m) => fmtMoney(m.revenue),
    tip: "Revenu net (NGR) des joueurs rattachés : somme des NGR datés de la période chez Link Affi.",
  },
  {
    key: "cpl",
    label: "CPL",
    fmt: (m) => fmtMoney(m.cpl),
    tip: "Coût par membre arrivé = dépense / membres.",
    invert: true,
  },
  {
    key: "cpa",
    label: "CPA",
    fmt: (m) => fmtMoney(m.cpa),
    tip: "Coût par inscrit = dépense / inscriptions.",
    invert: true,
  },
  {
    key: "costPerFtd",
    label: "Coût / FTD",
    fmt: (m) => fmtMoney(m.costPerFtd),
    tip: "Dépense / premiers dépôts.",
    invert: true,
  },
  {
    key: "roas",
    label: "ROAS",
    fmt: (m) => fmtRatio(m.roas),
    tip: "Retour sur dépense = NGR / dépense. 1,00× = remboursé.",
  },
  { key: "profit", label: "Bénéfice", fmt: (m) => fmtMoney(m.profit), tip: "NGR − dépense." },
];

/**
 * Vue d'ensemble : tuiles d'indicateurs (période + comparaison), liaison suggérée, formulaire de modification (avec le
 * compte pub connecté ; les canaux désactivés sont conservés) et, pour un ADMIN, la suppression de la campagne.
 */
export async function OverviewTab({ id, campaign, scope, period, compare, isAdmin }: TabProps) {
  const [metrics, previous, channels, inactiveChannels, connections] = await Promise.all([
    campaignTotals(id, scope, period).then(computeMetrics),
    compare
      ? campaignTotals(id, scope, previousPeriod(period)).then(computeMetrics)
      : Promise.resolve(null),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    scope.channelIds.length
      ? prisma.channel.findMany({
          where: { id: { in: scope.channelIds }, isActive: false },
          orderBy: { title: "asc" },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    listActiveConnections(),
  ]);
  const deltas = previous ? campaignDeltas(metrics, previous) : null;
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return (
    <>
      <LinkSuggestion
        campaignId={id}
        name={campaign.name}
        linkedIds={campaign.affiliateCampaignIds}
      />
      <div className="mb-3">
        <PeriodSelect
          period={period}
          compare={compare}
          action={`/campaigns/${id}`}
          extra={{ tab: "overview" }}
        />
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
                  <Delta value={deltas[t.key]} invert={t.invert} />{" "}
                  <span className="text-[10px] text-muted-foreground">
                    (avant : {t.fmt(previous)})
                  </span>
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
              connectionId: campaign.connectionId,
              followsAdCampaign: !!campaign.externalCampaignId,
            }}
            channels={channels}
            inactiveChannels={inactiveChannels}
            connections={connections}
            submitLabel="Enregistrer"
          />
        </CardContent>
      </Card>
      {isAdmin ? (
        <Card className="mt-6 max-w-3xl border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Supprimer la campagne</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Supprime la campagne, ses groupes, ses pubs, ses coûts et ses statistiques. Les liens
              d&apos;entrée et les boutons Offre restent actifs (page Liens) mais ne sont plus
              rattachés à une campagne ; les membres, clics et joueurs sont conservés.
            </p>
            <form action={deleteCampaignAction}>
              <input type="hidden" name="campaignId" value={id} />
              <ConfirmSubmit
                variant="destructive"
                className="max-md:h-10"
                message={`Supprimer définitivement la campagne « ${campaign.name} », ses pubs, ses coûts et ses statistiques ? Les liens restent actifs mais ne seront plus rattachés à une campagne.`}
              >
                Supprimer la campagne
              </ConfirmSubmit>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
