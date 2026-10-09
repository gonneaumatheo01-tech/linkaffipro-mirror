import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { VERTICAL_LABELS, type Vertical } from "@linkaffipro/core";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { RememberFilters } from "@/components/admin/remember-filters";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PeriodSelect } from "@/components/admin/period-select";
import { Delta } from "@/components/dashboard/delta";
import { fmtMoney, fmtNum } from "@/lib/format";
import { fmtRatio } from "@/lib/campaigns/metrics";
import { listCampaigns, type CampaignDeltas } from "@/lib/campaigns/queries";
import {
  parseCompare,
  periodLabel,
  periodParams,
  previousPeriod,
  resolvePeriod,
  variationOf,
} from "@/lib/periods";
import { requireUser } from "@/lib/session";
import { StatusBadge, statusLabel } from "@/lib/status-badges";

export const metadata: Metadata = { title: "Pubs" };

const TIPS = {
  members: "Membres : demandes d'adhésion acceptées via les liens d'entrée de cette pub.",
  registrations:
    "Inscrits : joueurs qui se sont inscrits chez un partenaire après un clic sur une offre, rattachés à cette pub grâce à l'identifiant de suivi (sub-ID).",
  ftd: "Premier dépôt (FTD) : joueurs rattachés à la pub qui ont déposé de l'argent au moins une fois.",
  cpl: "Coût par membre arrivé (CPL) = dépense / membres entrés.",
  cpa: "CPA (coût par inscrit) : dépense divisée par le nombre d'inscrits.",
  costPerFtd: "Coût par FTD : dépense divisée par le nombre de premiers dépôts.",
  revenue: "Revenu : NGR (revenu net) des joueurs rattachés à la pub, remonté par Link Affi.",
  roas: "ROAS (retour sur dépense) : revenu divisé par dépense. 1,00× = remboursé, au-dessus = rentable.",
};

