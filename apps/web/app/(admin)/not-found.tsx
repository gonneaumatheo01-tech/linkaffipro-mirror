import type { Metadata } from "next";
import { NotFoundPage } from "@/components/admin/error-page";

export const metadata: Metadata = { title: "Page introuvable" };

/**
 * Élément introuvable dans l'espace connecté (`notFound()` d'une fiche : campagne, membre, canal supprimés…) :
 * carte « Cette page n'existe pas ou n'existe plus. » dans la coque (menu et en-tête restent en place).
 */
export default function AdminNotFound() {
  return <NotFoundPage />;
}
