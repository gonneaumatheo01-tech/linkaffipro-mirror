import Link from "next/link";
import { Download } from "lucide-react";
import type { PostStatus } from "@linkaffipro/db";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { UniverseDot } from "@/components/admin/universe-dot";
import { CollapsibleFilters } from "@/components/messages/collapsible-filters";
import { MessagesListTable } from "@/components/messages/messages-list-table";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { fmtDate, fmtNum } from "@/lib/format";
import { postExcerpt } from "@/lib/posts/display";
import {
  listPosts,
  POST_STATUS_LABELS,
  postListQuery,
  type PostListFilters,
} from "@/lib/posts/queries";
import { statusLabel, StatusBadge } from "@/lib/status-badges";
import { toPanelItem, type MessagesOptions, type SearchParams } from "./shared";

const STATUSES = Object.keys(POST_STATUS_LABELS) as PostStatus[];

/**
 * Vue Liste : tableau de 5 colonnes (message, canal, date, statut, clics ; sur téléphone, le message avec sa date et
 * son statut), même volet de détail que le calendrier, export CSV.
 */
export async function ListView({
  sp,
  filters: f,
  options,
  tabs,
}: {
  sp: SearchParams;
  filters: PostListFilters;
  options: MessagesOptions;
  tabs: React.ReactNode;
}) {
  const page = pageOf(sp);
  const listed = await listPosts({ view: "list", filters: f, page });
  const exportHref = `/messages/export?${postListQuery(f)}`;
  const activeCount = [f.channelId, f.campaignId, f.status, f.categoryId, f.from || f.to].filter(
    Boolean,
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tabs}
        <a href={exportHref} className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}>
          <Download aria-hidden />
          Exporter (CSV)
        </a>
      </div>

      <CollapsibleFilters activeCount={activeCount}>
        {/* Changer un filtre ramène à la page 1 (pas de champ « page » dans ce formulaire). */}
        <form
          method="get"
          action="/messages"
          className="grid gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 md:flex md:flex-wrap md:items-end"
        >
          <input type="hidden" name="view" value="list" />
          <div className="space-y-1.5">
            <Label htmlFor="list-channel" className="text-note">
              Canal
            </Label>
            <NativeSelect
              id="list-channel"
              name="channel"
              defaultValue={f.channelId}
              wrapperClassName="w-full md:w-48"
            >
              <option value="">Tous les canaux</option>
              {options.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="list-campaign" className="text-note">
              Campagne
            </Label>
            <NativeSelect
              id="list-campaign"
              name="campaignId"
              defaultValue={f.campaignId}
              title="Messages des canaux de la campagne ou avec un bouton Offre vers une de ses offres"
              wrapperClassName="w-full md:w-52"
            >
              <option value="">Toutes les campagnes</option>
              {options.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="list-status" className="text-note">
              Statut
            </Label>
            <NativeSelect
              id="list-status"
              name="status"
              defaultValue={f.status}
              wrapperClassName="w-full md:w-40"
            >
              <option value="">Tous les statuts</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {POST_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="list-category" className="text-note">
              Catégorie
            </Label>
            <NativeSelect
              id="list-category"
              name="category"
              defaultValue={f.categoryId}
              wrapperClassName="w-full md:w-52"
            >
              <option value="">Toutes les catégories</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {/* Du et Au restent ensemble : ils passent à la ligne d'un bloc. */}
          <fieldset className="min-w-0 sm:col-span-2 md:col-auto">
            <legend className="sr-only">Période</legend>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1 space-y-1.5 md:flex-none">
                <Label htmlFor="list-from" className="text-note">
                  Du
                </Label>
                <Input
                  id="list-from"
                  type="date"
                  name="from"
                  defaultValue={f.from}
                  className="md:w-40"
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 md:flex-none">
                <Label htmlFor="list-to" className="text-note">
                  Au
                </Label>
                <Input id="list-to" type="date" name="to" defaultValue={f.to} className="md:w-40" />
              </div>
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2 sm:col-span-2 md:col-auto">
            <Button type="submit" variant="outline">
              Filtrer
            </Button>
            {activeCount > 0 ? (
              <Link
                href="/messages?view=list"
                className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
              >
                Effacer les filtres
              </Link>
            ) : null}
          </div>
        </form>
      </CollapsibleFilters>

      <MessagesListTable
        columns={[
          { key: "message", header: "Message", sortable: false },
          { key: "channel", header: "Canal", hideOnMobile: true },
          { key: "date", header: "Date", hideOnMobile: true },
          { key: "status", header: "Statut", hideOnMobile: true },
          { key: "clicks", header: "Clics", align: "right", hideOnMobile: true },
        ]}
        items={listed.rows.map(toPanelItem)}
        rows={listed.rows.map((p) => {
          const text = postExcerpt(p.text, 140) || "(média seul)";
          return {
            id: p.id,
            cells: {
              message: (
                <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal md:max-w-[22rem]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 max-md:line-clamp-2 md:truncate">{text}</span>
                    {p.abGroupId ? (
                      <span className="shrink-0 rounded-full border border-border px-1.5 text-note font-normal text-muted-foreground">
                        A/B{p.abVariant ? ` · ${p.abVariant}` : ""}
                      </span>
                    ) : null}
                  </span>
                  {/* Téléphone : la date et l'état sous l'extrait (les autres colonnes sont masquées). */}
                  <span className="text-note font-normal text-muted-foreground md:hidden">
                    {p.scheduledAt ? fmtDate(p.scheduledAt) : "Sans date"} ·{" "}
                    {statusLabel("post", p.status)}
                  </span>
                </span>
              ),
              channel: (
                <UniverseDot universe={p.channel.vertical} withLabel label={p.channel.title} />
              ),
              date: fmtDate(p.scheduledAt),
              status: <StatusBadge kind="post" value={p.status} />,
              clicks: fmtNum(p.stats?.clicks ?? 0),
            },
            sortValues: {
              channel: p.channel.title,
              status: POST_STATUS_LABELS[p.status],
            },
          };
        })}
        empty={
          activeCount > 0
            ? {
                title: "Aucun message ne correspond à ces filtres",
                description: "Élargissez les dates ou retirez un filtre.",
                action: {
                  href: "/messages?view=list",
                  label: "Retirer les filtres",
                  variant: "outline",
                },
              }
            : {
                title: "Aucun message pour l'instant",
                description: "Choisissez les canaux, écrivez le texte, puis une date et une heure.",
                action: {
                  href: "/messages/new",
                  label: "Programmer un message",
                  variant: "outline",
                },
              }
        }
      />
      <Pagination
        page={page}
        pages={listed.pages}
        total={listed.total}
        noun="message"
        hrefFor={(n) =>
          pageHref("/messages", { ...sp, view: "list", ok: undefined, error: undefined }, n)
        }
      />
    </div>
  );
}
