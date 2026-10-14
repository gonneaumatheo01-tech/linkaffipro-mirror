import type { Metadata } from "next";
import { ChevronDown, Download, Send, UserRound } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination } from "@/components/admin/pagination";
import { StatusBadge } from "@/lib/status-badges";
import {
  DepositsCell,
  LastActivity,
  MemberAvatar,
  MemberOriginCell,
  MemberTags,
} from "@/components/members/member-cells";
import { MemberFilterBar } from "@/components/members/member-filters";
import { MemberQuickView } from "@/components/members/member-quick-view";
import { MembersNav } from "@/components/members/members-nav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  broadcastLink,
  broadcastNote,
  clearedFilters,
  filtersToQuery,
  hasMemberFilters,
  membersHref,
  parseMemberFilters,
} from "@/lib/members/filters";
import { fmtMoney } from "@/lib/format";
import { memberSubline } from "@/lib/members/profile";
import { listMembers, loadMemberFilterOptions, type MemberRow } from "@/lib/members/query";
import { getTagRegistry, type TagDef } from "@/lib/members/tags";
import { toUniverse, type Universe } from "@/lib/universe";

export const metadata: Metadata = { title: "Membres" };

/** Route d'export des joueurs (fichier CSV, pas une page : lien classique). */
const PLAYERS_EXPORT = "/members/players/export";

/**
 * Première cellule : rond aux initiales, nom, « @pseudo · langue », étiquettes. Sur téléphone, la ligne devient une
 * carte : on y ajoute d'où il vient, son statut et ses dépôts (les autres colonnes sont masquées).
 */
function MemberCell({ r, registry }: { r: MemberRow; registry: TagDef[] }) {
  const sub = memberSubline(r);
  const deposited = r.depositCount > 0 || r.depositTotal > 0;
  return (
    <span className="flex min-w-0 items-start gap-3 py-1">
      <MemberAvatar name={r.displayName} className="mt-0.5" />
      <span className="min-w-0 break-words">
        <span className="block md:truncate">{r.displayName}</span>
        {sub ? (
          <span className="block text-note font-normal text-muted-foreground md:truncate">
            {sub}
          </span>
        ) : null}
        <MemberTags tags={r.tags} registry={registry} max={3} className="mt-1 font-normal" />
        <span className="mt-2 block font-normal md:hidden">
          <MemberOriginCell origin={r.origin} />
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {r.status ? <StatusBadge kind="membership" value={r.status} /> : null}
            {deposited ? (
              <span className="text-note tabular-nums">
                {fmtMoney(Math.round(r.depositTotal), "EUR", { digits: 0 })} déposés
              </span>
            ) : null}
          </span>
        </span>
      </span>
    </span>
  );
}

