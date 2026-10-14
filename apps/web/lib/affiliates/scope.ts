/**
 * Affiliés Link Affi sur nos canaux (phase 13, contrat docs/LINKAFFI-PARTENAIRES.md) : règles pures partagées par la
 * vue « Affiliés Link Affi » (/campaigns/affiliates), les filtres « Affilié » (Membres, Statistiques), la fiche membre
 * et les exceptions de règles. Testées dans scope.test.ts, sans base.
 *
 * - Une campagne Telegram d'affilié = un lien d'invitation LINKAFFI (clé de campagne + canal ; une même clé peut avoir
 *   un lien sur un autre canal).
 * - Les membres d'un affilié = les membres rattachés (`Member.linkaffiCampaignKey`, premier affilié gagne).
 * - Les joueurs d'un affilié = nos joueurs dont le clic d'offre porte la clé (`Click.linkaffiTelegramCampaignKey`,
 *   paramètre `tg`), ou dont le membre est rattaché à la campagne.
 */

/** Une campagne Telegram d'affilié, telle que la plateforme la connaît (lien LINKAFFI relu en base). */
export type AffiliateCampaignRef = {
  /** Identifiant du lien d'invitation LINKAFFI : c'est l'identité de la campagne dans nos écrans. */
  inviteLinkId: string;
  campaignKey: string;
  campaignName: string | null;
  affiliateId: string | null;
  affiliateName: string | null;
  channelId: string;
  channelTitle: string;
  isActive: boolean;
  /** Durée d'attribution en jours (null : à vie). */
  attributionDays: number | null;
  createdAt: Date;
};

/** Clé de regroupement d'un affilié sans identifiant (cas d'un ancien lien) : « affilié inconnu ». */
export const UNKNOWN_AFFILIATE = "";

/** Nom affiché d'un affilié : son nom Link Affi, sinon son identifiant, sinon « Affilié inconnu ». */
export function affiliateLabel(
  id: string | null | undefined,
  name: string | null | undefined,
): string {
  const n = (name ?? "").trim();
  if (n) return n;
  const i = (id ?? "").trim();
  return i ? `Affilié ${i}` : "Affilié inconnu";
}

/** Nom affiché d'une campagne Telegram d'affilié : son nom, sinon sa clé. */
export function campaignLabel(
  c: Pick<AffiliateCampaignRef, "campaignName" | "campaignKey">,
): string {
  return (c.campaignName ?? "").trim() || c.campaignKey;
}

/** Un affilié connu par ses campagnes : identifiant Link Affi, nom le plus récent, nombre de campagnes. */
export type AffiliateOption = { id: string; name: string; campaigns: number };

/**
 * Affiliés connus (filtres « Affilié », exception « un affilié précis ») : un par identifiant Link Affi, avec le nom de
 * sa campagne la plus récente (un affilié renommé dans Link Affi prend son nouveau nom), triés par nom.
 * Les liens sans identifiant d'affilié ne forment pas un choix (rien à filtrer).
 */
export function affiliateOptions(
  links: ReadonlyArray<Pick<AffiliateCampaignRef, "affiliateId" | "affiliateName" | "createdAt">>,
): AffiliateOption[] {
  const by = new Map<string, { name: string | null; at: number; campaigns: number }>();
  for (const l of links) {
    const id = (l.affiliateId ?? "").trim();
    if (!id) continue;
    const at = l.createdAt.getTime();
    const cur = by.get(id);
    if (!cur) by.set(id, { name: l.affiliateName, at, campaigns: 1 });
    else {
      cur.campaigns++;
      // Le nom le plus récent connu ; un nom vide ne remplace jamais un nom connu.
      if (at >= cur.at && (l.affiliateName ?? "").trim()) {
        cur.name = l.affiliateName;
        cur.at = at;
      }
    }
  }
  return [...by.entries()]
    .map(([id, v]) => ({ id, name: affiliateLabel(id, v.name), campaigns: v.campaigns }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id));
}

/** Noms des affiliés par identifiant (phrases des exceptions, filtres actifs). */
export function affiliateNameMap(options: readonly AffiliateOption[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.id, o.name]));
}

/**
 * Lien d'une campagne pour un clic ou un joueur : parmi les liens de cette clé, celui où le membre est rattaché
 * (`preferredLinkId` = `Member.affiliateInviteLinkId`), sinon le plus ancien. Null : clé inconnue.
 */
