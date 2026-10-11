import type { Metadata } from "next";
import { AdminNotFoundCard } from "./not-found-back";

export const metadata: Metadata = { title: "Page introuvable" };

/**
 * Élément introuvable dans l'espace connecté (`notFound()` d'une fiche : campagne, membre, canal supprimés…) :
 * carte « Cette page n'existe pas ou n'existe plus. » dans la coque (menu et en-tête restent en place), avec le retour
 * vers la liste de la rubrique (« Retour aux campagnes », « Retour aux membres »…, `notFoundBack`), l'accueil sinon.
 */
export default function AdminNotFound() {
  return <AdminNotFoundCard />;
}
