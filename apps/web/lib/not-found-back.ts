/**
 * Page introuvable dans l'espace connecté (`notFound()` d'une fiche supprimée : campagne, membre, canal…) : le bouton
 * ramène à la liste de la rubrique, pas à l'accueil (fonction pure, testée dans not-found-back.test.ts). Seules les
 * sous-pages d'une rubrique y renvoient (« /campaigns/abc » → « Retour aux campagnes ») ; la rubrique elle-même, ou
 * une adresse inconnue, renvoie à l'accueil (pas de boucle).
 */

export type NotFoundBack = { href: string; label: string };

/** Rubriques, de la plus précise à la plus générale. */
const SECTIONS: ReadonlyArray<NotFoundBack> = [
  { href: "/campaigns/links", label: "Retour à tous les liens" },
  { href: "/campaigns", label: "Retour aux campagnes" },
  { href: "/channels", label: "Retour aux canaux" },
  { href: "/messages", label: "Retour aux messages" },
  { href: "/members/broadcasts", label: "Retour à « Écrire à un groupe »" },
  { href: "/members/automations", label: "Retour aux relances automatiques" },
  { href: "/members", label: "Retour aux membres" },
  { href: "/stats", label: "Retour aux statistiques" },
  { href: "/settings", label: "Retour aux réglages" },
];

export const NOT_FOUND_HOME: NotFoundBack = { href: "/", label: "Retour à l'accueil" };

export function notFoundBack(pathname: string | null | undefined): NotFoundBack {
  const path = (pathname ?? "/").split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return SECTIONS.find((s) => path.startsWith(`${s.href}/`)) ?? NOT_FOUND_HOME;
}
