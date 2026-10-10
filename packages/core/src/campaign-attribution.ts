/**
 * Rattachement des membres, des clics et des joueurs à une campagne (la nôtre) : règles pures, partagées par le site
 * (fiche et liste des campagnes, tableau de bord, filtres) et par le worker (statistiques journalières, alertes).
 *
 * Une campagne « possède » :
 * - des liens d'entrée (InviteLink + TrackingLink goolink) → les membres arrivés par ces liens ;
 * - des campagnes Link Affi (offres) → les joueurs de ces offres qu'aucun clic ne rattache ailleurs ;
 * - des liens traqués rattachés (TrackingLink.campaignId, liens des pubs) → les clics et joueurs issus de ces liens.
 *
 * Un joueur appartient à la campagne s'il remplit AU MOINS une condition :
 *   1. son clic vient d'un lien traqué de la campagne ;
 *   2. il est relié à un membre arrivé par un lien d'entrée de la campagne ;
 *   3. son offre Link Affi fait partie des offres de la campagne ET il n'a aucun clic retrouvé (`clickId` vide) OU son
 *      clic vient d'un lien qui n'appartient à aucune campagne (ancien bouton Offre, `TrackingLink.campaignId` vide).
 * La règle 3 est la même que celle des clics (règle 3 ci-dessous) : un joueur est compté là où son clic est compté.
 * Quand deux campagnes partagent la même offre, un joueur venu par le lien de l'une n'est jamais compté dans l'autre.
 * Un joueur sans clic (ou venu d'un ancien bouton sans campagne) d'une offre partagée compte dans chacune (rien ne
 * permet de trancher) : c'est pourquoi un total « toutes campagnes » se calcule sur les joueurs distincts.
 *
 * Un clic d'offre (avec sub-ID, hors robots) appartient à la campagne si :
 *   1. son lien traqué est un lien de la campagne ;
 *   2. il est fait par un membre arrivé par un lien d'entrée de la campagne ;
 *   3. son lien n'appartient à aucune campagne (`TrackingLink.campaignId` vide) et pointe vers une offre de la campagne.
 */

export type CampaignScope = {
  channelIds: string[];
  inviteLinkIds: string[];
  trackingLinkIds: string[];
  affiliateCampaignIds: string[];
};

export type PlayerLike = {
  affiliateCampaignId: string;
  /** Clic retrouvé (sub-ID → `Click`) ; à défaut, la présence de `click` fait foi. */
  clickId?: string | null;
  memberId?: string | null;
  /**
   * Clic du joueur ; `trackingLink.campaignId` = campagne du lien cliqué (vide pour un ancien bouton Offre).
   * Sans `trackingLink` chargé, le lien est supposé appartenir à une campagne (pas de rattachement par l'offre).
   */
  click?: { trackingLinkId: string; trackingLink?: { campaignId: string | null } | null } | null;
};

/** Vrai si le joueur a un clic retrouvé chez nous. */
function hasClick(player: Pick<PlayerLike, "clickId" | "click">): boolean {
  return Boolean(player.clickId ?? player.click);
}

/** Vrai si le rattachement par l'offre vaut : aucun clic, ou clic sur un lien sans campagne (ancien bouton Offre). */
function offerRuleApplies(player: Pick<PlayerLike, "clickId" | "click">): boolean {
  if (!hasClick(player)) return true;
  return player.click?.trackingLink != null && player.click.trackingLink.campaignId === null;
}

/** Vrai si le joueur se rattache à la campagne (voir en-tête). `memberIds` = membres arrivés par ses liens d'entrée. */
export function isCampaignPlayer(
  player: PlayerLike,
  scope: Pick<CampaignScope, "trackingLinkIds" | "affiliateCampaignIds">,
  memberIds: ReadonlySet<string> | string[],
): boolean {
  const members = memberIds instanceof Set ? memberIds : new Set(memberIds);
  if (player.click && scope.trackingLinkIds.includes(player.click.trackingLinkId)) return true;
  if (player.memberId && members.has(player.memberId)) return true;
  return (
    offerRuleApplies(player) && scope.affiliateCampaignIds.includes(player.affiliateCampaignId)
  );
}

