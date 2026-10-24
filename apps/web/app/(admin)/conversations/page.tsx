import type { Metadata } from "next";
import { Download, MessagesSquare } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { Pagination } from "@/components/admin/pagination";
import { ConversationStatusBadge } from "@/components/conversations/conversation-status-badge";
import { ConversationsNav } from "@/components/conversations/conversations-nav";
import { InboxFilters } from "@/components/conversations/inbox-filters";
import { buttonVariants } from "@/components/ui/button";
import { loadAssistantConfig } from "@/lib/assistant/config";
import {
  clearedInboxFilters,
  hasInboxFilters,
  inboxExportHref,
  inboxHref,
  parseInboxFilters,
} from "@/lib/conversations/filters";
import {
  inboxCounts,
  listConversations,
  loadInboxOptions,
  toHandleCount,
  type InboxListRow,
  type InboxRow,
} from "@/lib/conversations/inbox";
import {
  excerpt,
  lastAuthorPrefix,
  messageText,
  NEEDS_HUMAN_LABEL,
  needsHumanReasonLabel,
  personName,
  personaLabel,
  sourceLabel,
} from "@/lib/conversations/labels";
import { replyBlockTitle } from "@/lib/conversations/reply-state";
import { fmtDate, fmtRelative } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conversations" };
export const dynamic = "force-dynamic";

/** Extrait du dernier message, précédé de son auteur (« Assistante : … ») ; l'appui sur Démarrer en clair. */
function lastMessageText(r: InboxRow): string {
  if (!r.last) return "Aucun message";
  const meta = (r.last.meta ?? {}) as { command?: unknown };
  if (r.last.direction === "IN" && meta.command === "start") return "A appuyé sur Démarrer";
  return `${lastAuthorPrefix(r.last.author, r.personaGender)}${excerpt(messageText(r.last.text, r.last.media), 90)}`;
}

/** « Qui répond » : l'assistante (accordée à la persona), l'équipe, fermée, ou « Personne ne répond » (raison au survol). */
function WhoAnswersBadge({ r }: { r: InboxListRow }) {
  return (
    <ConversationStatusBadge
      status={r.status}
      gender={r.personaGender}
      nobodyReason={r.replyBlock ? replyBlockTitle(r.replyBlock) : null}
    />
  );
}

/** Pastille « À traiter » et son motif en clair (phase 25), depuis quand au survol. */
function ToHandleTag({ r, now }: { r: InboxListRow; now: Date }) {
  if (!r.needsHumanAt) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-normal">
      <StatusPill tone="danger" title={`Depuis le ${fmtDate(r.needsHumanAt)}`}>
        {NEEDS_HUMAN_LABEL}
      </StatusPill>
      <span className="text-note text-foreground">
        {needsHumanReasonLabel(r.needsHumanReason)} · {fmtRelative(r.needsHumanAt, now)}
      </span>
    </span>
  );
}

/**
 * Première cellule : nom (en gras si non lue), persona et source, pastille « À traiter » ; sur téléphone, tout le
 * reste de la ligne.
 */
function PersonCell({ r, now }: { r: InboxListRow; now: Date }) {
  const name = personName(r.member);
  const sub = [
    name.startsWith("@") || !r.member.username || r.member.anonymizedAt
      ? null
      : `@${r.member.username}`,
    personaLabel(r.personaName),
    sourceLabel(r.source),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="block min-w-0 py-1 whitespace-normal">
      <span className="flex items-center gap-2">
        {r.unread ? (
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand-ink" />
        ) : null}
        <span className={cn("break-words", r.unread && "font-semibold")}>{name}</span>
        {r.unread ? <span className="sr-only"> (non lue)</span> : null}
      </span>
      <span className="block text-note font-normal text-muted-foreground">{sub}</span>
      <ToHandleTag r={r} now={now} />
      {/* Téléphone : la ligne devient une carte (dernier message, étape, qui répond, date). */}
      <span className="mt-2 block space-y-1 font-normal md:hidden">
        <span className="line-clamp-2 block text-note text-foreground">{lastMessageText(r)}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge kind="conversationStage" value={r.stage} />
          <WhoAnswersBadge r={r} />
          <span className="text-note text-muted-foreground">{fmtRelative(r.activityAt, now)}</span>
        </span>
      </span>
    </span>
  );
}

/**
 * Boîte de réception de l'assistant de conversation (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 6) : les
 * conversations « à traiter » d'abord (phase 25 : pastille et motif), puis la plus récemment active (personne, dernier message, étape, qui répond, mis à jour),
 * pastilles « À traiter », « Non lues » et « L'équipe a la main », filtres mémorisés (univers, étape, qui répond,
 * source, persona),
 * pagination, export CSV. « Qui répond » dit « Personne ne répond » quand la conversation est laissée à l'assistante
 * mais qu'elle ne répondra pas (essai réservé à l'équipe, persona désactivée, bot repassé en bot normal). Clic sur une ligne : le fil de la conversation. Administrateurs et managers.
 */
