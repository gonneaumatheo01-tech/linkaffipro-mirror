import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { listMembers, parseMemberFilters } from "@/lib/members/query";
import type { TabProps } from "./shared";

/** Onglet Membres : membres arrivés par les liens d'entrée de la campagne (même liste que Membres filtrée par campagne). */
export async function MembersTab({ id, sp }: TabProps) {
  const filters = { ...parseMemberFilters({}), campaignId: id, page: pageOf(sp) };
  const { rows, total, pages } = await listMembers(filters);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Membres ({fmtNum(total)})</CardTitle>
          <CardDescription>Personnes dont une demande d&apos;adhésion est passée par un lien d&apos;entrée de la campagne, avec leur niveau de dépense.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="max-md:h-10" render={<Link href={`/members?campaignId=${id}`} />}>
            Voir dans Membres
          </Button>
          <Button variant="outline" size="sm" className="max-md:h-10" render={<a href={`/members/export?campaignId=${id}`} />}>
            Exporter CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="Aucun membre arrivé par cette campagne pour l'instant." description="Les membres apparaissent dès qu'une personne clique un lien d'entrée de la campagne et demande à rejoindre le canal." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Membre</TableHead>
                  <TableHead className="hidden md:table-cell">Canaux</TableHead>
                  <TableHead className="hidden lg:table-cell">Pub d&apos;origine</TableHead>
                  <TableHead>Arrivé</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Clics</TableHead>
                  <TableHead>Niveau</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Dépôts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                        {m.displayName}
                      </Link>
                      {m.username ? <div className="text-xs text-muted-foreground">@{m.username}</div> : null}
                    </TableCell>
                    <TableCell className="hidden text-xs md:table-cell">{m.channels.join(", ") || "—"}</TableCell>
                    <TableCell className="hidden text-xs lg:table-cell">{m.source ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(m.firstSeenAt)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{fmtNum(m.clicks)}</TableCell>
                    <TableCell>
                      <Badge variant={m.level === "VIP" ? "default" : m.level === "AUCUN" ? "secondary" : "outline"}>{SPEND_LEVEL_LABELS[m.level]}</Badge>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {m.depositCount > 0 ? `${fmtNum(m.depositCount)} · ${fmtMoney(m.depositTotal)}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={filters.page} pages={pages} total={total} noun="membre" hrefFor={(n) => pageHref(`/campaigns/${id}`, { ...sp, ok: undefined, error: undefined }, n)} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
