/**
 * Règles d'affichage de Réglages → Équipe (fonctions pures, testées). Les mêmes garde-fous sont vérifiés côté
 * serveur dans `actions.ts` : ici, on ne fait que montrer pourquoi un bouton est grisé.
 */

type TeamUser = { id: string; role: string; isActive: boolean };

/** Pourquoi le rôle ou l'état d'un compte ne peut pas changer : son propre compte, ou le dernier administrateur actif. */
export type AccountLock = "self" | "lastAdmin" | null;

export function accountLock(user: TeamUser, meId: string, activeAdmins: number): AccountLock {
  if (user.id === meId) return "self";
  if (user.role === "ADMIN" && user.isActive && activeAdmins <= 1) return "lastAdmin";
  return null;
}

/** Phrase affichée sous le rôle quand il ne peut pas changer. */
export function accountLockSentence(lock: AccountLock): string | null {
  if (lock === "self")
    return "C'est votre compte : un autre administrateur peut changer votre rôle.";
  if (lock === "lastAdmin")
    return "Dernier administrateur actif : son rôle ne peut pas être retiré ni son compte désactivé.";
  return null;
}

/** Une invitation vers une adresse qui a déjà un compte est une réinitialisation de mot de passe. */
export function invitationKind(email: string, knownEmails: ReadonlySet<string>): "reset" | "new" {
  return knownEmails.has(email) ? "reset" : "new";
}

export const INVITATION_KIND_LABELS = {
  reset: "Nouveau mot de passe",
  new: "Nouveau compte",
} as const;

/** Résumé sous le titre : « 3 comptes, dont 2 actifs ». */
export function teamSummary(users: ReadonlyArray<{ isActive: boolean }>): string {
  const total = users.length;
  const active = users.filter((u) => u.isActive).length;
  if (total === 0) return "Aucun compte";
  const comptes = `${total} compte${total > 1 ? "s" : ""}`;
  if (active === total) return total > 1 ? `${comptes}, tous actifs` : `${comptes}, actif`;
  return `${comptes}, dont ${active} actif${active > 1 ? "s" : ""}`;
}

/**
 * E-mail découpé avant le dernier « @ » : [« prenom.nom », « @gmail.com »]. La page insère une coupure possible
 * (`<wbr>`) entre les deux, pour qu'un téléphone passe à la ligne avant « @ » et jamais au milieu du domaine.
 * Sans « @ » utile : un seul morceau.
 */
export function emailBreakParts(email: string): [string] | [string, string] {
  const at = email.lastIndexOf("@");
  return at > 0 ? [email.slice(0, at), email.slice(at)] : [email];
}
