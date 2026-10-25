import { GrammyError, HttpError } from "grammy";
import {
  effectiveGateChannelIds,
  pickRuleForProvenance,
  provenanceOfLink,
  type ScopedRule,
} from "@linkaffipro/core";
import { audit, prisma, type ApprovalRule } from "@linkaffipro/db";
import { ACTIVE_CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { canInviteFromRights, getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { actingStandardBotFor } from "./acting-bot";
import { fmtDate } from "@/lib/format";
import { stringList } from "./entry-rule";
import { frQuotes } from "./exceptions";
import { appliedRuleText, ruleTiming, type AppliedRuleView } from "./provenance-display";

/**
 * Liens de partage d'un canal (fiche canal → « Qui peut entrer et quand » → « Liens de partage », phase 11) : un lien
 * nommé (« Post Tir Cadré »), à poster où l'on veut, éventuellement « dans » un de nos canaux (`sourceChannelId` :
 * la personne compte alors comme venue de ce canal pour les exceptions). Créé par Telegram AVEC demande d'adhésion
 * (`InviteLink` de type SHARE) : la règle du canal (ou l'exception du lien) s'applique, et chaque lien a ses chiffres.
 *
 * - Création : par notre bot qui agit pour le canal (principal s'il est administrateur), sinon par un autre de nos
 *   bots administrateurs avec le droit d'inviter ; refus de Telegram expliqué en français.
 * - Désactivation : révocation chez Telegram par le bot qui a créé le lien (seul autorisé par Telegram), puis
 *   `isActive = false`. Telegram injoignable : rien ne change (« réessayez »). Refus définitif (bot retiré, lien
 *   introuvable) : le lien est quand même désactivé ici et l'écran le dit.
 * Journal de l'équipe : `invite_link.share_created`, `invite_link.share_disabled`. Un responsable peut tout faire ici.
 */

/** Longueur maximale du nom d'un lien de partage (écran). Telegram n'en garde que 32 caractères. */
export const SHARE_NAME_MAX = 64;
export const TELEGRAM_LINK_NAME_MAX = 32;

export class ShareLinkError extends Error {}

/**
 * Échec de création d'un lien chez Telegram, avec sa nature (réutilisé par l'API d'intégration Link Affi, phase 13,
 * pour choisir le code de réponse) : aucun de nos bots administrateurs, Telegram injoignable, ou refus de Telegram.
 * Hérite de `ShareLinkError` : les écrans des liens de partage l'affichent tel quel.
 */
export class TelegramLinkError extends ShareLinkError {
  constructor(
    readonly kind: "no_bot" | "transient" | "refused",
    message: string,
  ) {
    super(message);
  }
}

/** Nom du lien chez Telegram : 32 caractères au plus, sans couper un émoji. */
export function telegramLinkName(name: string): string {
  return Array.from(name.trim()).slice(0, TELEGRAM_LINK_NAME_MAX).join("").trim();
}

/** Nom saisi : espaces superflus retirés ; message en français s'il ne convient pas. */
export function parseShareName(raw: unknown): { name: string } | { error: string } {
  const name = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return { error: "Donnez un nom au lien (par exemple « Post Tir Cadré »)." };
  if (Array.from(name).length > SHARE_NAME_MAX)
    return { error: `Le nom est trop long : ${SHARE_NAME_MAX} caractères au plus.` };
  return { name };
}

/** Telegram injoignable ou surchargé (réessayer plus tard). */
export function isTransientTelegramError(err: unknown): boolean {
  if (err instanceof HttpError) return true;
  if (err instanceof GrammyError) return err.error_code === 429 || err.error_code >= 500;
  return false;
}

/** Lien déjà retiré ou inconnu chez Telegram (la désactivation est alors acquise). */
export function isGoneLinkError(err: unknown): boolean {
  // 400 seulement : un 404 « Not Found » vient d'un jeton refusé, pas d'un lien disparu.
  return (
    err instanceof GrammyError &&
    err.error_code === 400 &&
    /INVITE_HASH_EXPIRED|INVITE_HASH_INVALID|link not found/i.test(err.description)
  );
}

function telegramText(err: unknown): string {
  if (err instanceof GrammyError) return `${err.error_code} : ${err.description}`;
  return err instanceof Error ? err.message : String(err);
}

/** Refus de Telegram à la création, en français, avec ce qu'il faut faire. */
export function createErrorMessage(err: unknown, bot: string, channelTitle: string): string {
  if (isTransientTelegramError(err))
    return "Telegram ne répond pas pour l'instant : réessayez dans une minute.";
  // Jeton refusé : 401, ou 404 « Not Found » (Telegram ne reconnaît pas le jeton du tout).
  if (
    err instanceof GrammyError &&
    (err.error_code === 401 || (err.error_code === 404 && /^not found$/i.test(err.description)))
  )
    return `Le bot @${bot} n'est plus reconnu par Telegram : renouvelez son jeton dans Réglages → Bots, puis réessayez.`;
  return `Telegram refuse que @${bot} crée un lien dans « ${channelTitle} ». Ajoutez @${bot} comme administrateur de « ${channelTitle} » avec le droit « Inviter via un lien », puis réessayez.`;
}

type BotRow = NonNullable<Awaited<ReturnType<typeof actingStandardBotFor>>>;

/** API grammY d'un bot (instance mise en cache, la même que celle des webhooks ; les tests l'interceptent). */
function apiOf(bot: BotRow) {
  return getOrCreateBot(bot, prismaTelegramDeps).api;
}

/**
 * Bots qui peuvent créer le lien, dans l'ordre : celui qui agit pour le canal, puis nos autres bots administrateurs
 * (droit d'inviter connu ou inconnu ; un droit refusé passe en dernier).
 */
async function candidateBots(channelId: string): Promise<BotRow[]> {
  const [acting, admins] = await Promise.all([
    actingStandardBotFor(channelId),
    prisma.channelBotAdmin.findMany({
      // Jamais un bot assistant de conversation (phase 17).
      where: { channelId, revokedAt: null, bot: ACTIVE_CHANNEL_BOT_WHERE },
      orderBy: { detectedAt: "asc" },
      include: { bot: true },
    }),
  ]);
  const rank = (rights: unknown) => (canInviteFromRights(rights) === false ? 1 : 0);
  const others = admins
    .filter((a) => a.botId !== acting?.id)
    .sort((a, b) => rank(a.rights) - rank(b.rights))
    .map((a) => a.bot);
  return [...(acting ? [acting] : []), ...others];
}

/**
 * Crée chez Telegram un lien AVEC demande d'adhésion, par le bot qui agit pour le canal, sinon par un autre de nos bots
 * administrateurs (voir `candidateBots`). Telegram injoignable : on n'essaie pas les autres bots tout de suite.
 * Lève `TelegramLinkError` avec un message en français. Partagé par les liens de partage et les liens des campagnes
 * Telegram des affiliés Link Affi (phase 13).
 */
export async function createJoinRequestLink(
  channel: { id: string; title: string; telegramChatId: bigint },
  telegramName: string,
): Promise<{ botId: string; url: string }> {
  const bots = await candidateBots(channel.id);
  if (bots.length === 0)
    throw new TelegramLinkError(
      "no_bot",
      `Aucun de nos bots n'est administrateur de « ${channel.title} » : ajoutez un de nos bots comme administrateur avec le droit « Inviter via un lien », puis cliquez « Re-vérifier les droits des bots ».`,
    );
  let firstError: unknown = null;
  for (const bot of bots) {
    try {
      const invite = await apiOf(bot).createChatInviteLink(Number(channel.telegramChatId), {
        name: telegramName,
        creates_join_request: true,
      });
      return { botId: bot.id, url: invite.invite_link };
    } catch (err) {
      firstError ??= err;
      // Telegram injoignable : inutile d'essayer les autres bots tout de suite.
      if (isTransientTelegramError(err)) break;
    }
  }
  throw new TelegramLinkError(
    isTransientTelegramError(firstError) ? "transient" : "refused",
    createErrorMessage(firstError, bots[0]!.username, channel.title),
  );
}

/**
 * Révoque un lien chez Telegram par le bot qui l'a créé (seul autorisé par Telegram). Renvoie null si le lien ne
 * fonctionne plus (révoqué, ou déjà retiré), sinon le refus de Telegram en clair (bot désactivé, bot plus
 * administrateur…). Telegram injoignable : lève `TelegramLinkError` (« transient »), rien n'a changé.
 */
export async function revokeOnTelegram(link: {
  telegramInviteLink: string;
  bot: BotRow;
  channel: { telegramChatId: bigint };
}): Promise<string | null> {
  if (!link.bot.isActive) return "bot désactivé";
  try {
    await apiOf(link.bot).revokeChatInviteLink(
      Number(link.channel.telegramChatId),
      link.telegramInviteLink,
    );
  } catch (err) {
    if (isTransientTelegramError(err))
      throw new TelegramLinkError(
        "transient",
        "Telegram ne répond pas pour l'instant : réessayez dans une minute. Le lien fonctionne encore.",
      );
    if (!isGoneLinkError(err)) return telegramText(err);
  }
  return null;
}

export type CreatedShareLink = { id: string; name: string; url: string };

/** Crée un lien de partage (voir l'en-tête). Lève `ShareLinkError` avec un message en français. */
export async function createShareLink(input: {
  channelId: string;
  name: string;
  sourceChannelId: string | null;
  userId: string | null;
  /** Phase 34 : site ou Kevin (journal) ; `dryRun` : tout vérifier sans créer le lien. */
  via?: "WEB" | "TELEGRAM";
  dryRun?: boolean;
}): Promise<CreatedShareLink> {
  const parsed = parseShareName(input.name);
  if ("error" in parsed) throw new ShareLinkError(parsed.error);
  const { name } = parsed;
  const channel = await prisma.channel.findUnique({
    where: { id: input.channelId },
    select: { id: true, title: true, telegramChatId: true, language: true },
  });
  if (!channel) throw new ShareLinkError("Ce canal n'existe plus : revenez à la liste des canaux.");
  if (input.sourceChannelId) {
    if (input.sourceChannelId === channel.id)
      throw new ShareLinkError(
        "Choisissez un autre canal que celui-ci pour « À poster dans », ou « Où vous voulez ».",
      );
    const source = await prisma.channel.findUnique({
      where: { id: input.sourceChannelId },
      select: { id: true },
    });
    if (!source) throw new ShareLinkError("Le canal choisi pour « À poster dans » n'existe plus.");
  }
  const same = await prisma.inviteLink.findFirst({
    where: {
      channelId: channel.id,
      kind: "SHARE",
      isActive: true,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (same)
    throw new ShareLinkError(
      `Un lien de partage actif s'appelle déjà « ${name} » dans ce canal : choisissez un autre nom.`,
    );

  if (input.dryRun) return { id: "", name, url: "" };
  const created = await createJoinRequestLink(channel, telegramLinkName(name));

  const link = await prisma.inviteLink.create({
    data: {
      channelId: channel.id,
      botId: created.botId,
      telegramInviteLink: created.url,
      name,
      kind: "SHARE",
      createsJoinRequest: true,
      sourceChannelId: input.sourceChannelId,
      language: channel.language,
      createdById: input.userId,
    },
    select: { id: true, name: true, telegramInviteLink: true },
  });
  await audit({
    userId: input.userId,
    action: "invite_link.share_created",
    entityType: "InviteLink",
    entityId: link.id,
    metadata: {
      channelId: channel.id,
      name,
      sourceChannelId: input.sourceChannelId,
      botId: created.botId,
      ...(input.via ? { via: input.via } : {}),
    },
  });
  return { id: link.id, name: link.name, url: link.telegramInviteLink };
}

export type DisabledShareLink = {
  name: string;
  /** Faux : désactivé ici, mais Telegram n'a pas pu retirer le lien (`error`). */
  revokedOnTelegram: boolean;
  error: string | null;
  bot: string;
  alreadyDisabled: boolean;
};

/** Désactive un lien de partage (voir l'en-tête). Lève `ShareLinkError` avec un message en français. */
export async function disableShareLink(input: {
  channelId: string;
  linkId: string;
  userId: string | null;
  via?: "WEB" | "TELEGRAM";
  dryRun?: boolean;
}): Promise<DisabledShareLink> {
  const link = await prisma.inviteLink.findFirst({
    where: { id: input.linkId, channelId: input.channelId, kind: "SHARE" },
    include: { bot: true, channel: { select: { telegramChatId: true, title: true } } },
  });
  if (!link) throw new ShareLinkError("Ce lien n'existe plus : rechargez la page.");
  if (!link.isActive)
    return {
      name: link.name,
      revokedOnTelegram: true,
      error: null,
      bot: link.bot.username,
      alreadyDisabled: true,
    };
  if (input.dryRun)
    return { name: link.name, revokedOnTelegram: true, error: null, bot: link.bot.username, alreadyDisabled: false };
  const error = await revokeOnTelegram(link);
  await prisma.inviteLink.update({ where: { id: link.id }, data: { isActive: false } });
  await audit({
    userId: input.userId,
    action: "invite_link.share_disabled",
    entityType: "InviteLink",
    entityId: link.id,
    metadata: {
      channelId: input.channelId,
      name: link.name,
      revokedOnTelegram: error === null,
      error,
      ...(input.via ? { via: input.via } : {}),
    },
  });
  return {
    name: link.name,
    revokedOnTelegram: error === null,
    error,
    bot: link.bot.username,
    alreadyDisabled: false,
  };
}

/** Message de retour de « Désactiver ». */
export function disabledMessage(r: DisabledShareLink, channelTitle: string): string {
  if (r.alreadyDisabled) return `Le lien « ${r.name} » était déjà désactivé.`;
  if (r.revokedOnTelegram)
    return `Lien « ${r.name} » désactivé : il ne fonctionne plus dans Telegram. Les demandes déjà reçues restent.`;
  return `Lien « ${r.name} » désactivé ici, mais Telegram n'a pas pu le retirer (@${r.bot} n'est peut-être plus administrateur de « ${channelTitle} »). Pour l'arrêter tout à fait : dans Telegram, ouvrez le canal → Gérer le canal → Liens d'invitation, puis retirez-le.`;
}

// ============================================================
// Lecture pour la section « Liens de partage »
// ============================================================

export type ShareLinkView = {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  /** « À poster dans » : titre du canal, ou null (où vous voulez). */
  postedIn: string | null;
  requests: number;
  accepted: number;
  /** Règle appliquée aux personnes venues par ce lien : « Règle : 1 jour (Venu de « Tir Cadré ») ». */
  rule: string;
  /** Une exception vise ce lien précisément. */
  ownException: boolean;
  createdAt: string;
};

export type ShareLinksData = {
  channelTitle: string;
  links: ShareLinkView[];
  /** Nos canaux actifs (sauf celui-ci), pour « À poster dans ». */
  channels: Array<{ id: string; title: string }>;
  /** Bot qui créera les liens (null : aucun de nos bots n'est administrateur). */
  bot: string | null;
};

function scoped(r: ApprovalRule): ScopedRule {
  return {
    id: r.id,
    scope: r.scope,
    isDefault: r.isDefault,
    isActive: r.isActive,
    inviteLinkId: r.inviteLinkId,
    sourceChannelId: r.sourceChannelId,
    sourceKind: r.sourceKind,
    sortOrder: r.sortOrder,
  };
}

/** Règle qui s'applique aux personnes venues par ce lien, en mots (même résolution que le bot). */
export function shareRuleText(
  link: { id: string; sourceChannelId: string | null },
  channelId: string,
  rules: readonly ApprovalRule[],
): { text: string; ownException: boolean } {
  const p = provenanceOfLink({
    id: link.id,
    kind: "SHARE",
    sourceChannelId: link.sourceChannelId,
    adPlatform: null,
  });
  const picked = pickRuleForProvenance(rules.map(scoped), p);
  const rule = picked ? rules.find((r) => r.id === picked.id) : undefined;
  if (!rule) return { text: "Aucune règle : à valider à la main", ownException: false };
  const gates = effectiveGateChannelIds(
    { scope: rule.scope, gateChannelIds: stringList(rule.gateChannelIds) },
    p,
    channelId,
  );
  const timing = ruleTiming({
    mode: rule.mode,
    delaySeconds: rule.delaySeconds,
    gateMode: rule.gateMode,
    gateCount: gates.gateChannelIds.length,
  });
  const view: AppliedRuleView =
    rule.scope === "DEFAULT"
      ? { kind: "default", timing }
      : { kind: "exception", label: rule.label, timing };
  const text = appliedRuleText(view)!;
  const cap = text.charAt(0).toUpperCase() + text.slice(1);
  return {
    text: view.kind === "exception" && rule.label ? `${cap} (${frQuotes(rule.label)})` : cap,
    ownException: rule.scope === "INVITE_LINK",
  };
}

/** Liens de partage d'un canal (actifs d'abord, plus récents d'abord), avec leurs chiffres et leur règle. */
export async function loadShareLinks(channelId: string): Promise<ShareLinksData> {
  const [channel, links, rules, channels, bot] = await Promise.all([
    prisma.channel.findUnique({ where: { id: channelId }, select: { title: true } }),
    prisma.inviteLink.findMany({
      where: { channelId, kind: "SHARE" },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        telegramInviteLink: true,
        isActive: true,
        sourceChannelId: true,
        createdAt: true,
      },
    }),
    prisma.approvalRule.findMany({ where: { channelId } }),
    prisma.channel.findMany({
      where: { isActive: true, id: { not: channelId } },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    actingStandardBotFor(channelId),
  ]);
  const ids = links.map((l) => l.id);
  const [requested, accepted, sources] = ids.length
    ? await Promise.all([
        prisma.membership.groupBy({
          by: ["inviteLinkId"],
          where: { inviteLinkId: { in: ids } },
          _count: { _all: true },
        }),
        prisma.membership.groupBy({
          by: ["inviteLinkId"],
          where: {
            inviteLinkId: { in: ids },
            OR: [
              { approvedAt: { not: null } },
              { joinedAt: { not: null } },
              { status: { in: ["APPROVED", "LEFT", "KICKED"] } },
            ],
          },
          _count: { _all: true },
        }),
        prisma.channel.findMany({
          where: {
            id: { in: links.map((l) => l.sourceChannelId).filter((x): x is string => !!x) },
          },
          select: { id: true, title: true },
        }),
      ])
    : [[], [], []];
  const countOf = (
    rows: Array<{ inviteLinkId: string | null; _count: { _all: number } }>,
    id: string,
  ) => rows.find((r) => r.inviteLinkId === id)?._count._all ?? 0;
  const titleOf = new Map(sources.map((c) => [c.id, c.title]));
  return {
    channelTitle: channel?.title ?? "ce canal",
    channels,
    bot: bot?.username ?? null,
    links: links.map((l) => {
      const rule = shareRuleText(l, channelId, rules);
      return {
        id: l.id,
        name: l.name,
        url: l.telegramInviteLink,
        isActive: l.isActive,
        postedIn: l.sourceChannelId
          ? (titleOf.get(l.sourceChannelId) ?? "un canal supprimé")
          : null,
        requests: countOf(requested, l.id),
        accepted: countOf(accepted, l.id),
        rule: rule.text,
        ownException: rule.ownException,
        createdAt: fmtDate(l.createdAt),
      };
    }),
  };
}
