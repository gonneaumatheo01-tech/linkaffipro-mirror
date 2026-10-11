import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, Send } from "lucide-react";
import { parseSegment } from "@linkaffipro/core";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { RememberFilters } from "@/components/admin/remember-filters";
import { MembersNav } from "@/components/members/members-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { abLabel, broadcastDateInfo, resultsLine } from "@/lib/broadcasts/display";
import { describeGroup, type GroupNames } from "@/lib/broadcasts/group";
import { listBroadcasts, type BroadcastRow } from "@/lib/broadcasts/queries";
import { clicksByBroadcast, loadGroupNames } from "@/lib/broadcasts/results";
import { listCampaignOptions } from "@/lib/campaigns/queries";
import { fmtDate } from "@/lib/format";
import { StatusBadge, statusLabels } from "@/lib/status-badges";

export const metadata: Metadata = { title: "Écrire à un groupe" };

const STATUS_OPTIONS = statusLabels("broadcast");

/** Ligne de la liste, prête à afficher (cellules rendues côté serveur). */
function rowOf(
  b: BroadcastRow,
  names: GroupNames,
  clicks: { clicks: number; uniqueClicks: number },
): DataTableRow {
  const group = describeGroup(parseSegment(b.segment), names);
  const when = broadcastDateInfo(b);
  const ab = abLabel(b);
  const results = resultsLine({
    status: b.status,
    sent: b.sent,
    uniqueClicks: clicks.uniqueClicks,
  });
  const dateCell = (
    <span className="whitespace-nowrap">
      <span className="block text-note text-muted-foreground">{when.label}</span>
      <time dateTime={when.date.toISOString()}>{fmtDate(when.date)}</time>
    </span>
  );
  return {
    id: b.id,
    href: `/members/broadcasts/${b.id}`,
    cells: {
      name: (
        <span className="block min-w-0 py-1 whitespace-normal">
          <span className="block break-words">{b.name}</span>
          <span className="block text-note font-normal text-muted-foreground">
            @{b.bot.username}
            {b.createdBy?.name ? ` · par ${b.createdBy.name}` : ""}
          </span>
          {ab ? (
            <Badge variant="outline" className="mt-1 font-normal">
              {ab}
            </Badge>
          ) : null}
          {/* Téléphone : la ligne devient une carte (groupe, statut, résultats et date dedans). */}
          <span className="mt-2 block space-y-1 font-normal md:hidden">
            <span className="line-clamp-2 block text-note text-muted-foreground">{group}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusBadge kind="broadcast" value={b.status} />
              <span className="text-note">{results}</span>
            </span>
            <span className="block text-note text-muted-foreground">
              {when.label} {fmtDate(when.date)}
            </span>
          </span>
        </span>
      ),
      group: (
        <span className="line-clamp-2 block max-w-80 text-body whitespace-normal" title={group}>
          {group}
        </span>
      ),
      status: <StatusBadge kind="broadcast" value={b.status} />,
      results: (
        <span className="block">
          <span className="block whitespace-nowrap">{results}</span>
          {b.abGroupId ? (
            <Link
              href={`/members/broadcasts/ab/${b.abGroupId}`}
              className="text-note font-medium text-brand-ink underline-offset-2 hover:underline"
            >
              Comparer les versions
            </Link>
          ) : null}
        </span>
      ),
      date: dateCell,
    },
  };
}

export default async function BroadcastsPage({ searchParams }: PageProps<"/members/broadcasts">) {
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
  const [clicks, names] = await Promise.all([
    clicksByBroadcast(rows.map((b) => b.id)),
    loadGroupNames(rows.map((b) => parseSegment(b.segment))),
  ]);
  const filtered = Boolean(status || campaignId);
  const tableRows = rows.map((b) =>
    rowOf(b, names, clicks.get(b.id) ?? { clicks: 0, uniqueClicks: 0 }),
  );

  return (
    <>
      <MembersNav current="broadcasts" />
      <PageHeader
        title="Écrire à un groupe"
        description="Les messages privés envoyés par vos bots à un groupe de membres, et ce qu'ils ont donné."
        help="Écrivez votre message, envoyez-vous un test, puis envoyez-le ou programmez-le. Telegram limite le rythme : un gros groupe met quelques minutes."
        primaryAction={{
          label: "Nouveau message",
          href: "/members/broadcasts/new",
          icon: <Send aria-hidden />,
        }}
        secondaryActions={
          <a
            href={`/members/broadcasts/export${exportQs ? `?${exportQs}` : ""}`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <Download aria-hidden />
            Exporter
          </a>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <form method="get" className="mb-4 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <div className="min-w-0 space-y-1 sm:w-56">
          <Label htmlFor="broadcasts-status" className="text-note text-muted-foreground">
            Statut
          </Label>
          <NativeSelect
            id="broadcasts-status"
            name="status"
            defaultValue={status}
            wrapperClassName="w-full"
          >
            <option value="">Tous</option>
            {Object.entries(STATUS_OPTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1 sm:w-64">
          <Label htmlFor="broadcasts-campaign" className="text-note text-muted-foreground">
            Campagne
          </Label>
          <NativeSelect
            id="broadcasts-campaign"
            name="campaignId"
            defaultValue={campaignId}
            wrapperClassName="w-full"
          >
            <option value="">Toutes</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="col-span-2 flex flex-wrap gap-2">
          <Button type="submit" variant="outline" className="max-md:h-10">
            Filtrer
          </Button>
          <Suspense fallback={null}>
            <RememberFilters storageKey="broadcasts" className="max-md:h-10" />
          </Suspense>
        </div>
      </form>
      {campaignId ? (
        <p className="mb-3 text-note text-muted-foreground">
          Envois dont le groupe vise la campagne ou un de ses canaux.
        </p>
      ) : null}
      {total === 0 ? (
        filtered ? (
          <EmptyState
            title={campaignId ? "Aucun envoi lié à cette campagne" : "Aucun envoi avec ce statut"}
            description="Changez de filtre pour voir les autres envois."
            action={{
              href: "/members/broadcasts?status=",
              label: "Voir tous les envois",
              variant: "outline",
            }}
          />
        ) : (
          <EmptyState
            icon={<Send />}
            title="Aucun message à un groupe pour l'instant"
            description="Écrivez en privé à un groupe de membres : relance, bonus, nouveauté. Commencez par un test sur vous-même."
          />
        )
      ) : (
        <>
          <DataTable
            label="Messages envoyés à un groupe"
            columns={[
              { key: "name", header: "Envoi", sortable: false },
              { key: "group", header: "Groupe de membres", sortable: false, hideOnMobile: true },
              { key: "status", header: "Statut", sortable: false, hideOnMobile: true },
              { key: "results", header: "Envoyés et clics", sortable: false, hideOnMobile: true },
              { key: "date", header: "Date", sortable: false, hideOnMobile: true },
            ]}
            rows={tableRows}
          />
          <Pagination
            page={page}
            pages={pages}
            total={total}
            noun="envoi"
            hrefFor={(p) =>
              pageHref("/members/broadcasts", { ...sp, ok: undefined, error: undefined }, p)
            }
          />
        </>
      )}
    </>
  );
}