/** Ne garde que les joueurs rattachés à la campagne. */
export function attributePlayers<T extends PlayerLike>(
  players: T[],
  scope: Pick<CampaignScope, "trackingLinkIds" | "affiliateCampaignIds">,
  memberIds: ReadonlySet<string> | string[],
): T[] {
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
 * clic sur un lien de la campagne OU membre arrivé par un lien d'entrée OU offre Link Affi rattachée (sans clic, ou
 * clic sur un lien sans campagne : même règle que `campaignOfferClickWhere`).
 */
export function campaignPlayerWhere(scope: CampaignScope): Where {
  const or: Where[] = [];
  if (scope.trackingLinkIds.length)
    or.push({ click: { trackingLinkId: { in: scope.trackingLinkIds } } });
  if (scope.inviteLinkIds.length) or.push({ member: campaignMemberWhere(scope) });
  if (scope.affiliateCampaignIds.length)
    or.push({
      affiliateCampaignId: { in: scope.affiliateCampaignIds },
      OR: [{ clickId: null }, { click: { trackingLink: { campaignId: null } } }],
    });
  return or.length ? { OR: or } : { id: { in: [] } };
}

/**
 * Condition Prisma « clic d'offre de la campagne » (ClickWhereInput) : clic avec sub-ID sur un lien de la campagne,
 * fait par un de ses membres, ou sur un bouton sans campagne pointant vers une de ses offres.
 */
export function campaignOfferClickWhere(scope: CampaignScope): Where {
  const or: Where[] = [];
  if (scope.trackingLinkIds.length) or.push({ trackingLinkId: { in: scope.trackingLinkIds } });
  if (scope.affiliateCampaignIds.length)
    or.push({
      trackingLink: { campaignId: null, affiliateCampaignId: { in: scope.affiliateCampaignIds } },
    });
  if (scope.inviteLinkIds.length) or.push({ member: campaignMemberWhere(scope) });
  return { isBot: false, subId: { not: null }, ...(or.length ? { OR: or } : { id: { in: [] } }) };
}

/**
 * Condition Prisma « message de la campagne » (PostWhereInput) : message d'un de ses canaux, ou portant un bouton
 * Offre vers une de ses offres, ou un lien traqué rattaché à la campagne.
 */
export function campaignPostWhere(
  campaignId: string,
  scope: Pick<CampaignScope, "channelIds" | "affiliateCampaignIds">,
): Where {
  const or: Where[] = [{ trackingLinks: { some: { campaignId } } }];
  if (scope.channelIds.length) or.push({ channelId: { in: scope.channelIds } });
  if (scope.affiliateCampaignIds.length)
    or.push({
      trackingLinks: { some: { affiliateCampaignId: { in: scope.affiliateCampaignIds } } },
    });
  return { OR: or };
}

/**
 * Condition Prisma « envoi groupé lié à la campagne » (BroadcastWhereInput) : le segment vise explicitement la
 * campagne (`campaignIds`) ou un de ses canaux (`channelIds`).
 */
export function campaignBroadcastWhere(
  campaignId: string,
  scope: Pick<CampaignScope, "channelIds">,
): Where {
  const or: Where[] = [{ segment: { path: ["campaignIds"], array_contains: [campaignId] } }];
  for (const channelId of scope.channelIds)
    or.push({ segment: { path: ["channelIds"], array_contains: [channelId] } });
  return { OR: or };
}

/** Lit un tableau d'identifiants dans une colonne Json (`Campaign.channelIds`, `Campaign.affiliateCampaignIds`). */
export function jsonIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string" && x !== "")
    : [];
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
  return {
    channelIds: jsonIds(c.channelIds),
    inviteLinkIds: [...inviteLinkIds],
    trackingLinkIds: [...trackingLinkIds],
    affiliateCampaignIds: jsonIds(c.affiliateCampaignIds),
  };
}

