import type { Metadata, Viewport } from "next";
import { NotFoundPage } from "@/components/admin/error-page";
import { BRAND_THEME_COLOR, BrandScreen } from "./(auth)/brand-screen";

export const metadata: Metadata = { title: "Page introuvable" };
export const viewport: Viewport = { themeColor: BRAND_THEME_COLOR };

/**
 * Adresse inconnue du site (hors des fiches de l'espace connecté, qui ont app/(admin)/not-found.tsx) : écran de
 * marque nuit et carte blanche. Pas de recherche ici (la page peut s'afficher sans session) ; le bouton mène à
 * l'accueil, qui renvoie vers la connexion si besoin. Le domaine des liens traqués n'arrive jamais ici
 * (redirection immédiate par app/r).
 */
export default function NotFound() {
  return (
    <BrandScreen width="md">
      <NotFoundPage hint="Le lien est peut-être ancien ou incomplet." className="mt-0" />
    </BrandScreen>
  );
}
