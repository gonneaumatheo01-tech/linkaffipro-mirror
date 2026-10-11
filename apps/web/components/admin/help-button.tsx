"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { SidePanel } from "./side-panel";

/**
 * Bouton rond « ? » (aria-label « Aide de cette page ») qui ouvre l'aide de la page courante dans un volet,
 * avec un lien vers le guide complet. Le contenu est passé en `children` (sections du guide, en français simple).
 * Pied du volet : `footerExtra` (ex. « Revoir la visite guidée »), puis « Ouvrir le guide complet » : deux actions
 * secondaires côte à côte (contour), aucun bouton orange dans une aide. Sur téléphone, elles s'empilent, le guide en
 * haut (ordre du pied de `SidePanel`).
 */
export function HelpButton({
  title = "Aide de cette page",
  description,
  children,
  guideHref = "/help",
  guideLabel = "Ouvrir le guide complet",
  footerExtra,
  size = "lg",
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Lien vers le guide complet ; `null` pour ne pas l'afficher. */
  guideHref?: string | null;
  guideLabel?: string;
  /** Action de plus dans le pied du volet, à côté du lien vers le guide (bouton `outline`). */
  footerExtra?: React.ReactNode;
  /** Largeur du volet sur ordinateur : `lg` (512 px) par défaut, pour une ligne de lecture confortable et les deux
   * actions du pied côte à côte. */
  size?: React.ComponentProps<typeof SidePanel>["size"];
  className?: string;
}) {
  // Conteneur propre : les deux actions passent à la ligne si le volet est trop étroit pour les mettre côte à côte.
  const footer =
    footerExtra || guideHref ? (
      <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        {footerExtra}
        {guideHref ? (
          <Link
            href={guideHref}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <BookOpen aria-hidden />
            {guideLabel}
          </Link>
        ) : null}
      </div>
    ) : null;
  return (
    <SidePanel
      title={title}
      description={description}
      trigger={
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Aide de cette page"
          title="Aide de cette page"
          className={cn(
            "rounded-full font-semibold text-muted-foreground hover:text-foreground",
            className,
          )}
        >
          <span aria-hidden>?</span>
        </Button>
      }
      footer={footer}
      size={size}
    >
      {/* Zone nommée et atteignable au clavier : une aide sans lien n'a rien de focalisable, et le volet qui défile
          ne se lirait qu'à la souris (axe « scrollable-region-focusable »). Focalisée, les flèches font défiler. */}
      <div
        role="region"
        aria-label="Contenu de l'aide"
        tabIndex={0}
        className="space-y-3 rounded-md text-body text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&_a]:font-medium [&_a]:text-brand-ink [&_a]:underline [&_a]:underline-offset-3 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3:first-child]:mt-0 [&_li]:ml-4 [&_li]:list-disc [&_p]:text-muted-foreground"
      >
        {children}
      </div>
    </SidePanel>
  );
}
