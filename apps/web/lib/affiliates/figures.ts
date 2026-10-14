/**
 * Chiffres de la vue « Affiliés Link Affi » (phase 13), par campagne Telegram d'affilié puis par affilié : fonctions
 * pures sur des lignes déjà lues en base (lib/affiliates/queries.ts), testées dans figures.test.ts.
 *
 * Définitions (affichées telles quelles dans la vue, l'export et le guide) :
 * - clics : comptés par Link Affi sur le lien de l'affilié, depuis le début de la campagne (synchro Link Affi ;
 *   null = pas encore connu, affiché « — ») ;
 * - demandes, acceptés, partis : demandes d'adhésion des membres rattachés à la campagne, dans le canal de la
 *   campagne, comptées à leur date (demande, acceptation, départ) dans la période ;
 * - présents : membres rattachés à la campagne, dans son canal en ce moment (quelle que soit la période) ;
 * - clics sur les offres : clics d'offre portant la clé de la campagne (paramètre `tg`), dans la période ;
 * - inscriptions, premiers dépôts : nos joueurs de la campagne (clic portant la clé, ou membre rattaché) aux dates
 *   Link Affi (`registeredAt`, `ftdAt`) dans la période ; liste des premiers dépôts ;
 * - dépôts (nombre et montant) et revenu net : événements datés de ces joueurs dans la période (jamais le cumul).
 */
import {
  affiliateLabel,
  linksByKey,
  playerCampaignKey,
  resolveCampaignLink,
  UNKNOWN_AFFILIATE,
  type AffiliateCampaignRef,
} from "./scope";

export type AffiliateFigures = {
  /** Clics comptés par Link Affi depuis le début (null : inconnu). */
  clicks: number | null;
  requests: number;
  approved: number;
  present: number;
  left: number;
  offerClicks: number;
  registrations: number;
  ftds: number;
  /** Nombre de dépôts (premier dépôt compris) dans la période. */
  deposits: number;
  depositAmount: number;
  /** Revenu net (somme des variations datées dans la période). */
  revenue: number;
};

/** Un premier dépôt de la liste dépliable. */
export type FtdItem = {
  playerId: string;
  memberId: string | null;
  memberName: string;
  ftdAt: Date;
  amount: number | null;
  offerName: string;
};

export type CampaignView = {
  ref: AffiliateCampaignRef;
  figures: AffiliateFigures;
  ftdList: FtdItem[];
};

export type AffiliateView = {
  /** Identifiant Link Affi de l'affilié (`UNKNOWN_AFFILIATE` : lien sans affilié). */
  id: string;
  name: string;
  figures: AffiliateFigures;
  campaigns: CampaignView[];
};

