import { useId } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * Bloc de formulaire : un titre, une ligne d'aide, puis les champs (niveau 1 « ce qu'il faut pour que
 * ça marche » ou niveau 2 « un clic » des formulaires en trois niveaux, docs/DESIGN-SYSTEM.md).
 * Le bloc titre prend toute la place disponible. Les actions qui passent à la ligne vont à gauche sur téléphone,
 * sous le titre (comme celles du `PageHeader`), et restent à droite sur ordinateur.
 */
export function FormSection({
  title,
  description,
  children,
  actions,
  className,
  id,
}: {
  title: string;
  /** Une ligne d'aide : à quoi sert ce bloc, en français simple. */
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Petit lien ou bouton discret à droite du titre (ex. « + Nouvelle catégorie »). */
  actions?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const autoId = useId();
  const headingId = `${id ?? autoId}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id={headingId} className="text-body font-semibold text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-note text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 md:ml-auto md:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Texte du compteur de réglages modifiés : « 1 réglage modifié », « 3 réglages modifiés ». */
export function modifiedLabel(count: number): string {
  return `${count} réglage${count > 1 ? "s" : ""} modifié${count > 1 ? "s" : ""}`;
}

/**
 * Bloc replié « Avancé » (niveau 3) : les réglages rares, avec des valeurs par défaut sensées.
 * `<details>` natif : accessible au clavier et aux lecteurs d'écran sans JavaScript.
 * `modifiedCount` : nombre de réglages qui s'écartent des valeurs par défaut (affiché replié).
 * Ne mettez pas de champ obligatoire dans un bloc replié.
 */
export function AdvancedSection({
  title = "Avancé",
  description,
  modifiedCount,
  defaultOpen = false,
  children,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  modifiedCount?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details
      data-slot="advanced-section"
      open={defaultOpen || undefined}
      className={cn("group/adv rounded-xl border border-border bg-surface", className)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 select-none hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open/adv:rotate-90"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium text-foreground">{title}</span>
          {description ? (
            <span className="block text-note text-muted-foreground">{description}</span>
          ) : null}
        </span>
        {modifiedCount && modifiedCount > 0 ? (
          <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-brand-soft px-2.5 text-note font-medium text-brand-ink">
            {modifiedLabel(modifiedCount)}
          </span>
        ) : null}
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}
