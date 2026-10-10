import Image from "next/image";
import logo from "@/public/brand/logo.webp";
import { cn } from "@/components/ui/cn";

/**
 * Logo de la marque (« L » orange sur fond nuit), servi tel quel depuis /_next/static (import statique : pas de
 * passage par le proxy d'authentification, mis en cache). Coins légèrement arrondis pour épouser le carré du logo.
 * Toujours en haut de l'écran (menu, en-tête, connexion) : chargé tout de suite. Décoratif (`alt=""`) : le nom
 * « LinkAffi Pro » est toujours écrit à côté, dans le titre ou dans le libellé du lien.
 *
 * Composant serveur, dans son propre fichier : les pages sans session (connexion, invitation, confidentialité,
 * conditions, page introuvable) l'affichent sans charger le code de la barre de menu.
 */
export function BrandLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <Image
      src={logo}
      alt=""
      width={size}
      height={size}
      loading="eager"
      unoptimized
      className={cn("shrink-0 rounded-[18%]", className)}
    />
  );
}
