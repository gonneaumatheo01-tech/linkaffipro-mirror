import { linkaffiInviteLinkName } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  TelegramLinkError,
  createJoinRequestLink,
  revokeOnTelegram,
} from "@/lib/channels/share-links";
import { IntegrationError } from "./http";
import {
  decideInviteLinkCreation,
  decideInviteLinkPatch,
  type CreateRequest,
  type LinkaffiLinkRow,
} from "./invite-links-logic";

/**
 * Liens d'invitation des campagnes Telegram des affiliés Link Affi (`InviteLink` de type LINKAFFI, phase 13) :
 * création par `POST /invite-links` et désactivation par `PATCH /invite-links/{id}`.
 *
 * Création : par Telegram AVEC demande d'adhésion, par le bot qui agit pour le canal, sinon un autre de nos bots
 * administrateurs (comme les liens de partage, `createJoinRequestLink`) ; nom du lien chez Telegram = nom de la
 * campagne sur 32 caractères au plus. Règles (idempotence, une clé = un affilié, pas de réactivation) :
 * `invite-links-logic.ts`. Deux appels simultanés pour la même clé et le même canal : l'index unique garde un seul
 * lien, le lien Telegram en trop est révoqué aussitôt et les deux appels reçoivent le même lien.
 */

const LINK_SELECT = {
  id: true,
  channelId: true,
  isActive: true,
  telegramInviteLink: true,
  linkaffiAffiliateId: true,
  linkaffiCampaignName: true,
  linkaffiAffiliateName: true,
  attributionDays: true,
} as const;

/** Réponse de `POST /invite-links` (et de `PATCH`). */
export type LinkaffiInviteLinkView = {
  inviteLinkId: string;
  url: string;
  isActive: boolean;
  channelId: string;
  campaignKey: string;
};

export type CreateOutcome = {
  status: 200 | 201;
  link: LinkaffiInviteLinkView;
  /** Champs mis à jour sur un lien existant (journal). */
  updated: string[];
  botId: string | null;
};

function view(row: LinkaffiLinkRow, campaignKey: string): LinkaffiInviteLinkView {
  return {
    inviteLinkId: row.id,
    url: row.telegramInviteLink,
    isActive: row.isActive,
    channelId: row.channelId,
    campaignKey,
  };
}

function telegramFailure(err: TelegramLinkError): IntegrationError {
  if (err.kind === "transient")
    return new IntegrationError(503, "telegram_unavailable", err.message, { "Retry-After": "60" });
  if (err.kind === "no_bot") return new IntegrationError(422, "no_bot", err.message);
  return new IntegrationError(422, "telegram_refused", err.message);
}

function decide(req: CreateRequest, rows: LinkaffiLinkRow[]) {
  const d = decideInviteLinkCreation(req, rows);
  if (d.kind === "affiliate_mismatch")
    throw new IntegrationError(
      409,
      "affiliate_mismatch",
      `La clé « ${req.campaignKey} » appartient déjà à un autre affilié (${d.link.linkaffiAffiliateId}) : une clé de campagne correspond à un seul affilié.`,
    );
  if (d.kind === "disabled")
    throw new IntegrationError(
      409,
      "invite_link_disabled",
      `Le lien de la campagne « ${req.campaignKey} » sur ce canal a été désactivé : il ne peut pas revenir. Créez une nouvelle campagne Telegram dans Link Affi (nouvelle clé).`,
    );
  return d;
}

/** `POST /invite-links` : lien existant (200) ou nouveau lien créé chez Telegram (201). Lève `IntegrationError`. */
export async function createLinkaffiInviteLink(req: CreateRequest): Promise<CreateOutcome> {
  const sameKey = () =>
    prisma.inviteLink.findMany({
      where: { kind: "LINKAFFI", linkaffiCampaignKey: req.campaignKey },
      select: LINK_SELECT,
    });
  const d = decide(req, await sameKey());
  if (d.kind === "existing") {
    const keys = Object.keys(d.updates);
    const row = keys.length
      ? await prisma.inviteLink.update({
          where: { id: d.link.id },
          data: d.updates,
          select: LINK_SELECT,
        })
      : d.link;
    return { status: 200, link: view(row, req.campaignKey), updated: keys, botId: null };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: req.channelId },
    select: {
      id: true,
      title: true,
      telegramChatId: true,
      language: true,
      isActive: true,
      isMediaLibrary: true,
    },
  });
  if (!channel || !channel.isActive || channel.isMediaLibrary)
    throw new IntegrationError(
      404,
      "channel_not_found",
      "Canal inconnu ou désactivé : choisissez un canal de la liste GET /channels.",
    );

  const name = linkaffiInviteLinkName(req.campaignName);
  let created: { botId: string; url: string };
  try {
    created = await createJoinRequestLink(channel, name);
  } catch (err) {
    if (err instanceof TelegramLinkError) throw telegramFailure(err);
    throw err;
  }

  try {
    const row = await prisma.inviteLink.create({
      data: {
        channelId: channel.id,
        botId: created.botId,
        telegramInviteLink: created.url,
        name,
        kind: "LINKAFFI",
        createsJoinRequest: true,
        linkaffiCampaignKey: req.campaignKey,
        linkaffiCampaignName: req.campaignName,
        linkaffiAffiliateId: req.affiliateId,
        // Absents : pas de nom, attribution à vie.
        linkaffiAffiliateName: req.affiliateName ?? null,
        attributionDays: req.attributionDays ?? null,
        language: channel.language,
        createdById: null,
      },
      select: LINK_SELECT,
    });
    return { status: 201, link: view(row, req.campaignKey), updated: [], botId: created.botId };
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;
    // Appel simultané pour la même clé et le même canal : un seul lien est gardé, celui en trop est retiré.
    await revokeExtra(created, channel.telegramChatId);
    const again = decide(req, await sameKey());
    if (again.kind !== "existing") throw err;
    return { status: 200, link: view(again.link, req.campaignKey), updated: [], botId: null };
  }
}

