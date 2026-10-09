/**
 * Segments de membres pour les envois groupés. Fonctions pures : construisent un objet `where`
 * au format Prisma (typé en `unknown` pour rester indépendant du client), utilisé par le site et le worker.
 */
import type { SpendLevel } from "./spend-level";

export type Segment = {
  /** Membres ayant une adhésion (quel que soit le statut sauf filtre) sur ces canaux. */
  channelIds?: string[];
  /** Statuts d'adhésion acceptés (ex. APPROVED). */
  membershipStatuses?: string[];
  /** Niveaux de dépense (filtrés après requête). */
  spendLevels?: SpendLevel[];
  /** Arrivés par ces liens d'entrée. */
  inviteLinkIds?: string[];
  /** Arrivés par les liens de ces pubs. */
  campaignIds?: string[];
  /** Codes de langue (préfixes : fr, en…). */
  languages?: string[];
  /** Pas d'activité (lastSeenAt) depuis N jours. */
  inactiveDays?: number;
  /** A cliqué un bouton d'un message de ces catégories. */
  clickedCategoryIds?: string[];
  /** Étiquettes (Member.tags) : au moins une. */
  tags?: string[];
};

const SEGMENT_KEYS: Array<keyof Segment> = ["channelIds", "membershipStatuses", "spendLevels", "inviteLinkIds", "campaignIds", "languages", "inactiveDays", "clickedCategoryIds", "tags"];

function cleanList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  return out.length > 0 ? out : undefined;
}

/** Lit un segment depuis une valeur JSON quelconque (ignore ce qui est invalide). */
export function parseSegment(value: unknown): Segment {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const s: Segment = {};
  for (const k of SEGMENT_KEYS) {
    if (k === "inactiveDays") {
      const n = Number(v[k]);
      if (Number.isFinite(n) && n > 0) s.inactiveDays = Math.floor(n);
    } else {
      const list = cleanList(v[k]);
      if (list) (s as Record<string, unknown>)[k] = list;
    }
  }
  return s;
}

export function isEmptySegment(s: Segment): boolean {
  return SEGMENT_KEYS.every((k) => s[k] === undefined);
}

/**
 * Construit le `where` Prisma (MemberWhereInput) pour la partie exprimable en base.
 * Le niveau de dépense n'est pas inclus : voir `matchesSpendLevels`.
 * Exclut toujours les membres anonymisés.
 */
export function buildMemberWhere(segment: Segment, now: Date = new Date()): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ anonymizedAt: null }];
  if (segment.channelIds || segment.membershipStatuses || segment.inviteLinkIds || segment.campaignIds) {
    const some: Record<string, unknown> = {};
    if (segment.channelIds) some.channelId = { in: segment.channelIds };
    if (segment.membershipStatuses) some.status = { in: segment.membershipStatuses };
    if (segment.inviteLinkIds) some.inviteLinkId = { in: segment.inviteLinkIds };
    if (segment.campaignIds) some.inviteLink = { campaignId: { in: segment.campaignIds } };
    and.push({ memberships: { some } });
  }
  if (segment.languages) {
    and.push({ OR: segment.languages.map((l) => ({ languageCode: { startsWith: l.toLowerCase() } })) });
  }
  if (segment.inactiveDays) {
    and.push({ lastSeenAt: { lt: new Date(now.getTime() - segment.inactiveDays * 86_400_000) } });
  }
  if (segment.clickedCategoryIds) {
    and.push({ clicks: { some: { post: { categoryId: { in: segment.clickedCategoryIds } } } } });
  }
  if (segment.tags) {
    and.push({ OR: segment.tags.map((t) => ({ tags: { array_contains: [t] } })) });
  }
  return and.length === 1 ? and[0]! : { AND: and };
}

/** Ajoute la condition « joignable en privé par ce bot ». */
export function withReachableBy(where: Record<string, unknown>, botId: string): Record<string, unknown> {
  return { AND: [where, { botStates: { some: { botId, canDm: true } } }] };
}

/** Vrai si le niveau calculé du membre fait partie des niveaux demandés (ou si aucun niveau n'est demandé). */
export function matchesSpendLevels(level: SpendLevel, segment: Segment): boolean {
  return !segment.spendLevels || segment.spendLevels.includes(level);
}

/** Résumé lisible d'un segment (français). */
export function describeSegment(s: Segment, labels: { channels?: Record<string, string>; inviteLinks?: Record<string, string>; campaigns?: Record<string, string>; categories?: Record<string, string> } = {}): string {
  const parts: string[] = [];
  const names = (ids: string[], map?: Record<string, string>) => ids.map((id) => map?.[id] ?? id).join(", ");
  if (s.channelIds) parts.push(`canaux : ${names(s.channelIds, labels.channels)}`);
  if (s.membershipStatuses) parts.push(`statuts : ${s.membershipStatuses.join(", ")}`);
  if (s.spendLevels) parts.push(`niveaux : ${s.spendLevels.join(", ")}`);
  if (s.inviteLinkIds) parts.push(`liens : ${names(s.inviteLinkIds, labels.inviteLinks)}`);
  if (s.campaignIds) parts.push(`pubs : ${names(s.campaignIds, labels.campaigns)}`);
  if (s.languages) parts.push(`langues : ${s.languages.join(", ")}`);
  if (s.inactiveDays) parts.push(`inactifs depuis ${s.inactiveDays} j`);
  if (s.clickedCategoryIds) parts.push(`a cliqué : ${names(s.clickedCategoryIds, labels.categories)}`);
  if (s.tags) parts.push(`étiquettes : ${s.tags.join(", ")}`);
  return parts.length ? parts.join(" · ") : "tous les membres joignables";
}
