import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { BarList } from "@/components/charts/bar-list";
import { ChannelMembersTable } from "@/components/channels/channel-members-table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { loadChannelMembersPage } from "@/lib/channels/queries";
import {
  appliedRuleText,
  appliedRuleView,
  membershipProvenance,
  landingPageIdsOf,
  sourceChannelIdsOf,
} from "@/lib/channels/provenance-display";
import { landingPageNames } from "@/lib/landing/queries";
import {
  PROVENANCE_STATS_DAYS,
  loadProvenanceStats,
  outcomeText,
  requestsText,
  type ProvenanceStats,
} from "@/lib/channels/provenance-stats";
import { memberName, membersSummary, sourceHint } from "@/lib/channels/requests";
import { fmtDate } from "@/lib/format";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Onglet « Membres » : d'abord « D'où viennent les demandes » (30 derniers jours, par provenance : demandes,
 * acceptées, départs dans les 7 jours), puis les membres acceptés, partis ou exclus, en tableau de 5 colonnes avec le
 * détail au clic, 50 par page. L'en-tête compte les présents, puis les partis et les exclus (la liste les montre
 * tous). Canal sans membre : l'état vide seul, sans phrase ni bouton inutiles.
 */
export async function MembersTab({ channelId, sp }: { channelId: string; sp: SearchParams }) {
  const [data, stats] = await Promise.all([
    loadChannelMembersPage(channelId, pageOf(sp)),
    loadProvenanceStats(channelId),
  ]);
  // Provenance des lignes de la page (anciennes adhésions : déduite de leur lien) et titres des canaux d'origine.
  const linkIds = [
    ...new Set(data.rows.map((m) => m.inviteLinkId).filter((id): id is string => !!id)),
  ];
  const links = linkIds.length
    ? await prisma.inviteLink.findMany({
        where: { id: { in: linkIds } },
        select: {
          id: true,
          kind: true,
          sourceChannelId: true,
          adPlatform: true,
          name: true,
          landingPageId: true,
          landingSource: true,
        },
      })
    : [];
  const linkOf = new Map(links.map((l) => [l.id, l]));
  const rows = data.rows.map((m) => ({
    ...m,
    inviteLink: m.inviteLinkId ? linkOf.get(m.inviteLinkId) : null,
  }));
  const sourceIds = sourceChannelIdsOf(rows);
  // Pages d'atterrissage (phase 15) : nom actuel d'une page renommée.
  const pageNames = await landingPageNames(landingPageIdsOf(rows));
  const titles = sourceIds.length
    ? Object.fromEntries(
        (
          await prisma.channel.findMany({
            where: { id: { in: sourceIds } },
            select: { id: true, title: true },
          })
        ).map((c) => [c.id, c.title]),
      )
    : {};
  const table = (
    <ChannelMembersTable
      rows={rows.map((m) => {
        const { provenance, label } = membershipProvenance(m, titles, pageNames);
        const rule = appliedRuleText(appliedRuleView(m));
        return {
          id: m.id,
          memberId: m.member.id,
          name: memberName(m.member),
          username: m.member.username,
          status: m.status,
          source: label,
          sourceHint:
            [
              rule ? `${rule.charAt(0).toUpperCase()}${rule.slice(1)}.` : null,
              sourceHint(provenance.type),
            ]
              .filter(Boolean)
              .join(" ") || null,
          requestedAt: fmtDate(m.requestedAt),
          approvedAt: fmtDate(m.approvedAt),
          joinedAt: fmtDate(m.joinedAt),
          leftAt: fmtDate(m.leftAt),
        };
      })}
    />
  );
  if (data.total === 0 && stats.totals.requests === 0) return table;
  const pageLinks = { ...sp, ok: undefined, error: undefined };
  return (
    <div className="space-y-8">
      {stats.rows.length > 0 ? <ProvenanceStatsBlock stats={stats} /> : null}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-body text-muted-foreground">
            <span className="font-semibold text-foreground">{membersSummary(data)}</span>. Seules
            les personnes entrées depuis qu&apos;un de nos bots gère ce canal sont suivies. Cliquez
            sur une ligne pour voir son origine et ses dates.
          </p>
          <Link
            href={`/members?channelId=${encodeURIComponent(channelId)}`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            Voir dans Membres
          </Link>
        </div>
        {table}
        <Pagination
          page={data.page}
          pages={data.pages}
          total={data.total}
          noun="membre"
          hrefFor={(p) => pageHref(`/channels/${channelId}`, pageLinks, p)}
        />
      </div>
    </div>
  );
}

/**
 * « D'où viennent les demandes » : une barre par provenance (bouton « canal à rejoindre » de chacun de nos canaux,
 * chaque lien de partage, pubs TikTok / Meta / autres, autres liens), avec le nombre de demandes, les acceptées et
 * les départs dans les 7 jours qui suivent l'entrée. Lisible sans couleur (chaque ligne écrit ses chiffres).
 */
function ProvenanceStatsBlock({ stats }: { stats: ProvenanceStats }) {
  return (
    <section
      aria-labelledby="provenance-stats-title"
      className="space-y-4 rounded-xl border border-border bg-surface p-4 md:p-5"
    >
      <div>
        <h2 id="provenance-stats-title" className="text-title text-foreground">
          D&apos;où viennent les demandes
        </h2>
        <p className="mt-0.5 text-note text-muted-foreground">
          {PROVENANCE_STATS_DAYS} derniers jours : {requestsText(stats.totals.requests)},{" "}
          {outcomeText(stats.totals)}. Un départ compte s&apos;il a lieu dans les 7 jours qui
          suivent l&apos;entrée.
        </p>
      </div>
      <BarList
        label={`Demandes des ${PROVENANCE_STATS_DAYS} derniers jours, par provenance`}
        items={stats.rows.map((r) => ({
          key: r.key,
          // Le détail (acceptées, départs) sous le nom de la provenance : sur téléphone, la colonne des valeurs reste
          // étroite (« 17 demandes ») et le texte passe à la ligne sous le nom.
          label: (
            <>
              <span className="block">{r.label}</span>
              <span className="block text-note text-muted-foreground">{outcomeText(r)}</span>
            </>
          ),
          value: r.requests,
          valueText: requestsText(r.requests),
        }))}
      />
    </section>
  );
}