export function resolveCampaignLink(
  byKey: ReadonlyMap<string, readonly AffiliateCampaignRef[]>,
  key: string | null | undefined,
  preferredLinkId?: string | null,
): AffiliateCampaignRef | null {
  if (!key) return null;
  const links = byKey.get(key);
  if (!links || links.length === 0) return null;
  return (preferredLinkId && links.find((l) => l.inviteLinkId === preferredLinkId)) || links[0]!;
}

/** Liens regroupés par clé de campagne, du plus ancien au plus récent. */
export function linksByKey(
  links: readonly AffiliateCampaignRef[],
): Map<string, AffiliateCampaignRef[]> {
  const out = new Map<string, AffiliateCampaignRef[]>();
  for (const l of [...links].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const list = out.get(l.campaignKey) ?? [];
    list.push(l);
    out.set(l.campaignKey, list);
  }
  return out;
}

/**
 * Clé de campagne d'un joueur (ou d'un clic d'offre) : celle portée par son clic (paramètre `tg`, ce que Link Affi
 * crédite), sinon celle de son membre ; seulement une clé connue (`known`).
 */
export function playerCampaignKey(
  p: {
    click?: { linkaffiTelegramCampaignKey: string | null } | null;
    member?: { linkaffiCampaignKey: string | null } | null;
  },
  known: ReadonlySet<string>,
): string | null {
  const fromClick = p.click?.linkaffiTelegramCampaignKey ?? null;
  if (fromClick && known.has(fromClick)) return fromClick;
  const fromMember = p.member?.linkaffiCampaignKey ?? null;
  return fromMember && known.has(fromMember) ? fromMember : null;
}

/**
 * Joueurs d'un ou plusieurs affiliés (clause Prisma, sans dépendre de Prisma ici) : clic d'offre portant une de leurs
 * clés, ou membre rattaché à une de leurs clés. Liste vide : aucun joueur (jamais « tous »).
 */
export function affiliatePlayerWhere(keys: readonly string[]): Record<string, unknown> {
  if (keys.length === 0) return { id: { in: [] } };
  return {
    OR: [
      { click: { linkaffiTelegramCampaignKey: { in: [...keys] } } },
      { member: { linkaffiCampaignKey: { in: [...keys] } } },
    ],
  };
}

/**
 * Demandes d'adhésion des membres d'un affilié (clause Prisma) : pour chacune de ses campagnes, les membres rattachés à
 * cette campagne dans le canal de la campagne (même règle que la page des affiliés ; ailleurs, leurs demandes ne lui
 * reviennent pas : Link Affi ne reçoit que celles du canal de leur campagne). Aucune campagne : aucune demande.
 */
export function affiliateMembershipWhere(
  campaigns: ReadonlyArray<{ campaignKey: string; channelId: string }>,
): Record<string, unknown> {
  if (campaigns.length === 0) return { id: { in: [] } };
  return {
    OR: campaigns.map((c) => ({
      channelId: c.channelId,
      member: { linkaffiCampaignKey: c.campaignKey },
    })),
  };
}

/** Phrase de la fiche membre : « Amené par Paul · campagne Casino VIP · le 12 oct. 2026 ». */
export function broughtBySentence(input: {
  affiliateLabel: string;
  campaignLabel: string | null;
  attributedAtText: string | null;
}): string {
  const parts = [`Amené par ${input.affiliateLabel}`];
  if (input.campaignLabel) parts.push(`campagne ${input.campaignLabel}`);
  if (input.attributedAtText) parts.push(`le ${input.attributedAtText}`);
  return parts.join(" · ");
}

/** État de l'attribution d'un membre : en cours (à vie ou jusqu'à une date), terminée, ou aucune. */
export type AttributionState =
  | { kind: "none" }
  | { kind: "lifetime" }
  | { kind: "until"; endsAt: Date }
  | { kind: "ended"; endsAt: Date };

export function attributionState(
  m: { linkaffiCampaignKey: string | null; affiliateAttributionEndsAt: Date | null },
  now: Date,
): AttributionState {
  if (!m.linkaffiCampaignKey) return { kind: "none" };
  const end = m.affiliateAttributionEndsAt;
  if (!end) return { kind: "lifetime" };
  return end.getTime() > now.getTime()
    ? { kind: "until", endsAt: end }
    : { kind: "ended", endsAt: end };
}
