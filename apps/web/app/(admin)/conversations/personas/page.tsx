import type { Metadata } from "next";
import { Plus, UserRound } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { ConversationsNav } from "@/components/conversations/conversations-nav";
import { fmtNum } from "@/lib/format";
import { loadPersonaList } from "@/lib/personas/queries";
import { personaListRow } from "@/lib/personas/view";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Personas" };
export const dynamic = "force-dynamic";

/**
 * Personas de l'assistant de conversation (phase 17) : une ligne par persona (prénom et rôle, univers avec, pour
 * Casino et Paris sportifs, le nombre de questions de la fiche d'informations (phase 25), état, offre liée, bots qui
 * l'utilisent, conversations) ; un clic ouvre la fiche (formulaire, « Tester », aperçu des consignes). ADMIN et
 * MANAGER créent et modifient ; seule la suppression est réservée aux administrateurs (sur la fiche).
 */
export default async function PersonasPage({ searchParams }: PageProps<"/conversations/personas">) {
  await requireUser();
  const sp = await searchParams;
  const rows = (await loadPersonaList()).map(personaListRow);

  const tableRows: DataTableRow[] = rows.map((p) => ({
    id: p.id,
    href: `/conversations/personas/${p.id}`,
    cells: {
      name: (
        <span className="flex flex-col items-start gap-0.5">
          <span>{p.name}</span>
          <span className="text-note font-normal text-muted-foreground">{p.role} du canal</span>
        </span>
      ),
      universe: (
        <span className="flex flex-col items-start gap-0.5">
          <UniverseDot universe={p.universe} withLabel label={p.universeLabel} />
          {p.faqLabel ? (
            <span className="text-note font-normal text-muted-foreground">{p.faqLabel}</span>
          ) : null}
        </span>
      ),
      state: p.isActive ? (
        <StatusPill tone="success">Active</StatusPill>
      ) : (
        <StatusPill tone="muted">Inactive</StatusPill>
      ),
      offer: p.offerInactive ? (
        <span className="flex flex-col items-start gap-0.5">
          <span>{p.offerLabel}</span>
          <StatusPill tone="warning">Offre inactive</StatusPill>
        </span>
      ) : (
        p.offerLabel
      ),
      bots: p.botsLabel,
      conversations: fmtNum(p.conversations),
    },
    sortValues: {
      name: p.name,
      universe: p.universeLabel,
      state: p.isActive ? 1 : 0,
      offer: p.offerLabel,
      bots: p.assistantBots,
      conversations: p.conversations,
    },
  }));

  return (
    <>
      <ConversationsNav current="personas" />
      <PageHeader
        title="Personas"
        description="Le prénom, la personnalité et la façon de parler de l'assistant, et l'offre qu'il présente."
        primaryAction={
          rows.length > 0
            ? {
                label: "Nouvelle persona",
                href: "/conversations/personas/new",
                icon: <Plus aria-hidden />,
              }
            : undefined
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      {rows.length === 0 ? (
        <EmptyState
          icon={<UserRound />}
          title="Aucune persona pour l'instant"
          description="Une persona donne un prénom et une personnalité à l'assistant, et choisit l'offre qu'il présente. Créez-la, testez-la ici, puis liez-la au bot dans Réglages → Bots."
          action={{ href: "/conversations/personas/new", label: "Nouvelle persona" }}
        />
      ) : (
        <DataTable
          label="Personas"
          columns={[
            { key: "name", header: "Prénom", className: "whitespace-normal" },
            { key: "universe", header: "Univers", className: "whitespace-normal" },
            { key: "state", header: "État" },
            {
              key: "offer",
              header: "Offre liée",
              hideOnMobile: true,
              className: "whitespace-normal",
            },
            { key: "bots", header: "Bots", hideOnMobile: true },
            { key: "conversations", header: "Conversations", align: "right" },
          ]}
          rows={tableRows}
        />
      )}
    </>
  );
}