export default async function ConversationsInboxPage({
  searchParams,
}: PageProps<"/conversations">) {
  const me = await requireUser();
  const sp = await searchParams;
  const f = parseInboxFilters(sp);
  const now = new Date();
  const [{ rows, total, pages, page }, options, baseCounts, toHandle, config] = await Promise.all([
    listConversations(f),
    loadInboxOptions(),
    inboxCounts(),
    toHandleCount(),
    loadAssistantConfig(),
  ]);
  const counts = { ...baseCounts, toHandle };
  const filtered = hasInboxFilters(f);
  const off = config.activation === "off";

  const tableRows: DataTableRow[] = rows.map((r) => ({
    id: r.id,
    href: `/conversations/${r.id}`,
    cells: {
      person: <PersonCell r={r} now={now} />,
      last: (
        <span
          className={cn(
            "line-clamp-2 block max-w-96 text-body whitespace-normal",
            r.unread ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {lastMessageText(r)}
        </span>
      ),
      stage: <StatusBadge kind="conversationStage" value={r.stage} />,
      status: <WhoAnswersBadge r={r} />,
      updated: (
        <time
          dateTime={r.activityAt.toISOString()}
          title={fmtDate(r.activityAt)}
          className="whitespace-nowrap"
        >
          {fmtRelative(r.activityAt, now)}
        </time>
      ),
    },
  }));

  const empty = (() => {
    if (filtered)
      return (
        <EmptyState
          title="Aucune conversation ne correspond à ces filtres"
          description="Retirez un filtre, ou repartez de la liste complète."
          action={{
            href: inboxHref(f, clearedInboxFilters()),
            label: "Voir toutes les conversations",
            variant: "outline",
          }}
        />
      );
    if (off)
      return (
        <EmptyState
          icon={<MessagesSquare />}
          title="Aucune conversation : l'assistante est désactivée"
          description={
            me.role === "ADMIN"
              ? "Tant qu'elle est désactivée, elle ne répond à personne. Commencez par l'essai « Seulement l'équipe » dans Réglages → IA de conversation."
              : "Tant qu'elle est désactivée, elle ne répond à personne. Un administrateur peut l'activer dans Réglages → IA de conversation."
          }
          action={
            me.role === "ADMIN"
              ? { href: "/settings/assistant", label: "Ouvrir Réglages → IA de conversation" }
              : undefined
          }
        />
      );
    return (
      <EmptyState
        icon={<MessagesSquare />}
        title="Aucune conversation pour l'instant"
        description="Une conversation commence dès qu'une personne écrit au bot de l'assistante (un bot à part, créé exprès pour elle) : après Démarrer, depuis un canal, une page ou une pub."
      />
    );
  })();

  return (
    <>
      <ConversationsNav current="inbox" />
      <PageHeader
        title="Conversations"
        description="Ce que l'assistante échange en privé, sur son propre bot, avec les personnes qui lui écrivent."
        help="Cliquez sur une conversation pour lire le fil en direct, prendre la main ou écrire vous-même. Les filtres sont mémorisés sur cet appareil."
        secondaryActions={
          total > 0 ? (
            <a
              href={inboxExportHref(f)}
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              <Download aria-hidden />
              Exporter
            </a>
          ) : null
        }
      />
      <Flash
        ok={typeof sp.ok === "string" ? sp.ok : undefined}
        error={typeof sp.error === "string" ? sp.error : undefined}
      />
      {counts.all > 0 || filtered ? (
        <InboxFilters filters={f} options={options} counts={counts} />
      ) : null}
      {off && counts.all > 0 ? (
        <p className="mb-3 text-note text-muted-foreground">
          L&apos;assistante est désactivée : elle ne répond à personne pour l&apos;instant (Réglages
          → IA de conversation).
        </p>
      ) : null}
      {config.activation === "team" && counts.all > 0 ? (
        <p className="mb-3 text-note text-muted-foreground">
          Essai par l&apos;équipe : l&apos;assistante ne répond qu&apos;aux comptes Telegram de
          l&apos;équipe. Les autres personnes ne reçoivent aucune réponse (« Personne ne répond ») :
          prenez la main pour leur répondre vous-même.
        </p>
      ) : null}
      {total === 0 ? (
        empty
      ) : (
        <>
          <DataTable
            label="Conversations"
            columns={[
              {
                key: "person",
                header: "Personne",
                sortable: false,
                className: "whitespace-normal md:min-w-44 md:max-w-64",
              },
              { key: "last", header: "Dernier message", sortable: false, hideOnMobile: true },
              { key: "stage", header: "Étape", sortable: false, hideOnMobile: true },
              { key: "status", header: "Qui répond", sortable: false, hideOnMobile: true },
              { key: "updated", header: "Mis à jour", sortable: false, hideOnMobile: true },
            ]}
            rows={tableRows}
          />
          <Pagination
            page={page}
            pages={pages}
            total={total}
            noun="conversation"
            hrefFor={(p) => inboxHref(f, { page: p })}
          />
        </>
      )}
    </>
  );
}
