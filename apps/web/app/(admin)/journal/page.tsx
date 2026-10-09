import type { Metadata } from "next";
import Link from "next/link";
import { prisma, type Prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { PAGE_SIZE, Pagination, pageCount, pageHref, pageOf, pageSkip } from "@/components/admin/pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Journal" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Filtres du journal lus depuis l'URL (conservés dans les liens de pagination). */
function parseJournalFilters(sp: SP): { userId: string; action: string; from: string; to: string; page: number } {
  return { userId: one(sp.userId), action: one(sp.action).trim().slice(0, 60), from: one(sp.from), to: one(sp.to), page: pageOf(sp) };
}

/** Clause Prisma correspondant aux filtres (fonction pure). */
function journalWhere(f: { userId: string; action: string; from: string; to: string }): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (f.userId === "system") where.userId = null;
  else if (f.userId) where.userId = f.userId;
  if (f.action) where.action = { startsWith: f.action };
  const fromDate = f.from ? new Date(`${f.from}T00:00:00+02:00`) : null;
  const toDate = f.to ? new Date(`${f.to}T23:59:59.999+02:00`) : null;
  if ((fromDate && !Number.isNaN(fromDate.getTime())) || (toDate && !Number.isNaN(toDate.getTime()))) {
    where.createdAt = { ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: fromDate } : {}), ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: toDate } : {}) };
  }
  return where;
}

export default async function JournalPage({ searchParams }: PageProps<"/journal">) {
  const sp = await searchParams;
  const f = parseJournalFilters(sp);
  const where = journalWhere(f);
  const [total, logs, users] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: pageSkip(f.page), take: PAGE_SIZE, include: { user: { select: { name: true } } } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const pages = pageCount(total);
  const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";
  return (
    <>
      <PageHeader title="Journal" description="Toutes les actions des utilisateurs (journal d'audit, jamais modifié). Filtrez par personne, par action ou par période." />
      <Card className="mb-4">
        <CardContent className="pt-6">
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            <select name="userId" defaultValue={f.userId} className={selectCls} aria-label="Utilisateur">
              <option value="">Tout le monde</option>
              <option value="system">Système (sans utilisateur)</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <Input name="action" defaultValue={f.action} placeholder="Action (ex. user. ou bot.created)" className="w-64" aria-label="Action" />
            <Input type="date" name="from" defaultValue={f.from} title="Du" aria-label="Du" className="w-40" />
            <Input type="date" name="to" defaultValue={f.to} title="Au" aria-label="Au" className="w-40" />
            <Button type="submit" size="sm">Filtrer</Button>
            <Button type="button" size="sm" variant="ghost" render={<Link href="/journal" />}>Réinitialiser</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune action ne correspond.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Qui</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Objet</TableHead>
                  <TableHead>Détails</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(l.createdAt)}</TableCell>
                    <TableCell>{l.user?.name ?? "système"}</TableCell>
                    <TableCell className="font-mono text-xs">{l.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.entityType ? `${l.entityType} ${l.entityId ?? ""}` : "—"}</TableCell>
                    <TableCell className="max-w-md truncate font-mono text-[11px] text-muted-foreground">{l.metadata ? JSON.stringify(l.metadata) : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination page={f.page} pages={pages} total={total} noun="action" hrefFor={(p) => pageHref("/journal", sp, p)} />
        </CardContent>
      </Card>
    </>
  );
}
