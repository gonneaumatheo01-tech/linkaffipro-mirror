import type { MembershipStatus } from "@linkaffipro/db";

/**
 * Demandes et membres d'un canal (fiche canal, onglets « Demandes » et « Membres ») : règles d'affichage pures.
 */

/** Demandes encore en cours (listées dans l'onglet « Demandes », comptées dans son badge). */
export const OPEN_REQUEST_STATUSES = [
  "REQUESTED",
  "PENDING_GATE",
  "SCHEDULED",
  "FAILED",
] as const satisfies readonly MembershipStatus[];

/** Adhésions abouties (onglet « Membres ») ; « présents » = APPROVED. */
export const MEMBER_STATUSES = [
  "APPROVED",
  "LEFT",
  "KICKED",
] as const satisfies readonly MembershipStatus[];

/** Temps restant avant une acceptation programmée : « 45 s », « 10 min », « 3 h », « 2 j », « imminent ». */
export function remaining(approveAt: Date | null, now: Date): string {
  if (!approveAt) return "—";
  const s = Math.round((approveAt.getTime() - now.getTime()) / 1000);
  if (s <= 0) return "imminent";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} j`;
}

/**
 * Ce qui va se passer pour une demande en cours, en une phrase courte. La pastille d'état de la carte dit déjà où en
 * est la demande (« Attente canaux requis », « Échec »…) : la phrase dit la suite, sans la répéter.
 */
export function requestNext(status: MembershipStatus, approveAt: Date | null, now: Date): string {
  switch (status) {
    case "SCHEDULED": {
      const r = remaining(approveAt, now);
      return r === "imminent" ? "Acceptée dans un instant" : `Acceptée dans ${r}`;
    }
    case "PENDING_GATE":
      return "Acceptée toute seule une fois les canaux rejoints";
    case "REQUESTED":
      return "À valider à la main";
    case "FAILED":
      return "Réessayez « Accepter » ou refusez la demande";
    default:
      return "—";
  }
}

type SourceSnapshot = {
  inviteLink?: { name?: string; adPlatform?: string | null } | null;
  joinedDirectly?: boolean;
};

function isUntracked(source: unknown): boolean {
  const s = (source ?? {}) as SourceSnapshot;
  return !s.inviteLink?.name && !s.joinedDirectly;
}

/**
 * Origine d'une adhésion (instantané `Membership.source`) : nom du lien de pub, entrée directe, ou « Sans lien suivi »
 * quand la demande est passée par un lien d'invitation qui n'a pas été créé ici (« Lien inconnu » faisait croire à
 * une panne).
 */
export function sourceLabel(
  source: unknown,
  platformLabel: (platform: string) => string = (p) => p,
): string {
  const s = (source ?? {}) as SourceSnapshot;
  if (s.inviteLink?.name)
    return `${s.inviteLink.name}${s.inviteLink.adPlatform ? ` (${platformLabel(s.inviteLink.adPlatform)})` : ""}`;
  if (s.joinedDirectly) return "Entrée directe";
  return "Sans lien suivi";
}

/** Explication de « Sans lien suivi » pour le volet de détail ; null pour une origine connue. */
export function sourceHint(source: unknown): string | null {
  return isUntracked(source)
    ? "Demande faite par un lien d'invitation qui n'a pas été créé ici (lien principal du canal, lien d'un autre administrateur…) : on ne sait pas de quelle pub elle vient."
    : null;
}

/** En-tête de l'onglet Membres : « 65 membres présents · 12 partis · 1 exclu » (partis et exclus s'il y en a). */
export function membersSummary(c: { present: number; left: number; kicked: number }): string {
  const n = (v: number) => v.toLocaleString("fr-FR");
  const parts = [
    `${n(c.present)} ${c.present > 1 ? "membres présents" : "membre présent"}`,
    c.left > 0 ? `${n(c.left)} ${c.left > 1 ? "partis" : "parti"}` : null,
    c.kicked > 0 ? `${n(c.kicked)} ${c.kicked > 1 ? "exclus" : "exclu"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Nom affiché d'un membre : prénom et nom, sinon @nom, sinon « Membre sans nom ». */
export function memberName(m: {
  firstName: string | null;
  lastName: string | null;
  username?: string | null;
}): string {
  const full = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (m.username) return `@${m.username}`;
  return "Membre sans nom";
}

/**
 * Ligne sous le nom d'une demande : le @nom, seulement s'il apporte quelque chose (rien quand la personne n'a pas de
 * nom d'utilisateur, ou quand le nom affiché est déjà le @nom). Jamais l'identifiant Telegram brut (illisible pour
 * l'équipe ; il reste au survol de la carte).
 */
export function memberHandle(m: {
  firstName: string | null;
  lastName: string | null;
  username?: string | null;
}): string | null {
  const full = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  if (!full) return null;
  return m.username ? `@${m.username}` : null;
}

/**
 * « Membres suivis » : les adhésions que nos bots ont vues (demandes acceptées, entrées directes après l'ajout du
 * bot). Les abonnés entrés avant que nos bots gèrent le canal n'y sont pas : le chiffre n'est pas le nombre d'abonnés.
 */
export const TRACKED_MEMBERS_HELP =
  "Personnes entrées depuis qu'un de nos bots gère ce canal. Les abonnés plus anciens ne sont pas comptés.";

/** « 12 membres suivis », « 1 membre suivi », « 0 membre suivi ». */
export function trackedMembersLabel(count: number): string {
  return `${count.toLocaleString("fr-FR")} ${count > 1 ? "membres suivis" : "membre suivi"}`;
}

/** Libellé de l'onglet « Demandes » pour les lecteurs d'écran : « Demandes, 3 en attente ». */
export function requestsTabLabel(count: number): string {
  return count > 0 ? `Demandes, ${count} en attente` : "Demandes, aucune en attente";
}
