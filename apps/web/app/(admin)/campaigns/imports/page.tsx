import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";

export const metadata: Metadata = { title: "Historique des imports" };

export default async function ImportsPage({ searchParams }: PageProps<"/campaigns/imports">) {
  await requireUser();
  const sp = await searchParams;
  const batches = await prisma.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { createdBy: { select: { name: true } } },
  });
  const reportId = Array.isArray(sp.batch) ? sp.batch[0] : sp.batch;
  const report = reportId ? (batches.find((b) => b.id === reportId) ?? null) : null;
  const reportLines = report && Array.isArray(report.errors) ? (report.errors as string[]) : [];
  // Regroupe les lignes ignorées par raison (« Ligne 12 : date illisible « n/a » » → « date illisible »).
  const reasons = new Map<string, number>();
  for (const line of reportLines) {
    const m = /^Ligne \d+ : ([^«]+?)(?: «.*)?$/.exec(line);
    const reason = m ? m[1]!.trim() : "erreur à l'enregistrement";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const ignored = report ? Math.max(0, report.rows - report.imported) : 0;
  return (
    <>
      <PageHeader
        title="Historique des imports"
        description="Fichiers importés (coûts et joueurs) : lignes lues, lignes importées, erreurs."
        help="Si un import a des erreurs, dépliez-les pour voir les lignes en cause, corrigez le fichier et réimportez-le."
      >
        <Button variant="outline" className="max-md:h-10" render={<Link href="/campaigns" />}>
          ← Pubs
        </Button>
        <Button className="max-md:h-10" render={<Link href="/campaigns/import" />}>
          Importer un CSV
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      {report ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Rapport d&apos;import · {report.filename}</CardTitle>
            <CardDescription>
              {fmtNum(report.rows)} ligne{report.rows > 1 ? "s" : ""} lue
              {report.rows > 1 ? "s" : ""} · {fmtNum(report.imported)} importée
              {report.imported > 1 ? "s" : ""} · {fmtNum(ignored)} ignorée{ignored > 1 ? "s" : ""}
              {report.createdBy?.name ? ` · par ${report.createdBy.name}` : ""} ·{" "}
              {fmtDate(report.createdAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {reasons.size === 0 ? (
              <p className="text-muted-foreground">
                Toutes les lignes ont été importées. Les coûts apparaissent dans la page Pubs et
                dans le tableau de bord (onglet Pubs) dans la minute.
              </p>
            ) : (
              <>
                <ul className="list-disc pl-5">
                  {[...reasons.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, count]) => (
                      <li key={reason}>
                        <strong>{fmtNum(count)}</strong> ligne{count > 1 ? "s" : ""} : {reason}
                      </li>
                    ))}
                </ul>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    Voir le détail ({reportLines.length} ligne{reportLines.length > 1 ? "s" : ""})
                  </summary>
                  <ul className="list-disc pl-4">
                    {reportLines.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
                <p className="text-xs text-muted-foreground">
                  Pour récupérer les lignes ignorées : corrigez-les dans le fichier (date, montant,
                  nom de pub) et réimportez-le ; les jours déjà importés seront simplement
                  remplacés.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="pt-6">
          {batches.length === 0 ? (
            <EmptyState
              title="Aucun import pour l'instant."
              description="Importez un rapport de coûts TikTok ou Meta pour calculer la rentabilité de vos pubs."
              action={{ href: "/campaigns/import", label: "Importer un CSV" }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Fichier</TableHead>
                  <TableHead className="text-right">Lignes</TableHead>
                  <TableHead className="text-right">Importées</TableHead>
                  <TableHead>Erreurs</TableHead>
                  <TableHead className="hidden md:table-cell">Par</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => {
                  const errors = Array.isArray(b.errors) ? (b.errors as string[]) : [];
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {fmtDate(b.createdAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="importKind" value={b.kind} />
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">
                        {b.filename}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(b.rows)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(b.imported)}
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal text-xs text-destructive">
                        {errors.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <details>
                            <summary className="cursor-pointer">
                              {errors.length} erreur{errors.length > 1 ? "s" : ""}
                            </summary>
                            <ul className="list-disc pl-4">
                              {errors.slice(0, 20).map((e, i) => (
                                <li key={i}>{e}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {b.createdBy?.name ?? "—"}
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
