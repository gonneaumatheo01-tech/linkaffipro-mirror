import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import {
  PAGE_SIZE,
  Pagination,
  pageCount,
  pageHref,
  pageSkip,
} from "@/components/admin/pagination";
import { RememberFilters } from "@/components/admin/remember-filters";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { actionLabel, journalWhere, parseJournalFilters } from "@/lib/journal/query";
import { ViewTabs } from "./view-tabs";

export const metadata: Metadata = { title: "Journal" };

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
  const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-9";
  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Journal"
        description="Toutes les actions faites sur le site par l'équipe (et par le système), dans l'ordre, sans possibilité de les modifier. L'onglet « Événements » montre l'activité des bots et des membres."
        help="Filtrez par personne, par type d'action (ex. « broadcast. » pour les envois) ou par période. Les filtres sont mémorisés sur cet appareil."
      >
        <Button
          variant="outline"
          className="max-md:h-10"
          render={<a href={`/settings/journal/export${exportQuery ? `?${exportQuery}` : ""}`} />}
        >
          Exporter CSV
        </Button>
      </PageHeader>
      <ViewTabs view="actions" />
      <Card className="mb-4">
        <CardContent className="pt-6">
          <form method="get" className="grid gap-2 text-sm sm:flex sm:flex-wrap sm:items-end">
            <div>
              <Label htmlFor="journal-user" className="sr-only">
                Qui
              </Label>
              <select
                id="journal-user"
                name="userId"
                defaultValue={f.userId}
                className={`${selectCls} w-full`}
              >
                <option value="">Tout le monde</option>
                <option value="system">Système (sans utilisateur)</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="journal-action" className="sr-only">
                Action
              </Label>
              <Input
                id="journal-action"
                name="action"
                defaultValue={f.action}
                placeholder="Action (ex. user. ou bot.created)"
                className="h-10 w-full sm:w-64 md:h-9"
              />
            </div>
            <div>
              <Label htmlFor="journal-from" className="sr-only">
                Du
              </Label>
              <Input
                id="journal-from"
                type="date"
                name="from"
                defaultValue={f.from}
                title="Du"
                className="h-10 w-full sm:w-40 md:h-9"
              />
            </div>
            <div>
              <Label htmlFor="journal-to" className="sr-only">
                Au
              </Label>
              <Input
                id="journal-to"
                type="date"
                name="to"
                defaultValue={f.to}
                title="Au"
                className="h-10 w-full sm:w-40 md:h-9"
              />
            </div>
            <Button type="submit" size="sm" className="max-md:h-10">
              Filtrer
            </Button>
            <Suspense fallback={null}>
              <RememberFilters storageKey="journal" className="max-md:h-10" />
            </Suspense>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {logs.length === 0 ? (
            hasFilters ? (
              <EmptyState
                title="Aucune action ne correspond à ces filtres."
                action={{
                  href: "/settings/journal",
                  label: "Voir tout le journal",
                  variant: "outline",
                }}
              />
            ) : (
              <EmptyState
                title="Le journal est vide pour l'instant."
                description="Chaque action faite sur le site (création, modification, envoi…) apparaîtra ici."
              />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Qui</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Objet</TableHead>
                  <TableHead className="hidden lg:table-cell">Détails</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtDate(l.createdAt)}
                    </TableCell>
                    <TableCell>{l.user?.name ?? "système"}</TableCell>
                    <TableCell>
                      <div className="text-sm">{actionLabel(l.action)}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{l.action}</div>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {l.entityType ? `${l.entityType} ${l.entityId ?? ""}` : "—"}
                    </TableCell>
                    <TableCell
                      className="hidden max-w-md truncate font-mono text-[11px] text-muted-foreground lg:table-cell"
                      title={l.metadata ? JSON.stringify(l.metadata) : ""}
                    >
                      {l.metadata ? JSON.stringify(l.metadata) : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination
            page={f.page}
            pages={pages}
            total={total}
            noun="action"
            hrefFor={(p) => pageHref("/settings/journal", sp, p)}
          />
        </CardContent>
      </Card>
    </>
  );
}
