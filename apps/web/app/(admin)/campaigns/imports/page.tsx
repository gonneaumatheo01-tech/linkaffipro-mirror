import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Historique des imports" };

const KIND_LABELS: Record<string, string> = { TIKTOK_CSV: "TikTok CSV", META_CSV: "Meta CSV", COSTS_MANUAL: "CSV générique", PLAYERS_CSV: "Joueurs CSV" };

export default async function ImportsPage({ searchParams }: PageProps<"/campaigns/imports">) {
  await requireUser();
  const sp = await searchParams;
  const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { createdBy: { select: { name: true } } } });
  return (
    <>
      <PageHeader title="Historique des imports" description="Fichiers de coûts importés, lignes lues et importées, erreurs.">
        <Button variant="outline" render={<Link href="/campaigns" />}>← Pubs</Button>
        <Button render={<Link href="/campaigns/import" />}>Importer un CSV</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardContent className="pt-6">
          {batches.length === 0 ? <p className="text-sm text-muted-foreground">Aucun import pour l&apos;instant.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Quand</TableHead><TableHead>Type</TableHead><TableHead>Fichier</TableHead><TableHead className="text-right">Lignes</TableHead><TableHead className="text-right">Importées</TableHead><TableHead>Erreurs</TableHead><TableHead>Par</TableHead></TableRow></TableHeader>
              <TableBody>
                {batches.map((b) => {
                  const errors = Array.isArray(b.errors) ? (b.errors as string[]) : [];
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(b.createdAt)}</TableCell>
                      <TableCell><Badge variant="outline">{KIND_LABELS[b.kind] ?? b.kind}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{b.filename}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(b.rows)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(b.imported)}</TableCell>
                      <TableCell className="max-w-md text-xs text-destructive">{errors.length === 0 ? <span className="text-muted-foreground">—</span> : <details><summary>{errors.length} erreur(s)</summary><ul className="list-disc pl-4">{errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul></details>}</TableCell>
                      <TableCell>{b.createdBy?.name ?? "—"}</TableCell>
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