export default async function MembersPage({ searchParams }: PageProps<"/members">) {
  const sp = await searchParams;
  const f = parseMemberFilters(sp);
  const now = new Date();
  const [{ rows, total, pages }, options, tagRegistry] = await Promise.all([
    listMembers(f, { now }),
    loadMemberFilterOptions(),
    getTagRegistry(),
  ]);
  const names = {
    channels: Object.fromEntries(options.channels.map((c) => [c.id, c.title])),
    campaigns: Object.fromEntries(options.campaigns.map((c) => [c.id, c.name])),
    inviteLinks: Object.fromEntries(options.inviteLinks.map((l) => [l.id, l.label])),
    affiliates: Object.fromEntries(options.affiliates.map((a) => [a.id, a.name])),
  };
  const channelsByUniverse: Partial<Record<Universe, string[]>> = {};
  for (const c of options.channels) {
    const u = toUniverse(c.vertical);
    if (u) (channelsByUniverse[u] ??= []).push(c.id);
  }
  const write = broadcastLink(f, channelsByUniverse);
  const writeNote = broadcastNote(write);
  const filtered = hasMemberFilters(f);
  const playersExport = `${PLAYERS_EXPORT}?${new URLSearchParams({
    range: "30d",
    ...(f.campaignId ? { campaignId: f.campaignId } : {}),
  }).toString()}`;

  const tableRows: DataTableRow[] = rows.map((r) => ({
    id: r.id,
    detailTitle: r.displayName,
    detailDescription: memberSubline(r) || undefined,
    cells: {
      member: <MemberCell r={r} registry={tagRegistry} />,
      origin: <MemberOriginCell origin={r.origin} />,
      status: r.status ? (
        <span title={r.statusChannel ? `Dernière demande : ${r.statusChannel}` : undefined}>
          <StatusBadge kind="membership" value={r.status} />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
      deposits: (
        <DepositsCell depositCount={r.depositCount} depositTotal={r.depositTotal} level={r.level} />
      ),
      activity: <LastActivity at={r.lastEventAt} now={now} />,
    },
    detail: <MemberQuickView row={r} registry={tagRegistry} now={now} />,
  }));

  return (
    <>
      <MembersNav current="list" />
      <PageHeader
        title="Membres"
        description="Qui sont vos membres, d'où ils viennent et ce qu'ils ont déposé."
        help="Cliquez sur un membre pour voir son résumé, puis sa fiche complète. Les filtres sont mémorisés sur cet appareil."
        primaryAction={{
          label: "Écrire à un groupe",
          href: write.href,
          icon: <Send aria-hidden />,
        }}
        secondaryActions={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" className="max-md:h-10">
                  <Download aria-hidden />
                  Exporter
                  <ChevronDown aria-hidden />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Fichier CSV (Excel)</DropdownMenuLabel>
                <DropdownMenuItem render={<a href={`/members/export${filtersToQuery(f)}`} />}>
                  <UserRound aria-hidden />
                  {filtered ? "Les membres de cette liste" : "Tous les membres"}
                </DropdownMenuItem>
                <DropdownMenuItem render={<a href={playersExport} />}>
                  <Download aria-hidden />
                  Les joueurs{f.campaignId ? " de la campagne" : ""}, avec leur revenu net
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <MemberFilterBar
        filters={f}
        options={options}
        tags={tagRegistry}
        names={names}
        total={total}
      />
      {writeNote ? <p className="mb-3 text-note text-muted-foreground">{writeNote}</p> : null}
      <DataTable
        label="Membres"
        panelSize="md"
        columns={[
          {
            key: "member",
            header: "Membre",
            sortable: false,
            className: "whitespace-normal md:min-w-48 md:max-w-72",
          },
          {
            key: "origin",
            header: "D'où il vient",
            sortable: false,
            hideOnMobile: true,
            className: "whitespace-normal md:min-w-44 md:max-w-72",
          },
          { key: "status", header: "Statut", sortable: false, hideOnMobile: true },
          {
            key: "deposits",
            header: "Dépôts",
            sortable: false,
            align: "right",
            hideOnMobile: true,
          },
          { key: "activity", header: "Dernière activité", sortable: false, hideOnMobile: true },
        ]}
        rows={tableRows}
        empty={
          filtered
            ? {
                title: "Aucun membre ne correspond à ces filtres",
                description: "Retirez un filtre ci-dessus, ou repartez de la liste complète.",
                action: {
                  href: membersHref(f, clearedFilters()),
                  label: "Voir tous les membres",
                  variant: "outline",
                },
              }
            : {
                title: "Aucun membre pour l'instant",
                description:
                  "Les membres apparaissent ici dès qu'une personne demande à rejoindre un de vos canaux par un lien d'invitation géré par un bot.",
                action: { href: "/campaigns/links", label: "Créer un lien d'invitation" },
              }
        }
      />
      {total > 0 ? (
        <Pagination
          page={f.page}
          pages={pages}
          total={total}
          noun="membre"
          hrefFor={(p) => membersHref(f, { page: p })}
        />
      ) : null}
      <p className="mt-3 text-note text-muted-foreground">
        Dépôts : somme des comptes joueurs rattachés au membre. Niveau de dépense : seuils dans
        Réglages → Connexions.
      </p>
    </>
  );
}
