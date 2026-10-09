import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import de joueurs" };

export default async function PlayersImportPage() {
  await requireAdminPage();
  const [programs, batches] = await Promise.all([
    prisma.affiliateProgram.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.importBatch.findMany({
      where: { kind: "PLAYERS_CSV" },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { createdBy: { select: { name: true } } },
    }),
  ]);
  return (
    <>
      <PageHeader
        title="Importer des joueurs (CSV)"
        description="Pour les partenaires qui n'envoient ni postback ni données automatiques : chaque ligne du fichier est traitée comme un postback. Réimporter le même fichier ne crée pas de doublon."
        help="Choisissez le programme et le fichier, vérifiez l'aperçu, puis confirmez. Le rattachement au membre se fait par l'identifiant de suivi (sub-ID) s'il est présent dans le fichier."
      >
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings/postbacks" />}
        >
          ← Postbacks directs
        </Button>
      </PageHeader>
      <ImportForm programs={programs} />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Derniers imports</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <EmptyState
              title="Aucun import de joueurs pour l'instant."
              description="Le premier import apparaîtra ici avec le nombre de lignes lues et importées."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead className="hidden md:table-cell">Fichier</TableHead>
                  <TableHead className="text-right">Lignes</TableHead>
                  <TableHead className="text-right">Importées</TableHead>
                  <TableHead className="text-right">Erreurs</TableHead>
                  <TableHead className="hidden md:table-cell">Par</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtDate(b.createdAt)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{b.filename}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.rows}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.imported}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Array.isArray(b.errors) ? b.errors.length : 0}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {b.createdBy?.name ?? "—"}
                    </TableCell>
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