export function emptyFigures(clicks: number | null = null): AffiliateFigures {
  return {
    clicks,
    requests: 0,
    approved: 0,
    present: 0,
    left: 0,
    offerClicks: 0,
    registrations: 0,
    ftds: 0,
    deposits: 0,
    depositAmount: 0,
    revenue: 0,
  };
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

/** Somme de deux chiffres « clics » : inconnu seulement si les deux le sont. */
function addNullable(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/** Somme de chiffres (totaux d'un affilié, de la page). */
export function sumFigures(list: readonly AffiliateFigures[]): AffiliateFigures {
  const out = emptyFigures(null);
  for (const f of list) {
    out.clicks = addNullable(out.clicks, f.clicks);
    out.requests += f.requests;
    out.approved += f.approved;
    out.present += f.present;
    out.left += f.left;
    out.offerClicks += f.offerClicks;
    out.registrations += f.registrations;
    out.ftds += f.ftds;
    out.deposits += f.deposits;
    out.depositAmount = round2(out.depositAmount + f.depositAmount);
    out.revenue = round2(out.revenue + f.revenue);
  }
  return out;
}

type Within = { start: Date; end: Date };
const inside = (d: Date | null | undefined, w: Within): d is Date =>
  !!d && d.getTime() >= w.start.getTime() && d.getTime() < w.end.getTime();

/** Membre vu par la vue : clé de campagne et lien d'attribution. */
type MemberRef = { linkaffiCampaignKey: string | null; affiliateInviteLinkId: string | null };

export type FigureRows = {
  /** Campagnes connues (liens LINKAFFI), avec le titre de leur canal. */
  campaigns: readonly AffiliateCampaignRef[];
  /** Demandes des membres rattachés, avec au moins une date (demande, acceptation, départ) dans la période. */
  memberships: ReadonlyArray<{
    channelId: string;
    requestedAt: Date;
    approvedAt: Date | null;
    leftAt: Date | null;
    member: MemberRef;
  }>;
  /** Demandes en cours d'effet (membres rattachés présents dans un canal, `APPROVED`). */
  present: ReadonlyArray<{ channelId: string; memberId: string; member: MemberRef }>;
  /** Clics d'offre portant une clé de campagne, dans la période. */
  offerClicks: ReadonlyArray<{
    linkaffiTelegramCampaignKey: string | null;
    createdAt: Date;
    member: MemberRef | null;
  }>;
  /** Nos joueurs des affiliés (clic portant une clé, ou membre rattaché), toutes dates. */
  players: ReadonlyArray<{
    id: string;
    memberId: string | null;
    memberName: string;
    offerName: string;
    registeredAt: Date | null;
    ftdAt: Date | null;
    ftdAmount: number | null;
    click: { linkaffiTelegramCampaignKey: string | null } | null;
    member: MemberRef | null;
  }>;
  /** Événements datés de ces joueurs dans la période (FTD, DEPOSIT, REDEPOSIT, NGR). */
  playerEvents: ReadonlyArray<{
    playerId: string;
    type: string;
    amount: number | null;
    occurredAt: Date;
  }>;
  /** Clics Link Affi par clé de campagne (synchro ; absente : inconnu). */
  clicks: Readonly<Record<string, number | null>>;
};

/** Demande ou présence d'un membre → la campagne de sa clé dans ce canal (sinon, rien). */
function campaignInChannel(
  byKey: ReadonlyMap<string, readonly AffiliateCampaignRef[]>,
  member: MemberRef,
  channelId: string,
): AffiliateCampaignRef | null {
  const key = member.linkaffiCampaignKey;
  if (!key) return null;
  return byKey.get(key)?.find((l) => l.channelId === channelId) ?? null;
}

/**
 * Chiffres par campagne puis par affilié. `channelId` : seulement les campagnes de ce canal. Les campagnes sans aucun
 * chiffre restent affichées (une campagne qui vient d'être créée doit apparaître).
 */
export function computeAffiliateViews(
  rows: FigureRows,
  within: Within,
  opts: { channelId?: string | null; affiliateId?: string | null } = {},
): { affiliates: AffiliateView[]; totals: AffiliateFigures } {
  const byKey = linksByKey(rows.campaigns);
  const known = new Set(byKey.keys());
  const figures = new Map<string, AffiliateFigures>();
  const ftdLists = new Map<string, FtdItem[]>();
  for (const c of rows.campaigns) {
    // Clics Link Affi : comptés par clé ; une clé sur deux canaux les donne à son premier lien seulement.
    const first = byKey.get(c.campaignKey)?.[0];
    const clicks =
      first?.inviteLinkId === c.inviteLinkId ? (rows.clicks[c.campaignKey] ?? null) : null;
    figures.set(c.inviteLinkId, emptyFigures(clicks));
    ftdLists.set(c.inviteLinkId, []);
  }
  const fig = (ref: AffiliateCampaignRef | null) =>
    ref ? figures.get(ref.inviteLinkId) : undefined;

  for (const m of rows.memberships) {
    const f = fig(campaignInChannel(byKey, m.member, m.channelId));
    if (!f) continue;
    if (inside(m.requestedAt, within)) f.requests++;
    if (inside(m.approvedAt, within)) f.approved++;
    if (inside(m.leftAt, within)) f.left++;
  }
  // Une personne présente compte une fois par campagne, même avec deux demandes acceptées.
  const presentSeen = new Set<string>();
  for (const p of rows.present) {
    const ref = campaignInChannel(byKey, p.member, p.channelId);
    const f = fig(ref);
    if (!f || !ref) continue;
    const k = `${ref.inviteLinkId}:${p.memberId}`;
    if (presentSeen.has(k)) continue;
    presentSeen.add(k);
    f.present++;
  }
  for (const c of rows.offerClicks) {
    if (!inside(c.createdAt, within)) continue;
    const key = c.linkaffiTelegramCampaignKey;
    if (!key || !known.has(key)) continue;
    const preferred = c.member?.linkaffiCampaignKey === key ? c.member.affiliateInviteLinkId : null;
    const f = fig(resolveCampaignLink(byKey, key, preferred));
    if (f) f.offerClicks++;
  }
  const playerLink = new Map<string, string>();
  for (const p of rows.players) {
    const key = playerCampaignKey(p, known);
    if (!key) continue;
    const preferred = p.member?.linkaffiCampaignKey === key ? p.member.affiliateInviteLinkId : null;
    const ref = resolveCampaignLink(byKey, key, preferred);
    const f = fig(ref);
    if (!f || !ref) continue;
    playerLink.set(p.id, ref.inviteLinkId);
    if (inside(p.registeredAt, within)) f.registrations++;
    if (inside(p.ftdAt, within)) {
      f.ftds++;
      ftdLists.get(ref.inviteLinkId)!.push({
        playerId: p.id,
        memberId: p.memberId,
        memberName: p.memberName,
        ftdAt: p.ftdAt,
        amount: p.ftdAmount,
        offerName: p.offerName,
      });
    }
  }
  for (const e of rows.playerEvents) {
    if (!inside(e.occurredAt, within)) continue;
    const linkId = playerLink.get(e.playerId);
    const f = linkId ? figures.get(linkId) : undefined;
    if (!f) continue;
    const amount = e.amount ?? 0;
    if (e.type === "FTD" || e.type === "DEPOSIT" || e.type === "REDEPOSIT") {
      f.deposits++;
      f.depositAmount = round2(f.depositAmount + amount);
    } else if (e.type === "NGR") f.revenue = round2(f.revenue + amount);
  }

  const shown = rows.campaigns.filter(
    (c) =>
      (!opts.channelId || c.channelId === opts.channelId) &&
      (!opts.affiliateId || (c.affiliateId ?? UNKNOWN_AFFILIATE) === opts.affiliateId),
  );
  const groups = new Map<string, CampaignView[]>();
  for (const c of shown) {
    const id = c.affiliateId ?? UNKNOWN_AFFILIATE;
    const list = groups.get(id) ?? [];
    list.push({
      ref: c,
      figures: figures.get(c.inviteLinkId)!,
      ftdList: ftdLists.get(c.inviteLinkId)!.sort((a, b) => b.ftdAt.getTime() - a.ftdAt.getTime()),
    });
    groups.set(id, list);
  }
  const affiliates: AffiliateView[] = [...groups.entries()].map(([id, campaigns]) => {
    // Nom le plus récent connu de l'affilié (ses campagnes, de la plus récente à la plus ancienne).
    const latest = [...campaigns]
      .sort((a, b) => b.ref.createdAt.getTime() - a.ref.createdAt.getTime())
      .find((c) => (c.ref.affiliateName ?? "").trim());
    return {
      id,
      name: affiliateLabel(id || null, latest?.ref.affiliateName ?? null),
      figures: sumFigures(campaigns.map((c) => c.figures)),
      campaigns: campaigns.sort(
        (a, b) =>
          Number(b.ref.isActive) - Number(a.ref.isActive) ||
          (a.ref.campaignName ?? a.ref.campaignKey).localeCompare(
            b.ref.campaignName ?? b.ref.campaignKey,
            "fr",
          ),
      ),
    };
  });
  affiliates.sort(
    (a, b) =>
      Number(a.id === UNKNOWN_AFFILIATE) - Number(b.id === UNKNOWN_AFFILIATE) ||
      a.name.localeCompare(b.name, "fr"),
  );
  return { affiliates, totals: sumFigures(affiliates.map((a) => a.figures)) };
}
