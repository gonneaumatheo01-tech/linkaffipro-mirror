/**
 * « L'essentiel d'abord » de la fiche membre (fonctions pures, testées) : d'où il vient, ce qu'il a fait, combien il a
 * déposé, et s'il peut recevoir un message privé d'un de nos bots. Aucun calcul nouveau : sommes des comptes joueurs
 * rattachés (comme avant sur la fiche) et comptages des adhésions, des clics d'offre et des états de bot.
 */
import type { PillTone } from "@/components/admin/status-pill";
import { platformShortLabel } from "@/lib/campaigns/cards";
import { frQuotes } from "@/lib/channels/exceptions";
import { languageName } from "./filters";

export type ProfileMembership = {
  status: string;
  requestedAt: Date;
  approvedAt?: Date | null;
  joinedAt?: Date | null;
  leftAt?: Date | null;
  channel: { id: string; title: string; vertical: string | null };
  inviteLink?: {
    name: string;
    adName: string | null;
    adPlatform: string | null;
    campaign: { id: string; name: string; vertical: string | null } | null;
    /** Offre Link Affi d'un lien goolink rattaché au lien d'entrée (si elle existe). */
    offerName?: string | null;
  } | null;
};

export type ProfilePlayer = {
  ftdAt: Date | null;
  ftdAmount: number | null;
  depositCount: number;
  depositTotal: number;
  ngr: number;
  offerName?: string | null;
};

export type ProfileBotState = {
  canDm: boolean;
  startedAt: Date | null;
  blockedAt: Date | null;
  bot: { username: string };
};

export type MemberProfileInput = {
  /** Adhésions, de la plus récente à la plus ancienne (ordre de la fiche). */
  memberships: ProfileMembership[];
  players: ProfilePlayer[];
  /** Clics d'offre hors robots (toutes dates). */
  offerClicks: number;
  botStates: ProfileBotState[];
  lastSeenAt: Date;
  /** Dernier événement d'un compte joueur (inscription, dépôt…), s'il est plus récent que l'activité Telegram. */
  lastPlayerEventAt?: Date | null;
};

export type MemberProfile = {
  origin: {
    at: Date;
    channelId: string;
    channelTitle: string;
    /** Univers à afficher : celui de la campagne, sinon celui du canal. */
    universe: string | null;
    campaign: { id: string; name: string } | null;
    adName: string | null;
    adPlatform: string | null;
    linkName: string | null;
    offerName: string | null;
  } | null;
  activity: {
    /** Demandes pour rejoindre un canal. */
    requests: number;
    /** Demandes acceptées ou entrées dans un canal. */
    entries: number;
    /** Canaux où il est encore (acceptés, pas partis). */
    currentChannels: number;
    offerClicks: number;
    lastActivityAt: Date;
  };
  money: {
    players: number;
    /** Comptes joueurs avec un premier dépôt. */
    ftdCount: number;
    firstFtdAt: Date | null;
    firstFtdAmount: number | null;
    depositCount: number;
    depositTotal: number;
    ngr: number;
  };
  reach: MemberReach;
};

export type MemberReach = {
  tone: PillTone;
  /** Phrase courte (« Joignable par le bot »). */
  label: string;
  /** Bots qui peuvent lui écrire en privé. */
  reachableBy: string[];
  /** Bots qu'il a bloqués. */
  blockedBy: string[];
};

/**
 * État d'un bot pour ce membre, même règle que le bot et le worker (`hasStartedBot` de `packages/telegram`, phase 14) :
 * joignable seulement s'il a démarré le bot (ou appuyé sur un de ses boutons) et ne l'a pas bloqué. Un accueil parti
 * dans les 5 minutes d'une demande ne rend pas joignable.
 */
export function botStateReach(
  s: Pick<ProfileBotState, "canDm" | "startedAt" | "blockedAt">,
): "reachable" | "blocked" | "none" {
  if (s.canDm && s.startedAt && !s.blockedAt) return "reachable";
  if (!s.canDm && s.blockedAt) return "blocked";
  return "none";
}

