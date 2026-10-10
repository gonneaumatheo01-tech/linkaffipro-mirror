/** Affichage de Mon compte (fonction pure, testée). */

/**
 * Le bouton orange de la page (un seul) : « Générer un lien » tant que Telegram n'est pas lié et qu'aucun lien n'a
 * encore été créé (c'est la chose à faire), sinon « Modifier le mot de passe ».
 */
export function accountPrimaryAction(s: {
  linked: boolean;
  activeBots: number;
  hasLinkToken: boolean;
}): "telegram" | "password" {
  return !s.linked && s.activeBots > 0 && !s.hasLinkToken ? "telegram" : "password";
}
