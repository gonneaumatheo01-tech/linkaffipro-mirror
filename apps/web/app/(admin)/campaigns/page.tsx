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
import { fmtMoney, fmtNum } from "@/lib/format";
import { fmtRatio } from "@/lib/campaigns/metrics";
import { listCampaigns, rangeKeyOf, RANGES } from "@/lib/campaigns/queries";
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
  const range = rangeKeyOf(sp.range);
  const rows = await listCampaigns(range);
  const totals = rows.reduce(
    (t, r) => ({
      spend: t.spend + r.metrics.spend,
      members: t.members + r.metrics.members,
      registrations: t.registrations + r.metrics.registrations,
      ftds: t.ftds + r.metrics.ftds,
      revenue: t.revenue + r.metrics.revenue,
    }),
    { spend: 0, members: 0, registrations: 0, ftds: 0, revenue: 0 },
  );

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
          render={<a href={`/campaigns/export?range=${range}`} />}
        >
          Exporter CSV
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
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Période :</span>
        {(Object.keys(RANGES) as Array<keyof typeof RANGES>).map((k) => (
          <Link
            key={k}
            href={`/campaigns?range=${k}`}
            aria-current={k === range ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-md border px-3 md:min-h-8 md:px-2 ${k === range ? "bg-accent font-medium" : "text-muted-foreground"}`}
          >
            {k} jours
          </Link>
        ))}
        <Suspense fallback={null}>
          <RememberFilters storageKey="campaigns" className="max-md:h-10" />
        </Suspense>
      </div>
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
                      {fmtMoney(r.metrics.spend)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {fmtNum(r.metrics.entryClicks ?? 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(r.metrics.members)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {fmtNum(r.metrics.registrations)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(r.metrics.ftds)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {fmtMoney(r.metrics.cpl)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {fmtMoney(r.metrics.cpa)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {fmtMoney(r.metrics.costPerFtd)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {fmtMoney(r.metrics.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtRatio(r.metrics.roas)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell>Total</TableCell>
                  <TableCell className="hidden md:table-cell" />
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="text-right tabular-nums">
                    {fmtMoney(totals.spend)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(totals.members)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {fmtNum(totals.registrations)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(totals.ftds)}</TableCell>
                  <TableCell className="hidden md:table-cell" />
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {fmtMoney(totals.revenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtRatio(totals.spend > 0 ? totals.revenue / totals.spend : null)}
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