/** Le membre peut-il recevoir un message privé d'un de nos bots ? */
export function memberReach(states: ProfileBotState[]): MemberReach {
  const reachableBy = states
    .filter((s) => botStateReach(s) === "reachable")
    .map((s) => s.bot.username);
  const blockedBy = states.filter((s) => botStateReach(s) === "blocked").map((s) => s.bot.username);
  if (reachableBy.length > 0)
    return { tone: "success", label: "Joignable par le bot", reachableBy, blockedBy };
  if (blockedBy.length > 0)
    return { tone: "danger", label: "A bloqué le bot", reachableBy, blockedBy };
  return { tone: "muted", label: "Pas joignable en privé", reachableBy, blockedBy };
}

export function memberProfile(input: MemberProfileInput): MemberProfile {
  const first = input.memberships[input.memberships.length - 1];
  const ftds = input.players
    .filter((p): p is ProfilePlayer & { ftdAt: Date } => p.ftdAt !== null)
    .sort((a, b) => a.ftdAt.getTime() - b.ftdAt.getTime());
  const firstFtd = ftds[0] ?? null;
  const lastActivityAt =
    input.lastPlayerEventAt && input.lastPlayerEventAt > input.lastSeenAt
      ? input.lastPlayerEventAt
      : input.lastSeenAt;
  return {
    origin: first
      ? {
          at: first.requestedAt,
          channelId: first.channel.id,
          channelTitle: first.channel.title,
          universe: first.inviteLink?.campaign?.vertical ?? first.channel.vertical ?? null,
          campaign: first.inviteLink?.campaign
            ? { id: first.inviteLink.campaign.id, name: first.inviteLink.campaign.name }
            : null,
          adName: first.inviteLink?.adName ?? null,
          adPlatform: first.inviteLink?.adPlatform ?? null,
          linkName: first.inviteLink?.name ?? null,
          offerName: first.inviteLink?.offerName ?? input.players[0]?.offerName ?? null,
        }
      : null,
    activity: {
      requests: input.memberships.length,
      entries: input.memberships.filter((m) => m.joinedAt || m.approvedAt).length,
      currentChannels: new Set(
        input.memberships
          .filter((m) => m.status === "APPROVED" && !m.leftAt)
          .map((m) => m.channel.id),
      ).size,
      offerClicks: input.offerClicks,
      lastActivityAt,
    },
    money: {
      players: input.players.length,
      ftdCount: ftds.length,
      firstFtdAt: firstFtd?.ftdAt ?? null,
      firstFtdAmount: firstFtd?.ftdAmount ?? null,
      depositCount: input.players.reduce((s, p) => s + p.depositCount, 0),
      depositTotal: input.players.reduce((s, p) => s + p.depositTotal, 0),
      ngr: input.players.reduce((s, p) => s + p.ngr, 0),
    },
    reach: memberReach(input.botStates),
  };
}

/** Initiales d'un nom affiché (« Léa Martin » → « LM », « @lea_m » → « L », « #12345 » → « # »). */
export function initials(name: string): string {
  const words = name
    .replace(/^@/, "")
    .split(/[\s_.-]+/)
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => [...w][0] ?? "")
    .join("");
  return letters.toLocaleUpperCase("fr") || "?";
}

