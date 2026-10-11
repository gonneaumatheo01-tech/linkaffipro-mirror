import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/** Bouton principal d'une page : un lien (`{ label, href }`) ou un nœud (bouton de formulaire, menu…). */
export type PageAction = { label: string; href: string; icon?: React.ReactNode } | React.ReactNode;

function isLinkAction(a: PageAction): a is { label: string; href: string; icon?: React.ReactNode } {
  return typeof a === "object" && a !== null && "href" in a && "label" in a && !("$$typeof" in a);
}

/**
 * En-tête de page : le seul `<h1>` de l'écran (titre 20 px), une ligne d'aide grise (`description`),
 * une note facultative (`help` : la première chose à faire) et les actions à droite.
 * - `primaryAction` : LE bouton principal orange de la page (un seul) ;
 * - `secondaryActions` : actions discrètes (boutons `outline` / `ghost`), placées avant le principal ;
 * - `children` : contenu libre à droite, comme avant (compatibilité) ;
 * - `backHref` / `backLabel` : lien « ← Retour » au-dessus du titre (fiches, sous-pages) ;
 * - `meta` : pastilles à côté du titre (univers, statut).
 * Sur téléphone, les actions passent sous le titre, sur toute la largeur, le bouton principal en premier (le geste
 * attendu est le premier sous le pouce) : aucune page n'a besoin d'ajouter `max-md:order-first` elle-même.
 */
export function PageHeader({
  title,
  description,
  help,
  children,
  primaryAction,
  secondaryActions,
  backHref,
  backLabel = "Retour",
  meta,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  help?: React.ReactNode;
  children?: React.ReactNode;
  primaryAction?: PageAction;
  secondaryActions?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  meta?: React.ReactNode;
  className?: string;
}) {
  const primary =
    primaryAction === undefined ||
    primaryAction === null ||
    primaryAction === false ? null : isLinkAction(primaryAction) ? (
      <Link href={primaryAction.href} className={cn(buttonVariants(), "max-md:h-10")}>
        {primaryAction.icon}
        {primaryAction.label}
      </Link>
    ) : (
      primaryAction
    );
  const hasActions = Boolean(children || secondaryActions || primary);
  return (
    <div
      className={cn("mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3", className)}
    >
      <div className="min-w-0 flex-1 basis-72">
        {backHref ? (
          <Link
            href={backHref}
            className="-ml-1 mb-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-note font-medium text-muted-foreground hover:text-foreground max-md:min-h-10"
          >
            <ChevronLeft aria-hidden className="size-4" />
            {backLabel}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-title text-foreground">{title}</h1>
          {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {description ? (
          <p className="mt-1 max-w-3xl text-body text-muted-foreground">{description}</p>
        ) : null}
        {help ? <p className="mt-1 max-w-3xl text-note text-muted-foreground">{help}</p> : null}
      </div>
      {hasActions ? (
        <div data-slot="page-actions" className="flex flex-wrap items-center gap-2 max-md:w-full">
          {children}
          {secondaryActions}
          {primary ? (
            <div data-slot="page-primary-action" className="flex max-md:order-first">
              {primary}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
