"use client";

import { usePathname } from "next/navigation";
import { NotFoundPage } from "@/components/admin/error-page";
import { notFoundBack } from "@/lib/not-found-back";

/** Carte « page introuvable » de l'espace connecté, avec le retour vers la liste de la rubrique ouverte. */
export function AdminNotFoundCard() {
  const back = notFoundBack(usePathname());
  return <NotFoundPage backHref={back.href} backLabel={back.label} />;
}
