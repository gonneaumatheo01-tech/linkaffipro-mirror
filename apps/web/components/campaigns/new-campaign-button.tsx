import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/**
 * Lien-bouton « Nouvelle campagne » (assistant en 4 étapes), pour un écran qui n'a pas d'autre bouton principal.
 * `variant="outline"` pour une version discrète. La page Campagnes passe par `PageHeader` (`primaryAction`).
 */
export function NewCampaignButton({
  variant = "default",
  className,
}: {
  variant?: "default" | "outline";
  className?: string;
}) {
  return (
    <Link
      href="/campaigns/new"
      className={cn(buttonVariants({ variant }), "max-md:h-10", className)}
    >
      <Plus aria-hidden />
      Nouvelle campagne
    </Link>
  );
}