// ---------- Rattachement en mémoire (statistiques journalières du worker) ----------

/** Index des campagnes par lien d'entrée, lien traqué et offre Link Affi (pour classer des milliers de lignes sans requête). */
export type CampaignIndex = {
  byInvite: Map<string, string[]>;
  byTracking: Map<string, string[]>;
  byOffer: Map<string, string[]>;
  vertical: Map<string, string | null>;
};

function push(map: Map<string, string[]>, key: string, id: string): void {
  const list = map.get(key);
  if (!list) map.set(key, [id]);
  else if (!list.includes(id)) list.push(id);
}

/** Construit l'index à partir des périmètres de toutes nos campagnes (ordre conservé : celui de la liste fournie). */
export function buildCampaignIndex(
  campaigns: ReadonlyArray<{ id: string; vertical?: string | null; scope: CampaignScope }>,
): CampaignIndex {
  const index: CampaignIndex = {
    byInvite: new Map(),
    byTracking: new Map(),
    byOffer: new Map(),
    vertical: new Map(),
  };
  for (const c of campaigns) {
    index.vertical.set(c.id, c.vertical ?? null);
    for (const id of c.scope.inviteLinkIds) push(index.byInvite, id, c.id);
    for (const id of c.scope.trackingLinkIds) push(index.byTracking, id, c.id);
    for (const id of c.scope.affiliateCampaignIds) push(index.byOffer, id, c.id);
  }
  return index;
}

function collect(out: string[], ids: readonly string[] | undefined): void {
  for (const id of ids ?? []) if (!out.includes(id)) out.push(id);
}

/** Campagnes d'un membre : celles de ses liens d'entrée (toutes ses demandes d'adhésion). */
export function campaignsOfMember(
  index: CampaignIndex,
  memberInviteLinkIds: Iterable<string>,
): string[] {
  const out: string[] = [];
  for (const id of memberInviteLinkIds) collect(out, index.byInvite.get(id));
  return out;
}

/**
 * Campagnes d'un joueur, même règle que `campaignPlayerWhere` (clic, puis membre, puis offre si aucun clic ou si le
 * clic vient d'un lien sans campagne). `clickTrackingLinkCampaignId` = campagne du lien cliqué (`TrackingLink.campaignId`).
 * `memberInviteLinkIds` = liens d'entrée par lesquels son membre est arrivé (vide sans membre).
 */
export function campaignsOfPlayer(
  index: CampaignIndex,
  p: {
    affiliateCampaignId: string;
    clickId: string | null;
    clickTrackingLinkId: string | null;
    clickTrackingLinkCampaignId: string | null;
    memberInviteLinkIds: Iterable<string>;
  },
): string[] {
  const out: string[] = [];
  if (p.clickTrackingLinkId) collect(out, index.byTracking.get(p.clickTrackingLinkId));
  collect(out, campaignsOfMember(index, p.memberInviteLinkIds));
  if (!p.clickId || !p.clickTrackingLinkCampaignId)
    collect(out, index.byOffer.get(p.affiliateCampaignId));
  return out;
}

/** Campagnes d'un clic d'offre, même règle que `campaignOfferClickWhere` (lien, puis membre, puis offre d'un bouton sans campagne). */
export function campaignsOfOfferClick(
  index: CampaignIndex,
  c: {
    trackingLinkId: string;
    trackingLinkCampaignId: string | null;
    trackingLinkAffiliateCampaignId: string | null;
    memberInviteLinkIds: Iterable<string>;
  },
): string[] {
  const out: string[] = [];
  collect(out, index.byTracking.get(c.trackingLinkId));
  collect(out, campaignsOfMember(index, c.memberInviteLinkIds));
  if (!c.trackingLinkCampaignId && c.trackingLinkAffiliateCampaignId)
    collect(out, index.byOffer.get(c.trackingLinkAffiliateCampaignId));
  return out;
}