/** « 1 demande », « 3 demandes » ; « 0 clic ». */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? pluralForm : singular}`;
}

/** « @lea_m · Français » (vide si rien à dire). */
export function memberSubline(m: { username: string | null; languageCode: string | null }): string {
  return [m.username ? `@${m.username}` : null, languageName(m.languageCode) || null]
    .filter(Boolean)
    .join(" · ");
}

/** Pub d'origine en clair : « Vidéo bonus (TikTok) », sinon le nom du lien d'entrée ; null sans lien. */
export function adLabel(o: {
  adName: string | null;
  adPlatform: string | null;
  linkName: string | null;
}): string | null {
  const name = o.adName || o.linkName;
  if (!name) return null;
  const platform = platformShortLabel(o.adPlatform);
  return platform ? `${name} (${platform})` : name;
}

/** Pub d'un lien de page d'atterrissage (pub figée sur le lien, `InviteLink.landingAdId`), sa page et sa source. */
export type LandingOriginAd = {
  /** Nom de la pub figée sur le lien ; null : source sans pub (ou pub supprimée). */
  adName: string | null;
  adPlatform: string | null;
  /** Nom actuel de la page ; null : page supprimée. */
  pageName: string | null;
  /** Clé de la source (« tk01 ») ; "" : lien principal. */
  sourceKey: string | null;
};

/**
 * Case « Pub » de « D'où il vient » (fiche membre) : la pub du lien d'entrée ; aucune pub pour le lien d'une campagne
 * d'affilié Link Affi (phase 13). Lien d'une page d'atterrissage (phase 15) : la pub figée sur le lien (celle de la
 * source au moment où le lien a été créé), la même que celle qui compte sa demande dans les statistiques, avec la page
 * et la source (« Vidéo bonus (TikTok), par la page « Promo » (source « tk01 ») ») ; aucune pub pour une source sans
 * pub. Avec la raison quand il n'y a pas de pub.
 */
export function originAdFact(
  kind: string | null | undefined,
  origin: { adName: string | null; adPlatform: string | null; linkName: string | null } | null,
  landing?: LandingOriginAd | null,
): { ad: string | null; none: string } {
  if (kind === "LINKAFFI") return { ad: null, none: "Aucune (lien d'un affilié)" };
  if (kind === "LANDING") {
    const none = "Aucune (page d'atterrissage)";
    const ad = adLabel({
      adName: landing?.adName?.trim() || null,
      adPlatform: landing?.adPlatform ?? null,
      linkName: null,
    });
    if (!ad) return { ad: null, none };
    const page = landing?.pageName?.trim();
    if (!page) return { ad: `${ad}, par une page d'atterrissage`, none };
    const source = landing?.sourceKey ? ` (source « ${landing.sourceKey} »)` : "";
    return { ad: frQuotes(`${ad}, par la page « ${page} »${source}`), none };
  }
  return { ad: origin ? adLabel(origin) : null, none: "Aucune (lien direct)" };
}

/**
 * Source d'arrivée affichée dans la liste des membres et son volet de résumé : « Pub Vidéo bonus (TikTok) » pour un
 * lien de pub, « Affilié Paul » pour le lien d'une campagne d'affilié Link Affi (phase 13 : ce n'est pas une pub, la
 * fiche le dit aussi), « Page Promo (tk01) » pour une page d'atterrissage (phase 15) ; null sans lien.
 */
export function originSourceLabel(o: {
  kind?: string | null;
  adName: string | null;
  adPlatform: string | null;
  linkName: string | null;
  affiliateName?: string | null;
  affiliateId?: string | null;
  /** Lien d'une page d'atterrissage (phase 15) : nom actuel de la page (null : page supprimée) et source. */
  landingPageName?: string | null;
  landingSource?: string | null;
}): string | null {
  if (o.kind === "LANDING") {
    // Une page d'atterrissage n'est pas une pub (même si une pub y mène) : « Page Promo (tk01) ».
    const page = (o.landingPageName ?? "").trim();
    if (!page) return o.linkName ? `Page ${o.linkName}` : "Page d'atterrissage";
    return o.landingSource ? `Page ${page} (${o.landingSource})` : `Page ${page}`;
  }
  if (o.kind === "LINKAFFI") {
    const who = (o.affiliateName ?? "").trim() || (o.affiliateId ?? "").trim();
    return who ? `Affilié ${who}` : "Affilié Link Affi";
  }
  const ad = adLabel(o);
  return ad ? `Pub ${ad}` : null;
}

/**
 * Canaux du volet de résumé de la liste, chacun une seule fois : le canal d'arrivée est déjà dans « D'où il vient » ;
 * le canal de la dernière demande ne s'écrit sous le statut que si le membre a plusieurs canaux ; « Aussi dans »
 * liste les autres.
 */
export function quickViewChannels(row: {
  channels: string[];
  statusChannel: string | null;
  origin: { channelTitle: string } | null;
}): { statusChannel: string | null; others: string[] } {
  const distinct = [...new Set(row.channels)];
  const statusChannel = distinct.length > 1 ? row.statusChannel : null;
  const others = distinct.filter((c) => c !== row.origin?.channelTitle && c !== statusChannel);
  return { statusChannel, others };
}
