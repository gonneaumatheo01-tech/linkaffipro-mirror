/**
 * Rattachement des membres et des joueurs à une campagne (règles pures, partagées par la fiche, la liste et les filtres).
 *
 * Une campagne « possède » :
 * - des liens d'entrée (InviteLink + TrackingLink goolink) → les membres arrivés par ces liens ;
 * - des campagnes Link Affi (offres) → les joueurs de ces campagnes, même sans clic retrouvé ;
 * - des liens traqués rattachés (TrackingLink.campaignId) → les clics et joueurs issus de ces liens.
 *
 * Un joueur appartient à la campagne s'il remplit AU MOINS une condition :
 *   1. son clic vient d'un lien traqué de la campagne ;
 *   2. il est relié à un membre arrivé par un lien d'entrée de la campagne ;
 *   3. sa campagne Link Affi fait partie des offres de la campagne.
 */

export type CampaignScope = {
  channelIds: string[];
  inviteLinkIds: string[];
  trackingLinkIds: string[];
  affiliateCampaignIds: string[];
};

export type PlayerLike = {
  affiliateCampaignId: string;
  memberId?: string | null;
  click?: { trackingLinkId: string } | null;
};

/** Vrai si le joueur se rattache à la campagne (voir en-tête). `memberIds` = membres arrivés par ses liens d'entrée. */
export function isCampaignPlayer(player: PlayerLike, scope: Pick<CampaignScope, "trackingLinkIds" | "affiliateCampaignIds">, memberIds: ReadonlySet<string> | string[]): boolean {
  const members = memberIds instanceof Set ? memberIds : new Set(memberIds);
  if (player.click && scope.trackingLinkIds.includes(player.click.trackingLinkId)) return true;
  if (player.memberId && members.has(player.memberId)) return true;
  return scope.affiliateCampaignIds.includes(player.affiliateCampaignId);
}

/** Ne garde que les joueurs rattachés à la campagne. */
export function attributePlayers<T extends PlayerLike>(players: T[], scope: Pick<CampaignScope, "trackingLinkIds" | "affiliateCampaignIds">, memberIds: ReadonlySet<string> | string[]): T[] {
  const members = memberIds instanceof Set ? memberIds : new Set(memberIds);
  return players.filter((p) => isCampaignPlayer(p, scope, members));
}

type Where = Record<string, unknown>;

/** Condition Prisma « membre arrivé par un lien d'entrée de la campagne » (MemberWhereInput). */
export function campaignMemberWhere(scope: Pick<CampaignScope, "inviteLinkIds">): Where {
  if (scope.inviteLinkIds.length === 0) return { id: { in: [] } };
  return { memberships: { some: { inviteLinkId: { in: scope.inviteLinkIds } } } };
}

/**
 * Condition Prisma « joueur de la campagne » (PlayerWhereInput), sans charger la liste des membres :
 * clic sur un lien de la campagne OU membre arrivé par un lien d'entrée OU campagne Link Affi rattachée.
 */
export function campaignPlayerWhere(scope: CampaignScope): Where {
  const or: Where[] = [];
  if (scope.trackingLinkIds.length) or.push({ click: { trackingLinkId: { in: scope.trackingLinkIds } } });
  if (scope.inviteLinkIds.length) or.push({ member: campaignMemberWhere(scope) });
  if (scope.affiliateCampaignIds.length) or.push({ affiliateCampaignId: { in: scope.affiliateCampaignIds } });
  return or.length ? { OR: or } : { id: { in: [] } };
}

/**
 * Condition Prisma « clic d'offre de la campagne » (ClickWhereInput) : clic avec sub-ID sur un lien de la campagne,
 * sur un lien pointant vers une de ses offres, ou fait par un de ses membres.
 */
export function campaignOfferClickWhere(scope: CampaignScope): Where {
  const or: Where[] = [];
  if (scope.trackingLinkIds.length) or.push({ trackingLinkId: { in: scope.trackingLinkIds } });
  if (scope.affiliateCampaignIds.length) or.push({ trackingLink: { affiliateCampaignId: { in: scope.affiliateCampaignIds } } });
  if (scope.inviteLinkIds.length) or.push({ member: campaignMemberWhere(scope) });
  return { isBot: false, subId: { not: null }, ...(or.length ? { OR: or } : { id: { in: [] } }) };
}

/**
 * Condition Prisma « message de la campagne » (PostWhereInput) : message d'un de ses canaux, ou portant un bouton
 * Offre vers une de ses offres, ou un lien traqué rattaché à la campagne.
 */
export function campaignPostWhere(campaignId: string, scope: Pick<CampaignScope, "channelIds" | "affiliateCampaignIds">): Where {
  const or: Where[] = [{ trackingLinks: { some: { campaignId } } }];
  if (scope.channelIds.length) or.push({ channelId: { in: scope.channelIds } });
  if (scope.affiliateCampaignIds.length) or.push({ trackingLinks: { some: { affiliateCampaignId: { in: scope.affiliateCampaignIds } } } });
  return { OR: or };
}

/**
 * Condition Prisma « envoi groupé lié à la campagne » (BroadcastWhereInput) : le segment vise explicitement la
 * campagne (`campaignIds`) ou un de ses canaux (`channelIds`).
 */
export function campaignBroadcastWhere(campaignId: string, scope: Pick<CampaignScope, "channelIds">): Where {
  const or: Where[] = [{ segment: { path: ["campaignIds"], array_contains: [campaignId] } }];
  for (const channelId of scope.channelIds) or.push({ segment: { path: ["channelIds"], array_contains: [channelId] } });
  return { OR: or };
}

/** Lit un tableau d'identifiants dans une colonne Json (`Campaign.channelIds`, `Campaign.affiliateCampaignIds`). */
export function jsonIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/**
 * Périmètre d'une campagne à partir de ses relations chargées : liens rattachés directement
 * (InviteLink.campaignId, TrackingLink.campaignId) et liens des pubs précises (Ad.inviteLinkId / trackingLinkId).
 */
export function scopeFromCampaign(c: {
  channelIds: unknown;
  affiliateCampaignIds: unknown;
  inviteLinks: Array<{ id: string }>;
  trackingLinks: Array<{ id: string }>;
  adSets: Array<{ ads: Array<{ inviteLinkId: string | null; trackingLinkId: string | null }> }>;
}): CampaignScope {
  const inviteLinkIds = new Set(c.inviteLinks.map((l) => l.id));
  const trackingLinkIds = new Set(c.trackingLinks.map((l) => l.id));
  for (const s of c.adSets)
    for (const a of s.ads) {
      if (a.inviteLinkId) inviteLinkIds.add(a.inviteLinkId);
      if (a.trackingLinkId) trackingLinkIds.add(a.trackingLinkId);
    }
  return { channelIds: jsonIds(c.channelIds), inviteLinkIds: [...inviteLinkIds], trackingLinkIds: [...trackingLinkIds], affiliateCampaignIds: jsonIds(c.affiliateCampaignIds) };
}
