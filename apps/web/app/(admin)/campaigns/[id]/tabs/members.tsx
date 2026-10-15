import Link from "next/link";
import { Download } from "lucide-react";
import { SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { DataTable } from "@/components/admin/data-table";
import { FormSection } from "@/components/admin/form-section";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { StatusPill } from "@/components/admin/status-pill";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { fmtDateShort, fmtMoney, fmtNum } from "@/lib/format";
import { listMembers, parseMemberFilters } from "@/lib/members/query";
import type { TabProps } from "./shared";

/**
 * Onglet Membres : membres arrivés par les liens d'entrée de la campagne ou par les pages d'atterrissage reliées à
 * ses pubs (phase 15 : la liste Membres filtrée par campagne),
 * les plus récemment arrivés d'abord (tri existant `firstSeen`), dans l'ordre de la colonne « Arrivé le ».
 */
export async function MembersTab({ id, sp }: TabProps) {
  const filters = {
    ...parseMemberFilters({ sort: "firstSeen" }),
    campaignId: id,
    page: pageOf(sp),
  };
  const { rows, total, pages } = await listMembers(filters);
  return (
    <FormSection
      title={`Membres (${fmtNum(total)})`}
      description="Toutes les personnes arrivées par un lien d'entrée ou une page de la campagne, depuis le début (pas seulement sur la période)."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/members?campaignId=${encodeURIComponent(id)}&sort=firstSeen`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            Voir dans Membres
          </Link>
          <a
            href={`/members/export?campaignId=${encodeURIComponent(id)}`}
            className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
          >
            <Download aria-hidden />
            Exporter (CSV)
          </a>
        </div>
      }
    >
      <DataTable
        label="Membres de la campagne"
        columns={[
          { key: "name", header: "Membre", className: "min-w-32 whitespace-normal" },
          { key: "source", header: "Pub d'origine", hideOnMobile: true },
          { key: "since", header: "Arrivé le" },
          { key: "level", header: "Niveau", hideOnMobile: true },
          { key: "deposits", header: "Déposé", align: "right" },
        ]}
        rows={rows.map((m) => ({
          id: m.id,
          href: `/members/${m.id}`,
          cells: {
            name: (
              <span className="flex flex-col">
                <span>{m.displayName}</span>
                {m.username ? (
                  <span className="text-note font-normal text-muted-foreground">@{m.username}</span>
                ) : null}
              </span>
            ),
            source: m.source ?? "—",
            since: fmtDateShort(m.firstSeenAt),
            level: (
              <StatusPill
                tone={m.level === "VIP" ? "brand" : m.level === "AUCUN" ? "muted" : "neutral"}
              >
                {SPEND_LEVEL_LABELS[m.level]}
              </StatusPill>
            ),
            deposits: m.depositCount > 0 ? fmtMoney(m.depositTotal) : "—",
          },
          sortValues: {
            name: m.displayName,
            since: m.firstSeenAt,
            level: SPEND_LEVEL_LABELS[m.level],
            deposits: m.depositTotal,
          },
        }))}
        empty={{
          title: "Aucun membre arrivé par cette campagne pour l'instant",
          description:
            "Ils apparaissent dès qu'une personne clique un lien d'entrée de la campagne (ou passe par une de ses pages) et demande à rejoindre le canal.",
        }}
      />
      {total > 0 ? (
        <Pagination
          page={filters.page}
          pages={pages}
          total={total}
          noun="membre"
          hrefFor={(n) =>
            pageHref(`/campaigns/${id}`, { ...sp, ok: undefined, error: undefined }, n)
          }
        />
      ) : null}
    </FormSection>
  );
}
