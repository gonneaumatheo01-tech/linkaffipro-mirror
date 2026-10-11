/**
 * Liens d'invitation dont Telegram masque la fin. Un bot qui reçoit une demande d'adhésion (ou une entrée) par un lien
 * créé par un AUTRE administrateur du canal ne voit que le début du lien : « la seconde partie du lien est remplacée
 * par “…” » (documentation de l'API Bot, ChatInviteLink.invite_link). On le retrouve alors par son début, son canal
 * et son créateur (`invite_link.creator.id`) ; jamais une provenance devinée : plusieurs liens possibles = lien inconnu.
 */

const ELLIPSIS = /(?:…|\.\.\.)$/u;
const INVITE_START = /^https?:\/\/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)/u;

/** Partie visible d'un lien masqué (« https://t.me/+AbCd… » → « https://t.me/+AbCd »), sinon null. */
export function maskedLinkPrefix(url: string): string | null {
  if (!ELLIPSIS.test(url)) return null;
  const prefix = url.replace(ELLIPSIS, "");
  return INVITE_START.test(prefix) ? prefix : null;
}

/**
 * Lien retenu parmi les liens de ce canal et de ce créateur qui commencent par la partie visible : le seul qui
 * correspond, sinon le seul encore actif, sinon aucun. Le début est revérifié ici (une recherche en base par début
 * d'adresse peut ramener trop large : « _ » et « % » y sont des jokers).
 */
export function pickMaskedLink<T extends { telegramInviteLink: string; isActive: boolean }>(
  prefix: string,
  candidates: readonly T[],
): T | null {
  const matching = candidates.filter((c) => c.telegramInviteLink.startsWith(prefix));
  if (matching.length === 1) return matching[0]!;
  const active = matching.filter((c) => c.isActive);
  return active.length === 1 ? active[0]! : null;
}
