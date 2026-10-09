import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { BROADCAST_STATUS_LABELS, listBroadcasts, progressOf } from "@/lib/broadcasts/queries";

export const metadata: Metadata = { title: "Envois" };

const VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = { DRAFT: "outline", SCHEDULED: "secondary", SENDING: "default", SENT: "default", CANCELLED: "destructive" };

export default async function BroadcastsPage({ searchParams }: PageProps<"/broadcasts">) {
  const sp = await searchParams;
  const rows = await listBroadcasts();
  return (
    <>
      <PageHeader title="Envois" description="Messages privés groupés, envoyés à un segment de membres dans les limites Telegram.">
        <Button render={<Link href="/broadcasts/new" />}>Nouvel envoi</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun envoi pour l&apos;instant.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Bot</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Programmé</TableHead>
                  <TableHead>Ciblés</TableHead>
                  <TableHead>Envoyés</TableHead>
                  <TableHead>Échoués</TableHead>
                  <TableHead>Bloqués</TableHead>
                  <TableHead>Progression</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => {
                  const p = progressOf(b);
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <Link href={`/broadcasts/${b.id}`} className="font-medium underline-offset-2 hover:underline">
                          {b.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">par {b.createdBy?.name ?? "—"} · {fmtDate(b.createdAt)}</div>
                      </TableCell>
                      <TableCell>@{b.bot.username}</TableCell>
                      <TableCell>
                        <Badge variant={VARIANT[b.status] ?? "outline"}>{BROADCAST_STATUS_LABELS[b.status] ?? b.status}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(b.scheduledAt)}</TableCell>
                      <TableCell className="tabular-nums">{fmtNum(b.targeted)}</TableCell>
                      <TableCell className="tabular-nums">{fmtNum(b.sent)}</TableCell>
                      <TableCell className="tabular-nums">{fmtNum(b.failed)}</TableCell>
                      <TableCell className="tabular-nums">{fmtNum(b.blocked)}</TableCell>
                      <TableCell className="w-40">
                        <div className="h-2 w-full rounded bg-muted">
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
        </CardContent>
      </Card>
    </>
  );
}
