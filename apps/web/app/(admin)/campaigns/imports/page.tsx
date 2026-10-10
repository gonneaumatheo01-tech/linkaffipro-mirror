import type { Metadata } from "next";
import { FileUp } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { DataTable } from "@/components/admin/data-table";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { groupImportErrors, ignoredRows, importErrorLines } from "@/lib/campaigns/import-report";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge, statusLabel } from "@/lib/status-badges";

export const metadata: Metadata = { title: "Historique des imports" };

/** Raisons des lignes ignorées d'un import, puis le détail ligne par ligne replié. */
function Reasons({ lines }: { lines: string[] }) {
  const reasons = groupImportErrors(lines);
  if (reasons.length === 0)
    return <p className="text-body text-muted-foreground">Toutes les lignes ont été importées.</p>;
  return (
    <div className="space-y-3">
      <ul className="list-disc space-y-1 pl-5 text-body">
        {reasons.map((r) => (
          <li key={r.reason}>
            <span className="font-medium tabular-nums">{fmtNum(r.count)}</span> ligne
            {r.count > 1 ? "s" : ""} : {r.reason}
          </li>
        ))}
      </ul>
      <details className="text-note text-muted-foreground">
        <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-foreground md:min-h-8">
          Voir les lignes en cause ({lines.length})
        </summary>
        <ul className="list-disc space-y-0.5 pl-4">
          {lines.slice(0, 200).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * Historique des imports (coûts et joueurs) : un tableau de 5 colonnes au plus, le détail d'un import (raisons des
 * lignes ignorées) dans un volet ; le rapport de l'import qui vient d'être fait (`?batch=`) en haut de page.
 */
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
  const reportLines = report ? importErrorLines(report.errors) : [];
  const ignored = report ? ignoredRows(report) : 0;
  return (
    <>
      <PageHeader
        backHref="/campaigns"
        backLabel="Campagnes"
        title="Historique des imports"
        description="Les fichiers importés (dépenses et joueurs) : lignes lues, importées, ignorées."
        primaryAction={{
          label: "Importer des dépenses",
          href: "/campaigns/import",
          icon: <FileUp aria-hidden />,
        }}
      />
      <Flash ok={sp.ok} error={sp.error} />
      {report ? (
        <Alert variant={ignored ? "warning" : "success"} role="status" className="mb-6">
          <FileUp aria-hidden />
          <AlertTitle>Import terminé · {report.filename}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              {fmtNum(report.rows)} ligne{report.rows > 1 ? "s" : ""} lue
              {report.rows > 1 ? "s" : ""} · {fmtNum(report.imported)} importée
              {report.imported > 1 ? "s" : ""} · {fmtNum(ignored)} ignorée{ignored > 1 ? "s" : ""}
              {report.createdBy?.name ? ` · par ${report.createdBy.name}` : ""} ·{" "}
              {fmtDate(report.createdAt)}
            </p>
            {reportLines.length ? (
              <>
                <Reasons lines={reportLines} />
                <p>
                  Pour récupérer les lignes ignorées : corrigez-les dans le fichier (date, montant,
                  nom de pub) et réimportez-le ; les jours déjà importés sont simplement remplacés.
                </p>
              </>
            ) : (
              <p>Les dépenses apparaissent dans Campagnes et dans Statistiques dans la minute.</p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <DataTable
        label="Imports"
        columns={[
          { key: "when", header: "Quand" },
          // Téléphone : le type passe sous la date (3 colonnes, aucune cachée hors de l'écran).
          { key: "kind", header: "Type", hideOnMobile: true },
          { key: "file", header: "Fichier", hideOnMobile: true },
          { key: "imported", header: "Importées", align: "right" },
          {
            key: "errors",
            header: "Lignes ignorées",
            align: "right",
            className: "max-md:whitespace-normal",
          },
        ]}
        rows={batches.map((b) => {
          const lines = importErrorLines(b.errors);
          const skipped = ignoredRows(b);
          return {
            id: b.id,
            cells: {
              when: (
                <span className="flex flex-col items-start gap-1">
                  <span>{fmtDate(b.createdAt)}</span>
                  <span className="md:hidden">
                    <StatusBadge kind="importKind" value={b.kind} />
                  </span>
                </span>
              ),
              kind: <StatusBadge kind="importKind" value={b.kind} />,
              file: <span className="font-mono text-note">{b.filename}</span>,
              imported: `${fmtNum(b.imported)} / ${fmtNum(b.rows)}`,
              errors: skipped ? (
                <StatusPill tone="warning">{fmtNum(skipped)}</StatusPill>
              ) : (
                <span className="text-muted-foreground">0</span>
              ),
            },
            sortValues: {
              when: b.createdAt,
              kind: statusLabel("importKind", b.kind),
              file: b.filename,
              imported: b.imported,
              errors: skipped,
            },
            detailTitle: b.filename,
            detailDescription: `${statusLabel("importKind", b.kind)} · ${fmtDate(b.createdAt)}`,
            detail: (
              <div className="space-y-6">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                  <dt className="text-muted-foreground">Lignes lues</dt>
                  <dd className="tabular-nums">{fmtNum(b.rows)}</dd>
                  <dt className="text-muted-foreground">Importées</dt>
                  <dd className="tabular-nums">{fmtNum(b.imported)}</dd>
                  <dt className="text-muted-foreground">Ignorées</dt>
                  <dd className="tabular-nums">{fmtNum(skipped)}</dd>
                  <dt className="text-muted-foreground">Par</dt>
                  <dd>{b.createdBy?.name ?? "—"}</dd>
                </dl>
                {lines.length ? <Reasons lines={lines} /> : null}
              </div>
            ),
          };
        })}
        empty={{
          icon: <FileUp />,
          title: "Aucun import pour l'instant",
          description:
            "Importez un rapport de dépenses TikTok ou Meta pour calculer ce que rapportent vos campagnes.",
          action: { href: "/campaigns/import", label: "Importer des dépenses", variant: "outline" },
        }}
      />
    </>
  );
}
