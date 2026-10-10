import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { withBuiltinSections } from "@/lib/help/builtin-sections";
import { loadGuide } from "@/lib/help/guide";
import { extractHeadings, renderMarkdown } from "@/lib/help/markdown";
import { GUIDE_PROSE } from "@/lib/help/prose";
import { restartTourAction } from "@/lib/onboarding/actions";

export const metadata: Metadata = { title: "Aide" };

const DESCRIPTION = "Le guide d'utilisation complet, menu par menu, en français simple.";

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

/**
 * Guide complet (docs/GUIDE-UTILISATEUR.md, complété des sections de lib/help/builtin-sections.ts qu'il n'a pas
 * encore) avec son sommaire. L'aide propre à chaque page s'ouvre par le bouton « ? »
 * de l'en-tête (mêmes sections, même rendu) ; « Ouvrir le guide complet » mène ici, à la bonne ancre.
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
  // Sections que le guide n'a pas encore (accueil refait) : mêmes textes et ancres que le volet « ? ».
  const markdown = withBuiltinSections(guide.markdown);
  const headings = extractHeadings(markdown)
    .filter((h) => h.level === 2 || h.level === 3)
    .filter((h) => h.id !== "table-des-matieres");
  const html = renderMarkdown(markdown);
  return (
    <>
      <PageHeader title="Aide" description={DESCRIPTION} secondaryActions={<TourButton />} />
      <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav
          aria-label="Sommaire du guide"
          className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto"
        >
          <p className="mb-2 px-2 text-note font-semibold text-muted-foreground">Sommaire</p>
          <ul className="space-y-0.5 text-body">
            {headings.map((h) => (
              <li key={h.id} className={h.level === 3 ? "pl-4" : undefined}>
                <a
                  href={`#${h.id}`}
                  className={cn(
                    "block rounded-md px-2 py-1 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-md:py-2.5",
                    h.level === 2 ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <Card>
          <CardContent className="md:px-6">
            <article className={GUIDE_PROSE} dangerouslySetInnerHTML={{ __html: html }} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
