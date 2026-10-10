import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

/**
 * Bloc de l'accueil : carte blanche, titre de section (`<h2>`), une ligne d'aide facultative, un lien discret à droite
 * (« Voir le calendrier », « Toutes les campagnes »).
 * L'action garde sa cible (32 px, 40 px sur téléphone) mais est centrée sur la ligne du titre (20 px de haut) par une
 * marge négative : sans elle, son texte tombait 6 px plus bas que le titre. Toute action doit donc mesurer 32 px
 * (40 px sur téléphone) : `sectionLinkClass`, ou un bouton `size="sm"` avec `max-md:h-10`.
 */
export function HomeSection({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  /** Préfixe des identifiants (titre relié à la section). */
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const titleId = `${id}-titre`;
  return (
    <section aria-labelledby={titleId} className={cn("min-w-0", className)}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle>
            <h2
              id={titleId}
              className="flex items-center gap-2 text-body font-semibold text-foreground"
            >
              {title}
            </h2>
          </CardTitle>
          {description ? (
            <CardDescription className="text-note">{description}</CardDescription>
          ) : null}
          {action ? (
            <CardAction className="-my-1.5 flex max-md:-my-2.5">{action}</CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">{children}</CardContent>
      </Card>
    </section>
  );
}

/** Lien discret d'en-tête de bloc (texte orange foncé, cible de 40 px sur téléphone). */
export const sectionLinkClass =
  "inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-note font-medium text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:min-h-10";
