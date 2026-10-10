import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/admin/data-table";
import { FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { DetailList, DetailRow } from "@/components/settings/detail-list";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { importSummary } from "../postback-view";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Importer des joueurs" };

/**
 * Réglages → Avancé → Retours du casino → Importer des joueurs (CSV) : pour les partenaires qui n'envoient rien
 * tout seuls. Le parcours (fichier → aperçu → confirmation) est inchangé ; l'historique des imports est un tableau de
 * 5 colonnes avec le détail (auteur, erreurs) au clic.
 */
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
        backHref="/settings/postbacks"
        backLabel="Retours du casino"
        title="Importer des joueurs (CSV)"
        description={
          <>
            Pour les partenaires qui n&apos;envoient rien tout seuls : chaque ligne du fichier est
            traitée comme un <Term term="postback">retour du casino</Term>. Réimporter le même
            fichier ne crée pas de doublon.
          </>
        }
        help="Choisissez le programme et le fichier, vérifiez l'aperçu, puis confirmez. Le joueur est rattaché au membre par son identifiant de suivi s'il est dans le fichier."
      />

      <div className="space-y-10">
        <ImportForm programs={programs} />

        <FormSection title="Derniers imports" description="Les 20 derniers fichiers de joueurs.">
          <DataTable
            label="Derniers imports de joueurs"
            columns={[
              { key: "when", header: "Quand" },
              {
                key: "file",
                header: "Fichier",
                hideOnMobile: true,
                className: "whitespace-normal",
              },
              { key: "rows", header: "Lignes", align: "right", hideOnMobile: true },
              { key: "imported", header: "Importées", align: "right" },
              { key: "errors", header: "Erreurs", align: "right" },
            ]}
            rows={batches.map((b) => {
              const errors = Array.isArray(b.errors) ? b.errors : [];
              return {
                id: b.id,
                cells: {
                  when: fmtDate(b.createdAt),
                  file: b.filename,
                  rows: fmtNum(b.rows),
                  imported: fmtNum(b.imported),
                  errors: fmtNum(errors.length),
                },
                sortValues: { when: b.createdAt, file: b.filename },
                detailTitle: b.filename,
                detailDescription: importSummary(b),
                detail: (
                  <div className="space-y-6">
                    <DetailList>
                      <DetailRow label="Importé le">{fmtDate(b.createdAt)}</DetailRow>
                      <DetailRow label="Par">{b.createdBy?.name ?? "—"}</DetailRow>
                      <DetailRow label="Lignes lues">{fmtNum(b.rows)}</DetailRow>
                      <DetailRow label="Importées">{fmtNum(b.imported)}</DetailRow>
                      <DetailRow label="Erreurs">{fmtNum(errors.length)}</DetailRow>
                    </DetailList>
                    {errors.length > 0 ? (
                      <ul className="max-h-80 list-disc space-y-1 overflow-auto pl-5 text-note text-danger">
                        {errors.slice(0, 100).map((e, i) => (
                          <li key={i}>{typeof e === "string" ? e : JSON.stringify(e)}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ),
              };
            })}
            empty={{
              title: "Aucun import de joueurs pour l'instant",
              description:
                "Le premier import apparaîtra ici avec le nombre de lignes lues et importées.",
            }}
          />
        </FormSection>
      </div>
    </>
  );
}
