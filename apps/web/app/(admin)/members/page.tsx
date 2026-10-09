import type { Metadata } from "next";
import Link from "next/link";
import { SPEND_LEVELS, SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Pagination } from "@/components/admin/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { filtersToQuery, listMembers, parseMemberFilters } from "@/lib/members/query";

export const metadata: Metadata = { title: "Membres" };

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: "Demande en attente",
  PENDING_GATE: "Attente canaux requis",
  SCHEDULED: "Acceptation programmée",
  APPROVED: "Accepté",
  DECLINED: "Refusé",
  LEFT: "Parti",
  KICKED: "Exclu",
  EXPIRED: "Expiré",
  FAILED: "Échec",
};

export function LevelBadge({ level }: { level: keyof typeof SPEND_LEVEL_LABELS }) {
  const variant = level === "VIP" ? "default" : level === "AUCUN" ? "secondary" : "outline";
  return <Badge variant={variant}>{SPEND_LEVEL_LABELS[level]}</Badge>;
}

export default async function MembersPage({ searchParams }: PageProps<"/members">) {
  const sp = await searchParams;
  const f = parseMemberFilters(sp);
  const [{ rows, total, pages }, channels, links] = await Promise.all([
    listMembers(f),
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.inviteLink.findMany({ where: { kind: "AD_ENTRY" }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, name: true } }),
  ]);
  const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";
  const sortLink = (s: "lastSeen" | "firstSeen" | "name", label: string) => (
    <Link href={`/members${filtersToQuery(f, { sort: s, page: 1 })}`} className={f.sort === s ? "font-semibold underline" : "hover:underline"}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title="Membres" description="Tous les membres Telegram vus par nos bots, avec leur origine et leur niveau de dépense.">
        <Button variant="outline" render={<a href={`/members/export${filtersToQuery(f)}`} />}>Exporter en CSV</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="mb-4">
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 md:grid-cols-4 lg:grid-cols-8">
            <Input name="q" defaultValue={f.q} placeholder="Prénom, @pseudo ou identifiant" className="lg:col-span-2" />
            <select name="channelId" defaultValue={f.channelId} className={selectCls}>
              <option value="">Tous les canaux</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <select name="status" defaultValue={f.status} className={selectCls}>
              <option value="">Tout statut</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select name="inviteLinkId" defaultValue={f.inviteLinkId} className={selectCls}>
              <option value="">Toute source</option>
              {links.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select name="level" defaultValue={f.level} className={selectCls}>
              <option value="">Tout niveau</option>
              {SPEND_LEVELS.map((l) => <option key={l} value={l}>{SPEND_LEVEL_LABELS[l]}</option>)}
            </select>
            <Input name="language" defaultValue={f.language} placeholder="Langue (fr)" className="w-full" />
            <div className="flex gap-1">
              <Input type="date" name="since" defaultValue={f.since} title="Arrivé après" />
              <Input type="date" name="until" defaultValue={f.until} title="Arrivé avant" />
            </div>
            <div className="flex gap-2 lg:col-span-8">
              <Button type="submit" size="sm">Filtrer</Button>
              <Button type="button" size="sm" variant="ghost" render={<Link href="/members" />}>Réinitialiser</Button>
              <span className="ml-auto self-center text-xs text-muted-foreground">Tri : {sortLink("lastSeen", "dernier événement")} · {sortLink("firstSeen", "arrivée")} · {sortLink("name", "nom")}</span>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun membre ne correspond.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Membre</TableHead>
                  <TableHead>Canaux</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Arrivé le</TableHead>
                  <TableHead>Dernier événement</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead>Joueur</TableHead>
                  <TableHead>FTD</TableHead>
                  <TableHead className="text-right">Dépôts</TableHead>
                  <TableHead>Niveau</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/members/${r.id}`} className="font-medium hover:underline">{r.displayName}</Link>
                      <div className="text-xs text-muted-foreground">{r.username ? `@${r.username} · ` : ""}{r.languageCode ?? "—"}</div>
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-xs" title={r.channels.join(", ")}>{r.channels.join(", ") || "—"}</TableCell>
                    <TableCell className="text-xs">{r.source ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.firstSeenAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.lastEventAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.clicks}</TableCell>
                    <TableCell>{r.isPlayer ? "oui" : "non"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{r.ftdAt ? fmtDate(r.ftdAt) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.depositCount} · {fmtNum(Math.round(r.depositTotal))} €</TableCell>
                    <TableCell><LevelBadge level={r.level} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination page={f.page} pages={pages} total={total} noun="membre" hrefFor={(p) => `/members${filtersToQuery(f, { page: p })}`} />
        </CardContent>
      </Card>
    </>
  );
}
