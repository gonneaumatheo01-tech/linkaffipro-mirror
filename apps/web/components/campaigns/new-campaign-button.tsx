import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Bouton « Nouvelle campagne » (assistant en 4 étapes). Utilisé en haut de la page Campagnes et sur le tableau de bord
 * vide. `variant="outline"` pour une version discrète.
 */
export function NewCampaignButton({ variant = "default", className }: { variant?: "default" | "outline"; className?: string }) {
  return (
    <Button variant={variant} className={`max-md:h-10 ${className ?? ""}`} render={<Link href="/campaigns/new" />}>
      <Plus className="size-4" />
      Nouvelle campagne
    </Button>
  );
}
