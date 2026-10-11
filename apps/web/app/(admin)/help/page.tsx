import type { Metadata } from "next";
import { ChevronDown, Compass } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { withBuiltinSections } from "@/lib/help/builtin-sections";
import { loadGuide } from "@/lib/help/guide";
import { extractHeadings, renderMarkdown, type Heading } from "@/lib/help/markdown";
import { GUIDE_PROSE } from "@/lib/help/prose";
import { withoutSections, withoutTitle } from "@/lib/help/sections";
import { restartTourAction } from "@/lib/onboarding/actions";
import { TocJumpButton } from "./toc-button";

export const metadata: Metadata = { title: "Aide" };

const DESCRIPTION = "Le guide d'utilisation complet, menu par menu, en français simple.";
const HELP_LINE =
  "Sur chaque page, le bouton « ? » en haut à droite ouvre directement le passage qui la concerne.";

function TourButton() {
  return (
    <form action={restartTourAction}>
      <Button type="submit" variant="outline" className="max-md:h-10">
        <Compass aria-hidden />
        Revoir la visite guidée
      </Button>
    </form>
  );
}

const linkClass =
  "block rounded-md px-2 py-1 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-lg:py-2.5";

/** Liste du sommaire : rubriques (niveau 2) en gras, sous-rubriques (niveau 3) en retrait. */
function TocList({ headings }: { headings: Heading[] }) {
  return (
    <ul className="space-y-0.5 text-body">
      {headings.map((h) => (
        <li key={h.id} className={h.level === 3 ? "pl-4" : undefined}>
          <a
            href={`#${h.id}`}
            className={cn(
              linkClass,
              h.level === 2 ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Guide complet (docs/GUIDE-UTILISATEUR.md, complété des sections de lib/help/builtin-sections.ts qu'il n'aurait pas
 * encore) avec son sommaire. L'aide propre à chaque page s'ouvre par le bouton « ? » de l'en-tête (mêmes sections,
 * même rendu) ; « Ouvrir le guide complet » mène ici, à la bonne ancre.
 * Sommaire : colonne fixe à gauche sur grand écran (rubriques et sous-rubriques) ; sur téléphone et tablette, un bloc
 * replié en haut (rubriques seulement), pour que le guide commence tout de suite, et un bouton « Sommaire » qui reste
 * visible en bas à droite pour y revenir depuis n'importe où. Colonne du guide limitée à ~72 caractères par ligne
 * (`GUIDE_PROSE`). La « Table des matières » écrite
 * dans le guide n'est pas rendue ici (le sommaire la remplace), ni son titre `#` (le seul `<h1>` est celui de la page).
 */
export default async function HelpPage() {
  const guide = await loadGuide();
  if (guide.markdown === null) {
    return (
      <>
        <PageHeader title="Aide" description={DESCRIPTION} secondaryActions={<TourButton />} />
        <Card>
          <CardContent className="space-y-2 text-body">
            <p className="font-medium">
              Le guide d&apos;utilisation est introuvable sur ce serveur.
            </p>
            <p className="text-muted-foreground">
              Le fichier <code className="font-mono">docs/GUIDE-UTILISATEUR.md</code> n&apos;a pas
              été copié avec le site. Vous pouvez le lire directement dans le dépôt du projet.
              Emplacements essayés :
            </p>
            <ul className="list-disc pl-5 font-mono text-note text-muted-foreground">
              {guide.tried.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </>
    );
  }
  const markdown = withoutTitle(
    withoutSections(withBuiltinSections(guide.markdown), ["Table des matières"]),
  );
  const headings = extractHeadings(markdown).filter((h) => h.level === 2 || h.level === 3);
  const chapters = headings.filter((h) => h.level === 2);
  const html = renderMarkdown(markdown);
  return (
    <>
      <PageHeader
        title="Aide"
        description={DESCRIPTION}
        help={HELP_LINE}
        secondaryActions={<TourButton />}
      />
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
        <nav
          aria-label="Sommaire du guide"
          className="max-lg:hidden lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto"
        >
          <p className="mb-2 px-2 text-note font-semibold text-muted-foreground">Sommaire</p>
          <TocList headings={headings} />
        </nav>
        <nav id="sommaire" aria-label="Sommaire du guide" className="scroll-mt-20 lg:hidden">
          <details className="group/toc rounded-xl border border-border bg-card">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2 text-body font-semibold text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span>
                Sommaire{" "}
                <span className="font-normal text-muted-foreground">
                  ({chapters.length} rubriques)
                </span>
              </span>
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open/toc:rotate-180"
              />
            </summary>
            <div className="border-t border-border px-2 py-2">
              <TocList headings={chapters} />
            </div>
          </details>
        </nav>
        <Card>
          <CardContent className="md:px-6">
            <article className={GUIDE_PROSE} dangerouslySetInnerHTML={{ __html: html }} />
          </CardContent>
        </Card>
      </div>
      <TocJumpButton targetId="sommaire" />
    </>
  );
}
