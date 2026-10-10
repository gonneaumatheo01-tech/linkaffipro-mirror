import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/admin/data-table";
import {
  PAGE_SIZE,
  Pagination,
  pageCount,
  pageHref,
  pageSkip,
} from "@/components/admin/pagination";
import { RememberFilters } from "@/components/admin/remember-filters";
import { DetailList, DetailRow } from "@/components/settings/detail-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { fmtDate } from "@/lib/format";
import {
  actionFilterOptions,
  actionLabel,
  entityLabel,
  journalWhere,
  parseJournalFilters,
} from "@/lib/journal/query";
import { ViewTabs } from "./view-tabs";

export const metadata: Metadata = { title: "Journal" };

/**
 * Journal → Actions de l'équipe : tout ce qui a été fait sur le site, dans l'ordre, sans possibilité de le modifier.
 * Filtres (qui, type d'action choisi dans une liste de familles en français, période) mémorisés sur l'appareil ;
 * tableau de 4 colonnes, détail au clic (code technique, objet, détails) ; export CSV avec les mêmes filtres.
 */
export default async function JournalPage({ searchParams }: PageProps<"/settings/journal">) {
  const sp = await searchParams;
  // Ancienne adresse de la vue « Événements » (`/settings/journal?view=events`) : renvoi vers sa propre page, filtres gardés.
  if (sp.view === "events") {
    const rest = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "view" || v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) rest.append(k, item);
    }
    const q = rest.toString();
    redirect(q ? `/settings/journal/events?${q}` : "/settings/journal/events");
  }
  const f = parseJournalFilters(sp);
  const where = journalWhere(f);
  const [total, logs, users] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pageSkip(f.page),
      take: PAGE_SIZE,
      include: { user: { select: { name: true } } },
    }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const pages = pageCount(total);
  const hasFilters = Boolean(f.userId || f.action || f.from || f.to);
  const exportQuery = new URLSearchParams(
    Object.entries({ userId: f.userId, action: f.action, from: f.from, to: f.to }).filter(
      ([, v]) => v,
    ),
  ).toString();
  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Journal"
        description="Toutes les actions faites sur le site par l'équipe (et par le système), dans l'ordre, sans possibilité de les modifier."
        help="Filtrez par personne, par type d'action (par exemple « Écrire à un groupe ») ou par période. Les filtres sont mémorisés sur cet appareil."
        secondaryActions={
          <a
            href={`/settings/journal/export${exportQuery ? `?${exportQuery}` : ""}`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <Download aria-hidden />
            Exporter (CSV)
          </a>
        }
      />
      <ViewTabs view="actions" />
      <form
        method="get"
        aria-label="Filtrer le journal"
        className="mb-6 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
      >
        <div className="min-w-0 space-y-2">
          <Label htmlFor="journal-user">Qui</Label>
          <NativeSelect
            id="journal-user"
            name="userId"
            defaultValue={f.userId}
            wrapperClassName="w-full"
          >
            <option value="">Tout le monde</option>
            <option value="system">Système (sans utilisateur)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="journal-action">Type d&apos;action</Label>
          <NativeSelect
            id="journal-action"
            name="action"
            defaultValue={f.action}
            wrapperClassName="w-full"
          >
            <option value="">Toutes les actions</option>
            {actionFilterOptions(f.action).map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="journal-from">Du</Label>
          <Input id="journal-from" type="date" name="from" defaultValue={f.from} />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="journal-to">Au</Label>
          <Input id="journal-to" type="date" name="to" defaultValue={f.to} />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" variant="outline" className="max-md:h-10">
            Filtrer
          </Button>
          <Suspense fallback={null}>
            <RememberFilters storageKey="journal" className="max-md:h-10" />
          </Suspense>
        </div>
      </form>
      <div className="space-y-4">
        <DataTable
          label="Actions de l'équipe"
          columns={[
            { key: "when", header: "Quand" },
            { key: "who", header: "Qui", hideOnMobile: true },
            { key: "action", header: "Action", className: "whitespace-normal" },
            { key: "object", header: "Objet", hideOnMobile: true },
          ]}
          rows={logs.map((l) => {
            const details = l.metadata ? JSON.stringify(l.metadata, null, 2) : null;
            return {
              id: l.id,
              cells: {
                when: fmtDate(l.createdAt),
                who: l.user?.name ?? "système",
                action: actionLabel(l.action),
                object: entityLabel(l.entityType),
              },
              detailTitle: actionLabel(l.action),
              detailDescription: `${fmtDate(l.createdAt)} · ${l.user?.name ?? "système"}`,
              detail: (
                <div className="space-y-6">
                  <DetailList>
                    <DetailRow label="Quand">{fmtDate(l.createdAt)}</DetailRow>
                    <DetailRow label="Qui">{l.user?.name ?? "système"}</DetailRow>
                    <DetailRow label="Action">{actionLabel(l.action)}</DetailRow>
                    <DetailRow label="Code technique" mono>
                      {l.action}
                    </DetailRow>
                    <DetailRow label="Objet">{entityLabel(l.entityType)}</DetailRow>
                    {l.entityType ? (
                      <DetailRow label="Identifiant" mono>
                        {l.entityType} {l.entityId ?? ""}
                      </DetailRow>
                    ) : null}
                  </DetailList>
                  {details ? (
                    <div className="space-y-2">
                      <p className="text-body font-medium">Détails</p>
                      <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-muted/40 p-3 font-mono text-note whitespace-pre-wrap break-all">
                        {details}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ),
            };
          })}
          empty={
            hasFilters
              ? {
                  title: "Aucune action ne correspond à ces filtres.",
                  action: {
                    href: "/settings/journal",
                    label: "Voir tout le journal",
                    variant: "outline",
                  },
                }
              : {
                  title: "Le journal est vide pour l'instant.",
                  description:
                    "Chaque action faite sur le site (création, modification, envoi…) apparaîtra ici.",
                }
          }
        />
        <Pagination
          page={f.page}
          pages={pages}
          total={total}
          noun="action"
          hrefFor={(p) => pageHref("/settings/journal", sp, p)}
        />
      </div>
    </>
  );
}
