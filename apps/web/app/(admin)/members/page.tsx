import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SPEND_LEVELS, SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Pagination } from "@/components/admin/pagination";
import { RememberFilters } from "@/components/admin/remember-filters";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { statusLabels } from "@/lib/status-badges";
import { filtersToQuery, listMembers, parseMemberFilters } from "@/lib/members/query";
import { colorOf, getTagRegistry, tagColorClass } from "@/lib/members/tags";
import { listCampaignOptions } from "@/lib/campaigns/queries";

export const metadata: Metadata = { title: "Membres" };

const STATUS_LABELS = statusLabels("membership");
/** Route d'export (fichier CSV, pas une page : lien classique). */
const PLAYERS_EXPORT = "/members/players/export";

export function LevelBadge({ level }: { level: keyof typeof SPEND_LEVEL_LABELS }) {
  const variant = level === "VIP" ? "default" : level === "AUCUN" ? "secondary" : "outline";
  return <Badge variant={variant}>{SPEND_LEVEL_LABELS[level]}</Badge>;
}

export default async function MembersPage({ searchParams }: PageProps<"/members">) {
  const sp = await searchParams;
  const f = parseMemberFilters(sp);
  const [{ rows, total, pages }, channels, links, tagRegistry, campaigns] = await Promise.all([
    listMembers(f),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    prisma.inviteLink.findMany({
      where: { kind: "AD_ENTRY" },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true },
    }),
    getTagRegistry(),
    listCampaignOptions(),
  ]);
  const hasFilters = Boolean(
    f.q ||
    f.channelId ||
    f.status ||
    f.inviteLinkId ||
    f.campaignId ||
    f.level ||
    f.language ||
    f.tag ||
    f.since ||
    f.until,
  );
  const selectCls = "h-10 w-full rounded-md border bg-background px-2 text-sm md:h-9";
  const sortLink = (s: "lastSeen" | "firstSeen" | "name", label: string) => (
    <Link
      href={`/members${filtersToQuery(f, { sort: s, page: 1 })}`}
      className={f.sort === s ? "font-semibold underline" : "hover:underline"}
      aria-current={f.sort === s ? "true" : undefined}
    >
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader
        title="Membres"
        description="Toutes les personnes passées par nos bots Telegram, avec leur canal, leur pub d'origine et leur niveau de dépense."
        help="Cherchez un prénom, un @pseudo ou un identifiant Telegram, puis ouvrez la fiche pour voir tout son parcours. Les filtres sont mémorisés sur cet appareil."
      >
        <Button
          variant="outline"
          className="max-md:h-10"
          render={<a href={`/members/export${filtersToQuery(f)}`} />}
        >
          Exporter CSV
        </Button>
        <Button
          variant="outline"
          className="max-md:h-10"
          render={
            <a
              href={`${PLAYERS_EXPORT}?${new URLSearchParams({ range: "30d", ...(f.campaignId ? { campaignId: f.campaignId } : {}) }).toString()}`}
              title="Vos joueurs, avec leur NGR total et leur NGR des 30 derniers jours"
            />
          }
        >
          Exporter les joueurs (CSV)
        </Button>
        <Link
          href="/members/automations"
          className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
        >
          Relances automatiques
        </Link>
        <Link
          href="/members/broadcasts"
          className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
        >
          Écrire à un groupe
        </Link>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="mb-4">
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 md:grid-cols-4 lg:grid-cols-9">
            <div className="lg:col-span-2">
              <Label htmlFor="members-q" className="sr-only">
                Recherche
              </Label>
              <Input
                id="members-q"
                name="q"
                defaultValue={f.q}
                placeholder="Prénom, @pseudo ou identifiant Telegram"
                className="h-10 md:h-9"
              />
            </div>
            <div>
              <Label htmlFor="members-channel" className="sr-only">
                Canal
              </Label>
              <select
                id="members-channel"
                name="channelId"
                defaultValue={f.channelId}
                className={selectCls}
              >
                <option value="">Tous les canaux</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="members-status" className="sr-only">
                Statut d&apos;adhésion
              </Label>
              <select
                id="members-status"
                name="status"
                defaultValue={f.status}
                className={selectCls}
              >
                <option value="">Tout statut</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="members-campaign" className="sr-only">
                Campagne
              </Label>
              <select
                id="members-campaign"
                name="campaignId"
                defaultValue={f.campaignId}
                className={selectCls}
                title="Membres arrivés par un lien d'entrée de la campagne"
              >
                <option value="">Toute campagne</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="members-source" className="sr-only">
                Pub d&apos;origine
              </Label>
              <select
                id="members-source"
                name="inviteLinkId"
                defaultValue={f.inviteLinkId}
                className={selectCls}
              >
                <option value="">Tout lien d&apos;entrée</option>
                {links.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="members-level" className="sr-only">
                Niveau de dépense
              </Label>
              <select id="members-level" name="level" defaultValue={f.level} className={selectCls}>
                <option value="">Tout niveau</option>
                {SPEND_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {SPEND_LEVEL_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="members-language" className="sr-only">
                Langue
              </Label>
              <Input
                id="members-language"
                name="language"
                defaultValue={f.language}
                placeholder="Langue (fr)"
                className="h-10 w-full md:h-9"
              />
            </div>
            <div>
              <Label htmlFor="members-tag" className="sr-only">
                Étiquette
              </Label>
              <select id="members-tag" name="tag" defaultValue={f.tag} className={selectCls}>
                <option value="">Toute étiquette</option>
                {tagRegistry.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
                {f.tag && !tagRegistry.some((t) => t.name === f.tag) ? (
                  <option value={f.tag}>{f.tag}</option>
                ) : null}
              </select>
            </div>
            <div className="flex gap-1">
              <div className="w-full">
                <Label htmlFor="members-since" className="sr-only">
                  Arrivé après le
                </Label>
                <Input
                  id="members-since"
                  type="date"
                  name="since"
                  defaultValue={f.since}
                  title="Arrivé après le"
                  className="h-10 md:h-9"
                />
              </div>
              <div className="w-full">
                <Label htmlFor="members-until" className="sr-only">
                  Arrivé avant le
                </Label>
                <Input
                  id="members-until"
                  type="date"
                  name="until"
                  defaultValue={f.until}
                  title="Arrivé avant le"
                  className="h-10 md:h-9"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:col-span-9">
              <Button type="submit" size="sm" className="max-md:h-10">
                Filtrer
              </Button>
              <Suspense fallback={null}>
                <RememberFilters storageKey="members" className="max-md:h-10" />
              </Suspense>
              <span className="ml-auto self-center text-xs text-muted-foreground">
                Tri : {sortLink("lastSeen", "dernière activité")} ·{" "}
                {sortLink("firstSeen", "arrivée")} · {sortLink("name", "nom")}
              </span>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            hasFilters ? (
              <EmptyState
                title="Aucun membre ne correspond à ces filtres."
                description="Élargissez la recherche ou réinitialisez les filtres."
                action={{ href: "/members", label: "Voir tous les membres", variant: "outline" }}
              />
            ) : (
              <EmptyState
                title="Aucun membre pour l'instant."
                description="Les membres apparaissent ici dès qu'une personne demande à rejoindre un canal par un lien d'invitation géré par un bot."
                action={{ href: "/campaigns/links", label: "Créer un lien d'invitation" }}
              />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Membre</TableHead>
                  <TableHead className="hidden md:table-cell">Canaux</TableHead>
                  <TableHead className="hidden lg:table-cell">Pub d&apos;origine</TableHead>
                  <TableHead className="hidden md:table-cell">Arrivé le</TableHead>
                  <TableHead>Dernière activité</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Clics</TableHead>
                  <TableHead className="hidden md:table-cell">Joueur</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    <span className="inline-flex items-center gap-1">
                      FTD{" "}
                      <HelpTip>
                        Premier dépôt (FTD) : date du premier dépôt d&apos;argent du joueur rattaché
                        à ce membre.
                      </HelpTip>
                    </span>
                  </TableHead>
                  <TableHead className="text-right">Dépôts</TableHead>
                  <TableHead>Niveau</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/members/${r.id}`} className="font-medium hover:underline">
                        {r.displayName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.username ? `@${r.username} · ` : ""}
                        {r.languageCode ?? "—"}
                      </div>
                      {r.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.tags.map((t) => (
                            <Badge
                              key={t}
                              variant="outline"
                              className={`px-1.5 py-0 text-[10px] ${tagColorClass(colorOf(t, tagRegistry))}`}
                            >
                              {t}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className="hidden max-w-48 truncate text-xs md:table-cell"
                      title={r.channels.join(", ")}
                    >
                      {r.channels.join(", ") || "—"}
                    </TableCell>
                    <TableCell className="hidden text-xs lg:table-cell">
                      {r.source ?? "—"}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                      {fmtDate(r.firstSeenAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtDate(r.lastEventAt)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {r.clicks}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.isPlayer ? "oui" : "non"}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {r.ftdAt ? fmtDate(r.ftdAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.depositCount} ·{" "}
                      {fmtMoney(Math.round(r.depositTotal), "EUR", { digits: 0 })}
                    </TableCell>
                    <TableCell>
                      <LevelBadge level={r.level} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination
            page={f.page}
            pages={pages}
            total={total}
            noun="membre"
            hrefFor={(p) => `/members${filtersToQuery(f, { page: p })}`}
          />
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        {fmtNum(total)} membre{total > 1 ? "s" : ""} au total. Niveau de dépense : calculé à partir
        des dépôts des joueurs rattachés (seuils dans Réglages → Connexions).
      </p>
    </>
  );
}
