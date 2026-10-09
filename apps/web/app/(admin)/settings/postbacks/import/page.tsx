import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import de joueurs" };

export default async function PlayersImportPage() {
  await requireAdminPage();
  const [programs, batches] = await Promise.all([
    prisma.affiliateProgram.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.importBatch.findMany({ where: { kind: "PLAYERS_CSV" }, orderBy: { createdAt: "desc" }, take: 20, include: { createdBy: { select: { name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Importer des joueurs (CSV)" description="Pour les programmes sans API ni postback : chaque ligne est traitée comme un postback (idempotent, rattachement par sub_id).">
        <Button variant="outline" size="sm" render={<Link href="/settings/postbacks" />}>Retour aux postbacks</Button>
      </PageHeader>
      <ImportForm programs={programs} />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Derniers imports</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun import.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Fichier</TableHead>
                  <TableHead>Lignes</TableHead>
                  <TableHead>Importées</TableHead>
                  <TableHead>Erreurs</TableHead>
                  <TableHead>Par</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(b.createdAt)}</TableCell>
                    <TableCell>{b.filename}</TableCell>
                    <TableCell className="tabular-nums">{b.rows}</TableCell>
                    <TableCell className="tabular-nums">{b.imported}</TableCell>
                    <TableCell className="tabular-nums">{Array.isArray(b.errors) ? b.errors.length : 0}</TableCell>
                    <TableCell>{b.createdBy?.name ?? "—"}</TableCell>
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