function Head({ label, tip, className }: { label: string; tip?: string; className?: string }) {
  return (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1">
        {label}
        {tip ? <HelpTip>{tip}</HelpTip> : null}
      </span>
    </TableHead>
  );
}

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  await requireUser();
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const compare = parseCompare(sp.compare);
  const pp = periodParams(period, compare);
  const rows = await listCampaigns(period, compare);
  const sum = (
    pick: (
      r: (typeof rows)[number],
    ) => {
      spend: number;
      members: number;
      registrations: number;
      ftds: number;
      revenue: number;
    } | null,
  ) =>
    rows.reduce(
      (t, r) => {
        const m = pick(r);
        if (!m) return t;
        return {
          spend: t.spend + m.spend,
          members: t.members + m.members,
          registrations: t.registrations + m.registrations,
          ftds: t.ftds + m.ftds,
          revenue: t.revenue + m.revenue,
        };
      },
      { spend: 0, members: 0, registrations: 0, ftds: 0, revenue: 0 },
    );
  const totals = sum((r) => r.metrics);
  const prevTotals = compare ? sum((r) => r.previous) : null;
  const totalRoas = totals.spend > 0 ? totals.revenue / totals.spend : null;
  const prevTotalRoas =
    prevTotals && prevTotals.spend > 0 ? prevTotals.revenue / prevTotals.spend : null;
  /** Variation d'une colonne d'une ligne (rien si la comparaison est désactivée). */
  const delta = (d: CampaignDeltas | null, key: keyof CampaignDeltas, invert = false) =>
    compare ? <Delta value={d?.[key]} invert={invert} /> : null;

  return (
    <>
      <PageHeader
        title="Pubs"
        description="Ce que coûte et ce que rapporte chaque pub : dépense, membres entrés, inscrits, premiers dépôts (FTD), coût par membre arrivé (CPL), coût par inscrit (CPA) et retour sur dépense (ROAS)."
        help="Créez une pub, rattachez-lui un lien d'entrée (page Liens), puis importez les coûts TikTok ou Meta en CSV. La période choisie est mémorisée."
      >
        <Button
          variant="outline"
          className="max-md:h-10"
          render={<a href={`/campaigns/export?${new URLSearchParams(pp).toString()}`} />}
        >
          Exporter CSV{compare ? " (avec comparaison)" : ""}
        </Button>
        <Button
          variant="outline"
          className="max-md:h-10"
          render={<Link href="/campaigns/import" />}
        >
          Importer un CSV
        </Button>
        <Button
          variant="outline"
          className="max-md:h-10"
          render={<Link href="/campaigns/imports" />}
        >
          Historique des imports
        </Button>
        <Button className="max-md:h-10" render={<Link href="/campaigns/new" />}>
          Nouvelle pub
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="mb-2 flex flex-wrap items-end gap-2 text-sm">
        <PeriodSelect period={period} compare={compare} action="/campaigns" />
        <Suspense fallback={null}>
          <RememberFilters storageKey="campaigns" className="max-md:h-10" />
        </Suspense>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Période : {periodLabel(period)}
        {compare
          ? ` · comparée à la précédente (${periodLabel(previousPeriod(period))}). Vert = favorable, rouge = défavorable (pour les coûts, une baisse est favorable).`
          : ". Cochez « Comparer » pour afficher la variation par rapport à la période précédente."}
      </p>
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <EmptyState
              title="Aucune pub pour l'instant."
              description="Créez une pub à la main, ou importez un CSV TikTok / Meta : les pubs seront créées automatiquement à partir des noms de campagne."
              action={{ href: "/campaigns/new", label: "Créer une pub" }}
            >
              <Button
                variant="outline"
                className="max-md:h-10"
                render={<Link href="/campaigns/import" />}
              >
                Importer un CSV de coûts
              </Button>
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pub</TableHead>
                  <TableHead className="hidden md:table-cell">Plateforme</TableHead>
                  <TableHead className="hidden lg:table-cell">Canaux</TableHead>
                  <TableHead className="text-right">Dépense</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Clics</TableHead>
                  <Head label="Membres" tip={TIPS.members} className="text-right" />
                  <Head
                    label="Inscrits"
                    tip={TIPS.registrations}
                    className="hidden text-right md:table-cell"
                  />
                  <Head label="FTD" tip={TIPS.ftd} className="text-right" />
                  <Head label="CPL" tip={TIPS.cpl} className="hidden text-right md:table-cell" />
                  <Head label="CPA" tip={TIPS.cpa} className="hidden text-right lg:table-cell" />
                  <Head
                    label="Coût/FTD"
                    tip={TIPS.costPerFtd}
                    className="hidden text-right lg:table-cell"
                  />
                  <Head
                    label="Revenu"
                    tip={TIPS.revenue}
                    className="hidden text-right md:table-cell"
                  />
                  <Head label="ROAS" tip={TIPS.roas} className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/campaigns/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {statusLabel("campaign", r.status)}
                        {r.vertical ? ` · ${VERTICAL_LABELS[r.vertical as Vertical]}` : ""} ·{" "}
                        {r.links} lien{r.links > 1 ? "s" : ""} d&apos;entrée
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.adPlatform ? <StatusBadge kind="adPlatform" value={r.adPlatform} /> : "—"}
                    </TableCell>
                    <TableCell className="hidden text-xs lg:table-cell">
                      {r.channels.join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{fmtMoney(r.metrics.spend)}</div>
                      {delta(r.deltas, "spend", true)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      <div>{fmtNum(r.metrics.entryClicks ?? 0)}</div>
                      {delta(r.deltas, "entryClicks")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{fmtNum(r.metrics.members)}</div>
                      {delta(r.deltas, "members")}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      <div>{fmtNum(r.metrics.registrations)}</div>
                      {delta(r.deltas, "registrations")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{fmtNum(r.metrics.ftds)}</div>
                      {delta(r.deltas, "ftds")}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      <div>{fmtMoney(r.metrics.cpl)}</div>
                      {delta(r.deltas, "cpl", true)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      <div>{fmtMoney(r.metrics.cpa)}</div>
                      {delta(r.deltas, "cpa", true)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      <div>{fmtMoney(r.metrics.costPerFtd)}</div>
                      {delta(r.deltas, "costPerFtd", true)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      <div>{fmtMoney(r.metrics.revenue)}</div>
                      {delta(r.deltas, "revenue")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{fmtRatio(r.metrics.roas)}</div>
                      {delta(r.deltas, "roas")}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell>Total</TableCell>
                  <TableCell className="hidden md:table-cell" />
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="text-right tabular-nums">
                    <div>{fmtMoney(totals.spend)}</div>
                    {prevTotals ? (
                      <Delta value={variationOf(totals.spend, prevTotals.spend)} invert />
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="text-right tabular-nums">
                    <div>{fmtNum(totals.members)}</div>
                    {prevTotals ? (
                      <Delta value={variationOf(totals.members, prevTotals.members)} />
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    <div>{fmtNum(totals.registrations)}</div>
                    {prevTotals ? (
                      <Delta value={variationOf(totals.registrations, prevTotals.registrations)} />
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div>{fmtNum(totals.ftds)}</div>
                    {prevTotals ? (
                      <Delta value={variationOf(totals.ftds, prevTotals.ftds)} />
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden md:table-cell" />
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    <div>{fmtMoney(totals.revenue)}</div>
                    {prevTotals ? (
                      <Delta value={variationOf(totals.revenue, prevTotals.revenue)} />
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div>{fmtRatio(totalRoas)}</div>
                    {prevTotals ? <Delta value={variationOf(totalRoas, prevTotalRoas)} /> : null}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        Membres = demandes acceptées via les liens d&apos;entrée de la pub. Inscrits / FTD / revenu
        = joueurs rattachés à la pub par l&apos;identifiant de suivi (sub-ID). Coût par membre
        arrivé (CPL) = dépense / membres entrés ; CPA = dépense / inscrits ; ROAS = revenu /
        dépense. Sur téléphone, tournez l&apos;écran ou exportez en CSV pour voir toutes les
        colonnes.
      </p>
    </>
  );
}
