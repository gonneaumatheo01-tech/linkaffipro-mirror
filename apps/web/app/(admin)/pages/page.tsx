import type { Metadata } from "next";
import { PanelTop, Plus } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { NumCell } from "@/components/dashboard/cells";
import { CopyLinkButton } from "@/components/landing/copy-link-button";
import { env } from "@/lib/env";
import { fmtNum, fmtPct } from "@/lib/format";
import { sourcePublicUrl } from "@/lib/landing/form";
import { loadLandingList } from "@/lib/landing/queries";
import { periodLabelWithDates } from "@/lib/periods";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Pages" };

/**
 * Rubrique « Pages » (phase 15) : les pages d'atterrissage ultra-rapides qui envoient les pubs vers nos canaux
 * Telegram. Une ligne par page : nom, canal, chiffres des 7 derniers jours (visites, clics, demandes) et « Copier le
 * lien » (lien principal) ; un clic ouvre la fiche (formulaire, aperçu, sources et leurs liens, tableau par source).
 * ADMIN et MANAGER.
 */
export default async function PagesPage({ searchParams }: PageProps<"/pages">) {
  await requireUser();
  const sp = await searchParams;
  const { rows, period } = await loadLandingList();

  const tableRows: DataTableRow[] = rows.map((p) => {
    const t = p.table?.totals;
    const url = sourcePublicUrl(env.trackingBaseUrl, p.slug, "");
    return {
      id: p.id,
      href: `/pages/${p.id}`,
      cells: {
        page: (
          <span className="flex flex-col items-start gap-0.5">
            <span>{p.name}</span>
            <span className="inline-flex flex-wrap items-center gap-2 text-note font-normal text-muted-foreground">
              <UniverseDot universe={p.channel.vertical} />
              {p.channel.title}
              {p.isActive ? null : <StatusPill tone="muted">En pause</StatusPill>}
              {p.isActive && !p.linkReady ? (
                <StatusPill tone="warning" title={p.linkError ?? undefined}>
                  Lien en attente
                </StatusPill>
              ) : null}
            </span>
          </span>
        ),
        visits: <NumCell value={fmtNum(t?.visits ?? 0)} />,
        clicks: (
          <NumCell
            value={fmtNum(t?.clicks ?? 0)}
            note={t?.clickRate == null ? null : `${fmtPct(t.clickRate)} de clic`}
          />
        ),
        requests: (
          <NumCell
            value={fmtNum(t?.requests ?? 0)}
            note={t?.visitToJoin == null ? null : `${fmtPct(t.visitToJoin)} des visites`}
          />
        ),
        link: (
          <CopyLinkButton
            url={url}
            compact
            disabledReason={
              !p.isActive ? "Page en pause." : p.linkReady ? null : "Lien Telegram pas encore prêt."
            }
          />
        ),
      },
      sortValues: {
        page: p.name,
        visits: t?.visits ?? 0,
        clicks: t?.clicks ?? 0,
        requests: t?.requests ?? 0,
      },
    };
  });

  return (
    <>
      <PageHeader
        title="Pages"
        description="Des pages ultra-rapides entre vos pubs et vos canaux Telegram."
        primaryAction={
          rows.length > 0
            ? { label: "Nouvelle page", href: "/pages/new", icon: <Plus aria-hidden /> }
            : undefined
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      {rows.length === 0 ? (
        <EmptyState
          icon={<PanelTop />}
          title="Aucune page pour l'instant"
          description="Une page = un écran avec le nom du canal et un gros bouton « Rejoindre ». Collez son lien dans vos pubs : visites, clics et demandes sont comptés."
          action={{ href: "/pages/new", label: "Créer une page" }}
        />
      ) : (
        <div className="space-y-2">
          <DataTable
            label="Pages d'atterrissage"
            columns={[
              { key: "page", header: "Page", className: "whitespace-normal md:min-w-56" },
              { key: "visits", header: "Visites", align: "right", hideOnMobile: true },
              { key: "clicks", header: "Clics", align: "right", hideOnMobile: true },
              { key: "requests", header: "Demandes", align: "right" },
              { key: "link", header: "Lien", sortable: false },
            ]}
            rows={tableRows}
          />
          <p className="text-note text-muted-foreground">
            Chiffres des {periodLabelWithDates(period).toLowerCase()}. Le détail par source est dans
            chaque page.
          </p>
        </div>
      )}
    </>
  );
}
