import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { loadGuide } from "@/lib/help/guide";
import { extractHeadings, renderMarkdown } from "@/lib/help/markdown";

export const metadata: Metadata = { title: "Aide" };

/** Classes « prose maison » appliquées au HTML du guide (aucune dépendance de typographie). */
const PROSE =
  "space-y-4 text-sm leading-relaxed " +
  "[&_h1]:hidden " +
  "[&_h2]:mt-10 [&_h2]:scroll-mt-20 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight " +
  "[&_h3]:mt-8 [&_h3]:scroll-mt-20 [&_h3]:text-base [&_h3]:font-semibold " +
  "[&_h4]:mt-6 [&_h4]:scroll-mt-20 [&_h4]:text-sm [&_h4]:font-semibold " +
  "[&_p]:text-foreground/90 " +
  "[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_li>ul]:mt-1 [&_li>ol]:mt-1 " +
  "[&_strong]:font-semibold [&_em]:italic " +
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] " +
  "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80 " +
  "[&_blockquote]:border-l-4 [&_blockquote]:border-muted [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground " +
  "[&_hr]:my-8 [&_hr]:border-t " +
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top";

export default async function HelpPage() {
  const guide = await loadGuide();
  if (guide.markdown === null) {
    return (
      <>
        <PageHeader title="Aide" description="Le guide d'utilisation complet, aussi dans docs/GUIDE-UTILISATEUR.md" />
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            <p className="font-medium">Le guide d&apos;utilisation est introuvable sur ce serveur.</p>
            <p className="text-muted-foreground">Le fichier <code className="font-mono">docs/GUIDE-UTILISATEUR.md</code> n&apos;a pas été copié avec le site. Vous pouvez le lire directement dans le dépôt du projet. Emplacements essayés :</p>
            <ul className="list-disc pl-5 font-mono text-xs text-muted-foreground">
              {guide.tried.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </CardContent>
        </Card>
      </>
    );
  }
  const headings = extractHeadings(guide.markdown).filter((h) => h.level === 2 || h.level === 3).filter((h) => h.id !== "table-des-matieres");
  const html = renderMarkdown(guide.markdown);
  return (
    <>
      <PageHeader title="Aide" description="Le guide d'utilisation complet, aussi dans docs/GUIDE-UTILISATEUR.md" />
      <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Table des matières" className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sommaire</p>
          <ul className="space-y-1 text-sm">
            {headings.map((h) => (
              <li key={h.id} className={h.level === 3 ? "pl-4" : ""}>
                <a href={`#${h.id}`} className={`block rounded px-2 py-1 hover:bg-accent ${h.level === 2 ? "font-medium" : "text-muted-foreground"}`}>{h.text}</a>
              </li>
            ))}
          </ul>
        </nav>
        <Card>
          <CardContent className="pt-6">
            <article className={PROSE} dangerouslySetInnerHTML={{ __html: html }} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