async function revokeExtra(created: { botId: string; url: string }, telegramChatId: bigint) {
  const bot = await prisma.bot.findUnique({ where: { id: created.botId } });
  if (!bot) return;
  await revokeOnTelegram({
    telegramInviteLink: created.url,
    bot,
    channel: { telegramChatId },
  }).catch((e: unknown) =>
    console.warn("[integration linkaffi] lien en double non révoqué", {
      error: e instanceof Error ? e.message : String(e),
    }),
  );
}

export type PatchOutcome = {
  /**
   * `revokedOnTelegram` : true / false = résultat de la révocation chez Telegram (celle de cet appel, ou, pour un lien
   * déjà désactivé, celle journalisée lors de sa désactivation) ; null = inconnu (lien désactivé sans trace).
   */
  link: LinkaffiInviteLinkView & { revokedOnTelegram: boolean | null };
  message: string;
  changed: boolean;
};

/** Action du journal des appels `PATCH` (voir `withLinkaffiIntegration`). */
const PATCH_AUDIT_ACTION = "integration.linkaffi.patch_invite_link";

/**
 * Résultat de la révocation chez Telegram mémorisé au journal lors de la désactivation du lien (`AuditLog` de l'appel
 * `PATCH` qui l'a désactivé, métadonnée `revokedOnTelegram`) ; null s'il n'y en a pas (désactivé par une autre voie).
 */
async function rememberedRevocation(inviteLinkId: string): Promise<boolean | null> {
  const last = await prisma.auditLog.findFirst({
    where: {
      action: PATCH_AUDIT_ACTION,
      entityType: "InviteLink",
      entityId: inviteLinkId,
      metadata: { path: ["changed"], equals: true },
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  const v = (last?.metadata as { revokedOnTelegram?: unknown } | null)?.revokedOnTelegram;
  return typeof v === "boolean" ? v : null;
}

/** `PATCH /invite-links/{id}` : désactivation et révocation chez Telegram par le bot créateur. */
export async function patchLinkaffiInviteLink(
  inviteLinkId: string,
  isActive: boolean,
): Promise<PatchOutcome> {
  const link = await prisma.inviteLink.findFirst({
    where: { id: inviteLinkId, kind: "LINKAFFI" },
    include: { bot: true, channel: { select: { telegramChatId: true, title: true } } },
  });
  if (!link)
    throw new IntegrationError(
      404,
      "invite_link_not_found",
      "Lien inconnu : vérifiez l'identifiant renvoyé par POST /invite-links.",
    );
  const base = {
    inviteLinkId: link.id,
    url: link.telegramInviteLink,
    channelId: link.channelId,
    campaignKey: link.linkaffiCampaignKey ?? "",
  };
  const d = decideInviteLinkPatch(link, isActive);
  if (d.kind === "reactivation_refused")
    throw new IntegrationError(
      409,
      "reactivation_refused",
      "Un lien désactivé ne peut pas être réactivé : créez une nouvelle campagne Telegram dans Link Affi (nouvelle clé), elle recevra un nouveau lien.",
    );
  if (d.kind === "already_active")
    return {
      link: { ...base, isActive: true, revokedOnTelegram: false },
      message: "Le lien est actif : rien à changer.",
      changed: false,
    };
  if (d.kind === "already_inactive") {
    const revoked = await rememberedRevocation(link.id);
    return {
      link: { ...base, isActive: false, revokedOnTelegram: revoked },
      message:
        revoked === false
          ? `Le lien était déjà désactivé ici, mais Telegram n'avait pas pu le retirer : l'équipe de la plateforme doit le retirer à la main dans le canal « ${link.channel.title} ».`
          : revoked === true
            ? "Le lien était déjà désactivé et retiré de Telegram."
            : "Le lien était déjà désactivé.",
      changed: false,
    };
  }

  let error: string | null;
  try {
    error = await revokeOnTelegram(link);
  } catch (err) {
    if (err instanceof TelegramLinkError) throw telegramFailure(err);
    throw err;
  }
  await prisma.inviteLink.update({ where: { id: link.id }, data: { isActive: false } });
  return {
    link: { ...base, isActive: false, revokedOnTelegram: error === null },
    message:
      error === null
        ? "Lien désactivé : il ne fonctionne plus dans Telegram. Les membres déjà amenés restent à l'affilié."
        : `Lien désactivé ici, mais Telegram n'a pas pu le retirer (${error}) : l'équipe de la plateforme doit le retirer à la main dans le canal « ${link.channel.title} ». Les membres déjà amenés restent à l'affilié.`,
    changed: true,
  };
}
