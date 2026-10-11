import Link from "next/link";
import { LayoutGrid, Pencil, SearchX } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { UniverseDot } from "@/components/admin/universe-dot";
import { FilterChips, type FilterChip } from "@/components/admin/filter-chips";
import { CollapsibleFilters } from "@/components/admin/collapsible-filters";
import {
  placeholdersToComplete,
  PLACEHOLDER_MARK_CLASS,
} from "@/components/messages/preview-placeholders";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { parseButtons } from "@/lib/posts/buttons";
import {
  listPosts,
  listTemplateCategories,
  TEMPLATE_THEMES,
  templateThemeOf,
  type PostListFilters,
} from "@/lib/posts/queries";
import { templateCardTitle, templatesHref } from "@/lib/posts/templates";
import { toUniverse, UNIVERSE_LABELS, UNIVERSES } from "@/lib/universe";
import type { SearchParams } from "./shared";

/**
 * Vue Modèles : galerie de cartes filtrable par univers, par thème et (quand des modèles en ont) par catégorie ;
 * aperçu du texte (repères {prenom}, {offre}… surlignés, avec « À compléter »), « Utiliser » (nouveau message
 * pré-rempli) et « Modifier ».
 */
export async function TemplatesView({
  sp,
  filters: f,
  tabs,
}: {
  sp: SearchParams;
  filters: PostListFilters;
  tabs: React.ReactNode;
}) {
  const page = pageOf(sp);
  const vertical = toUniverse(f.vertical) ?? "";
  const theme = TEMPLATE_THEMES.some((t) => t.slug === f.theme) ? f.theme! : "";
  const [listed, categories] = await Promise.all([
    listPosts({ view: "templates", filters: f, page }),
    listTemplateCategories(),
  ]);
  const categoryId = categories.some((c) => c.id === f.categoryId) ? f.categoryId : "";
  const current = { vertical, theme, categoryId };
  const hasFilters = Boolean(vertical || theme || categoryId);

  const universeChips: FilterChip[] = [
    {
      key: "all",
      label: "Tous",
      href: templatesHref({ ...current, vertical: "" }),
      selected: !vertical,
    },
    ...UNIVERSES.map((u) => ({
      key: u,
      label: UNIVERSE_LABELS[u],
      href: templatesHref({ ...current, vertical: u }),
      selected: vertical === u,
      icon: <UniverseDot universe={u} />,
    })),
  ];
  const themeChips: FilterChip[] = [
    { key: "all", label: "Tous", href: templatesHref({ ...current, theme: "" }), selected: !theme },
    ...TEMPLATE_THEMES.map((t) => ({
      key: t.slug,
      label: t.label,
      href: templatesHref({ ...current, theme: t.slug }),
      selected: theme === t.slug,
    })),
  ];
  const categoryChips: FilterChip[] = [
    {
      key: "all",
      label: "Toutes",
      href: templatesHref({ ...current, categoryId: "" }),
      selected: !categoryId,
    },
    ...categories.map((c) => ({
      key: c.id,
      label: c.name,
      href: templatesHref({ ...current, categoryId: c.id }),
      selected: categoryId === c.id,
      icon: (
        <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
      ),
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">{tabs}</div>
      {/* Téléphone : pastilles repliées derrière « Filtres (n) », les modèles d'abord. */}
      <CollapsibleFilters activeCount={[vertical, theme, categoryId].filter(Boolean).length}>
        <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
          <FilterChips label="Univers" chips={universeChips} />
          <FilterChips label="Thème" chips={themeChips} />
          {categories.length > 0 ? <FilterChips label="Catégorie" chips={categoryChips} /> : null}
        </div>
      </CollapsibleFilters>

      {listed.rows.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<SearchX />}
            title="Aucun modèle pour ces filtres"
            description="Changez d'univers ou de thème, ou retirez les filtres."
            action={{
              href: "/messages?view=templates",
              label: "Tous les modèles",
              variant: "outline",
            }}
          />
        ) : (
          <EmptyState
            icon={<LayoutGrid />}
            title="Aucun modèle"
            description="Ouvrez un message et cliquez « Enregistrer comme modèle » : vous pourrez le réutiliser en un clic."
            action={{ href: "/messages?view=list", label: "Voir les messages", variant: "outline" }}
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Modèles">
          {listed.rows.map((t) => {
            const th = templateThemeOf(t.code);
            const title = templateCardTitle(t.templateName ?? "Modèle sans nom");
            const toComplete = placeholdersToComplete(t.text);
            return (
              <li
                key={t.id}
                className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <UniverseDot universe={t.vertical} variant="pill" />
                  {th ? (
                    <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-note font-medium">
                      {th.label}
                    </span>
                  ) : null}
                  {t.category ? (
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-note font-medium">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: t.category.color }}
                      />
                      {t.category.name}
                    </span>
                  ) : null}
                </div>
                <h3 className="text-body font-semibold text-foreground">{title}</h3>
                <TelegramPreview
                  html={t.text}
                  buttons={parseButtons(t.buttons)}
                  mediaCount={Array.isArray(t.mediaAssetIds) ? t.mediaAssetIds.length : 0}
                  compact
                  highlightPlaceholders
                  className="flex-1"
                />
                {toComplete.length > 0 ? (
                  <p className="text-note text-muted-foreground">
                    À compléter :{" "}
                    {toComplete.map((k, i) => (
                      <span key={k}>
                        {i > 0 ? ", " : null}
                        <mark className={PLACEHOLDER_MARK_CLASS}>{`{${k}}`}</mark>
                      </span>
                    ))}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/messages/new?from=${t.id}`}
                    aria-label={`Utiliser le modèle « ${title} »`}
                    className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
                  >
                    Utiliser
                  </Link>
                  <Link
                    href={`/messages/${t.id}/edit`}
                    aria-label={`Modifier le modèle « ${title} »`}
                    className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
                  >
                    <Pencil aria-hidden />
                    Modifier
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination
        page={page}
        pages={listed.pages}
        total={listed.total}
        noun="modèle"
        hrefFor={(n) =>
          pageHref("/messages", { ...sp, view: "templates", ok: undefined, error: undefined }, n)
        }
      />
    </div>
  );
}
