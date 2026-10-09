import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Journal" };

export default async function JournalPage() {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { name: true } } } });
  return (
    <>
      <PageHeader title="Journal" description="Les 200 dernières actions des utilisateurs (journal d'audit, jamais modifié)." />
      <Card>
        <CardContent className="pt-6">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p>
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
        </CardContent>
      </Card>
    </>
  );
}
