"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { SidePanel } from "./side-panel";

/**
 * Bouton rond « ? » (aria-label « Aide de cette page ») qui ouvre l'aide de la page courante dans un volet,
 * avec un lien vers le guide complet. Le contenu est passé en `children` (sections du guide, en français simple).
 */
export function HelpButton({
  title = "Aide de cette page",
  description,
  children,
  guideHref = "/help",
  guideLabel = "Ouvrir le guide complet",
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Lien vers le guide complet ; `null` pour ne pas l'afficher. */
  guideHref?: string | null;
  guideLabel?: string;
  className?: string;
}) {
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
      footer={
        guideHref ? (
          <Link
            href={guideHref}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <BookOpen aria-hidden />
            {guideLabel}
          </Link>
        ) : null
      }
    >
      <div className="space-y-3 text-body text-foreground [&_a]:font-medium [&_a]:text-brand-ink [&_a]:underline [&_a]:underline-offset-3 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3:first-child]:mt-0 [&_li]:ml-4 [&_li]:list-disc [&_p]:text-muted-foreground">
        {children}
      </div>
    </SidePanel>
  );
}
