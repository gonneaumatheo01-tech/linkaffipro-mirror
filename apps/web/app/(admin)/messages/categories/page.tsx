import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { FilterChips } from "@/components/admin/filter-chips";
import { BarList } from "@/components/charts/bar-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { fmtMoney, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import {
  RANGE_DAYS,
  groupByCategory,
  sinceFor,
  withAverages,
  type CategoryRow,
} from "@/lib/posts/category-stats";
import {
  CATEGORY_MEASURES,
  rankCategories,
  toCategoryMeasure,
  type CategoryMeasure,
} from "@/lib/posts/compare";

export const metadata: Metadata = { title: "Comparer par catégorie" };

const RANGES = [
  { value: "7d", label: "7 derniers jours" },
  { value: "30d", label: "30 derniers jours" },
  { value: "90d", label: "90 derniers jours" },
];

function n(v: number): string {
  return Number.isInteger(v) ? fmtNum(v) : v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function measureValue(measure: CategoryMeasure, v: number): string {
  return measure === "depositAmount" ? fmtMoney(v, "EUR", { digits: v < 10 ? 2 : 0 }) : n(v);
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

/** Détail d'une catégorie (volet) : chaque chiffre en total et par message. */
function CategoryDetail({ r }: { r: CategoryRow }) {
  const lines: Array<[string, number, number, boolean?]> = [
    ["Clics", r.clicks, r.avg.clicks],
    ["Personnes qui ont cliqué", r.uniqueClickers, r.avg.uniqueClickers],
    ["Clics sur les offres", r.offerClicks, r.avg.offerClicks],
    ["Réactions", r.reactions, r.avg.reactions],
    ["Inscriptions", r.registrations, r.avg.registrations],
    ["Premiers dépôts", r.ftds, r.avg.ftds],
    ["Dépôts", r.deposits, r.avg.deposits],
    ["Montant déposé", r.depositAmount, r.avg.depositAmount, true],
  ];
  return (
    <dl className="divide-y divide-border rounded-xl border border-border">
      <div className="grid grid-cols-3 gap-2 px-3 py-2 text-note text-muted-foreground">
        <dt>Mesure</dt>
        <dd className="text-right">Total</dd>
        <dd className="text-right">Par message</dd>
      </div>
      {lines.map(([label, total, avg, money]) => (
        <div key={label} className="grid grid-cols-3 gap-2 px-3 py-2 text-body">
          <dt>{label}</dt>
          <dd className="text-right tabular-nums">
            {money ? fmtMoney(total, "EUR", { digits: 0 }) : n(total)}
          </dd>
          <dd className="text-right tabular-nums">
            {money ? fmtMoney(avg, "EUR", { digits: 2 }) : n(avg)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Comparer par catégorie : graphique d'une mesure par message (au choix), puis tableau de 5 colonnes, détail au clic. */
export default async function CategoryComparisonPage({
  searchParams,
}: PageProps<"/messages/categories">) {
  const sp = await searchParams;
  const range = typeof sp.range === "string" && sp.range in RANGE_DAYS ? sp.range : "30d";
  const channelId = typeof sp.channel === "string" ? sp.channel : "";
  const measure = toCategoryMeasure(sp.measure);
  const since = sinceFor(range);
  const [user, channels, categories, posts] = await Promise.all([
    requireUser(),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    prisma.messageCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true },
    }),
    prisma.post.findMany({
      where: {
        status: "SENT",
        isTemplate: false,
        sentAt: { gte: since },
        ...(channelId ? { channelId } : {}),
      },
      select: {
        categoryId: true,
        stats: {
          select: {
            clicks: true,
            uniqueClickers: true,
            offerClicks: true,
            reactionsTotal: true,
            registrations: true,
            ftds: true,
            deposits: true,
            depositAmount: true,
          },
        },
      },
    }),
  ]);
  const rows = withAverages(groupByCategory(posts, categories));
  // Messages envoyés sans catégorie (ou avec une catégorie supprimée) : regroupés dans « Sans catégorie ».
  const uncategorized = rows.find((r) => r.categoryId === null)?.posts ?? 0;
  // Réglages → Catégories est réservé aux administrateurs ; un manager crée sa catégorie depuis le formulaire de message.
  const isAdmin = user.role === "ADMIN";
  const ranked = rankCategories(rows, measure);
  const measureLabel = CATEGORY_MEASURES.find((m) => m.key === measure)!.label;
  const allChannelsHref = `/messages/categories?${new URLSearchParams({ range, measure }).toString()}`;
  const hrefFor = (m: string) => {
    const p = new URLSearchParams({ range, measure: m });
    if (channelId) p.set("channel", channelId);
    return `/messages/categories?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Comparer par catégorie"
        backHref="/messages"
        backLabel="Messages"
        description="Quelles catégories de messages font le plus cliquer, s'inscrire et déposer."
        help="Choisissez une période et, si besoin, un canal. Cliquez une catégorie pour voir tous ses chiffres."
      />
      <form
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3"
      >
        <input type="hidden" name="measure" value={measure} />
        <div className="space-y-1.5">
          <Label htmlFor="cat-range" className="text-note">
            Période
          </Label>
          <NativeSelect id="cat-range" name="range" defaultValue={range} wrapperClassName="w-48">
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-channel" className="text-note">
            Canal
          </Label>
          <NativeSelect
            id="cat-channel"
            name="channel"
            defaultValue={channelId}
            wrapperClassName="w-56"
          >
            <option value="">Tous les canaux</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          Appliquer
        </Button>
      </form>

      {categories.length === 0 ? (
        <EmptyState
          title="Créez votre première catégorie (par exemple Bonus ou Rappel) pour comparer vos messages"
          description={
            isAdmin
              ? "Une catégorie regroupe les messages du même genre. Créez-la dans Réglages → Catégories, puis choisissez-la en écrivant chaque message : cette page comparera leurs clics, inscriptions et dépôts."
              : "Une catégorie regroupe les messages du même genre. En écrivant un message, le champ Catégorie propose « + Nouvelle catégorie » : cette page comparera ensuite leurs clics, inscriptions et dépôts."
          }
          action={
            isAdmin
              ? { href: "/settings/categories", label: "Créer une catégorie", variant: "outline" }
              : { href: "/messages/new", label: "Programmer un message", variant: "outline" }
          }
        />
      ) : rows.length === 0 || posts.length === 0 ? (
        channelId ? (
          <EmptyState
            title="Aucun message envoyé dans ce canal sur la période"
            description="Changez de période ou de canal."
            action={{ href: allChannelsHref, label: "Tous les canaux", variant: "outline" }}
          />
        ) : (
          <EmptyState
            title="Aucun message envoyé sur la période"
            description="Changez de période, ou programmez un message : ses chiffres apparaîtront ici après l'envoi."
            action={{ href: "/messages/new", label: "Programmer un message", variant: "outline" }}
          />
        )
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{measureLabel}</CardTitle>
              <CardDescription>
                {fmtNum(posts.length)} message{posts.length > 1 ? "s" : ""} envoyé
                {posts.length > 1 ? "s" : ""} sur la période ; moyenne par message de chaque
                catégorie.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FilterChips
                label="Mesure"
                chips={CATEGORY_MEASURES.map((m) => ({
                  key: m.key,
                  label: m.label.replace(" par message", ""),
                  href: hrefFor(m.key),
                  selected: m.key === measure,
                }))}
              />
              <BarList
                label={measureLabel}
                items={ranked.map((r) => ({
                  key: r.categoryId ?? "none",
                  // `flex` (pas `inline-flex`) : le nom se coupe avec des points de suspension sur téléphone.
                  label: (
                    <span className="flex min-w-0 items-center gap-2">
                      <Dot color={r.color} />
                      <span className="min-w-0 truncate">{r.name}</span>
                    </span>
                  ),
                  value: r.avg[measure],
                  valueText: measureValue(measure, r.avg[measure]),
                  title: `${r.name} : ${fmtNum(r.posts)} message${r.posts > 1 ? "s" : ""}`,
                }))}
              />
            </CardContent>
          </Card>

          {uncategorized > 0 ? (
            <p className="text-body text-muted-foreground">
              {uncategorized === 1
                ? "1 message envoyé sur la période n'a pas de catégorie : il est compté dans « Sans catégorie »."
                : `${fmtNum(uncategorized)} messages envoyés sur la période n'ont pas de catégorie : ils sont comptés dans « Sans catégorie ».`}{" "}
              Choisissez une catégorie pour vos prochains messages afin de les comparer.
            </p>
          ) : null}

          <DataTable
            label="Catégories de messages"
            columns={[
              { key: "name", header: "Catégorie" },
              { key: "posts", header: "Messages", align: "right", hideOnMobile: true },
              { key: "clicks", header: "Clics par message", align: "right" },
              {
                key: "ftds",
                header: "Premiers dépôts",
                term: "FTD",
                align: "right",
                hideOnMobile: true,
              },
              { key: "deposit", header: "Montant déposé", align: "right", hideOnMobile: true },
            ]}
            rows={rows.map((r) => ({
              id: r.categoryId ?? "none",
              detailTitle: r.name,
              detailDescription: `${fmtNum(r.posts)} message${r.posts > 1 ? "s" : ""} envoyé${r.posts > 1 ? "s" : ""} sur la période`,
              cells: {
                name: (
                  <span className="inline-flex items-center gap-2">
                    <Dot color={r.color} />
                    {r.name}
                  </span>
                ),
                posts: fmtNum(r.posts),
                clicks: n(r.avg.clicks),
                ftds: fmtNum(r.ftds),
                deposit: fmtMoney(r.depositAmount, "EUR", { digits: 0 }),
              },
              sortValues: {
                name: r.name,
                posts: r.posts,
                clicks: r.avg.clicks,
                ftds: r.ftds,
                deposit: r.depositAmount,
              },
              detail: <CategoryDetail r={r} />,
            }))}
          />
        </div>
      )}
    </>
  );
}
