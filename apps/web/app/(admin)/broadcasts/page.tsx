import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { RememberFilters } from "@/components/admin/remember-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge, statusLabels } from "@/lib/status-badges";
import { listBroadcasts, progressOf } from "@/lib/broadcasts/queries";
import { listCampaignOptions } from "@/lib/campaigns/queries";

export const metadata: Metadata = { title: "Envois" };

const STATUS_OPTIONS = statusLabels("broadcast");

export default async function BroadcastsPage({ searchParams }: PageProps<"/broadcasts">) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" && sp.status in STATUS_OPTIONS ? sp.status : "";
  // Filtre campagne : `campaignId` (comme Messages, Membres et le tableau de bord ; ancien nom `campaign` accepté).
  const campaignId =
    typeof sp.campaignId === "string" && sp.campaignId
      ? sp.campaignId
      : typeof sp.campaign === "string"
        ? sp.campaign
        : "";
  const exportQs = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(campaignId ? { campaignId } : {}),
  }).toString();
  const [{ rows, total, pages, page }, campaigns] = await Promise.all([
    listBroadcasts(pageOf(sp), status || undefined, campaignId || undefined),
    listCampaignOptions(),
  ]);
  return (
    <>
      <PageHeader
        title="Envois"
        description="Messages privés envoyés en une fois à un groupe de membres (un « segment »), dans les limites imposées par Telegram."
        help="Créez un envoi, testez-le sur vous-même, puis envoyez ou programmez. Les versions d'un test A/B sont regroupées : cliquez sur le badge pour comparer."
      >
        <Button
          variant="outline"
          className="max-md:h-10"
          render={<a href={`/broadcasts/export${exportQs ? `?${exportQs}` : ""}`} />}
        >
          Exporter CSV
        </Button>
        <Button className="max-md:h-10" render={<Link href="/broadcasts/new" />}>
          Nouvel envoi
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="mb-4">
        <CardContent className="pt-6">
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            <div>
              <Label htmlFor="broadcasts-status" className="sr-only">
                Statut
              </Label>
              <select
                id="broadcasts-status"
                name="status"
                defaultValue={status}
                className="h-10 rounded-md border bg-background px-2 text-sm md:h-9"
              >
                <option value="">Tous les statuts</option>
                {Object.entries(STATUS_OPTIONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="broadcasts-campaign" className="sr-only">
                Campagne
              </Label>
              <select
                id="broadcasts-campaign"
                name="campaignId"
                defaultValue={campaignId}
                title="Envois dont le segment vise la campagne ou un de ses canaux"
                className="h-10 rounded-md border bg-background px-2 text-sm md:h-9"
              >
                <option value="">Toutes les campagnes</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" className="max-md:h-10">
              Filtrer
            </Button>
            <Suspense fallback={null}>
              <RememberFilters storageKey="broadcasts" className="max-md:h-10" />
            </Suspense>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {total === 0 ? (
            status || campaignId ? (
              <EmptyState
                title={
                  campaignId ? "Aucun envoi lié à cette campagne." : "Aucun envoi avec ce statut."
                }
                action={{ href: "/broadcasts", label: "Voir tous les envois", variant: "outline" }}
              />
            ) : (
              <EmptyState
                title="Aucun envoi groupé pour l'instant."
                description="Un envoi groupé permet d'écrire en privé à un groupe de membres : relance, bonus, nouveauté. Commencez par un test sur vous-même."
                action={{ href: "/broadcasts/new", label: "Créer un envoi" }}
              />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead className="hidden md:table-cell">Bot</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden lg:table-cell">Programmé</TableHead>
                  <TableHead className="hidden md:table-cell">Ciblés</TableHead>
                  <TableHead>Envoyés</TableHead>
                  <TableHead className="hidden lg:table-cell">Échoués</TableHead>
                  <TableHead className="hidden lg:table-cell">Bloqués</TableHead>
                  <TableHead className="hidden md:table-cell">Progression</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => {
                  const p = progressOf(b);
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <Link
                          href={`/broadcasts/${b.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {b.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          par {b.createdBy?.name ?? "—"} · {fmtDate(b.createdAt)}
                        </div>
                        {b.abGroupId ? (
                          <Link
                            href={`/broadcasts/ab/${b.abGroupId}`}
                            className="mt-1 inline-block"
                          >
                            <Badge variant="secondary">
                              Test A/B ·{" "}
                              {b.abVariant === "REST"
                                ? "envoi au reste"
                                : `version ${b.abVariant}${b.abSplit !== null ? ` (${b.abSplit} %)` : ""}`}
                            </Badge>
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">@{b.bot.username}</TableCell>
                      <TableCell>
                        <StatusBadge kind="broadcast" value={b.status} />
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                        {fmtDate(b.scheduledAt)}
                      </TableCell>
                      <TableCell className="hidden tabular-nums md:table-cell">
                        {fmtNum(b.targeted)}
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtNum(b.sent)}</TableCell>
                      <TableCell className="hidden tabular-nums lg:table-cell">
                        {fmtNum(b.failed)}
                      </TableCell>
                      <TableCell className="hidden tabular-nums lg:table-cell">
                        {fmtNum(b.blocked)}
                      </TableCell>
                      <TableCell className="hidden w-40 md:table-cell">
                        <div
                          className="h-2 w-full rounded bg-muted"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={p.pct}
                          aria-label={`Progression ${p.pct} %`}
                        >
                          <div className="h-2 rounded bg-primary" style={{ width: `${p.pct}%` }} />
                        </div>
                        <div className="text-xs text-muted-foreground">{p.pct} %</div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pagination
            page={page}
            pages={pages}
            total={total}
            noun="envoi"
            hrefFor={(p) => pageHref("/broadcasts", { ...sp, ok: undefined, error: undefined }, p)}
          />
        </CardContent>
      </Card>
    </>
  );
}
