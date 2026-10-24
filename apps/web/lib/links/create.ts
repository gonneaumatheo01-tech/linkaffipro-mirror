import { Api, GrammyError } from "grammy";
import { decrypt, shortId } from "@linkaffipro/core";
import { prisma, audit, recordEvent, type AdPlatform } from "@linkaffipro/db";
import { ACTIVE_CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";

export class LinkError extends Error {}

/** Un bot peut-il créer les liens d'un canal ? Actif et normal : jamais un assistant de conversation (phase 17). */
function canActFor(bot: { isActive: boolean; mode: string }): boolean {
  return bot.isActive && bot.mode === "STANDARD";
}

/**
 * Bot qui agit sur un canal : bot principal s'il est administrateur, sinon le plus ancien bot administrateur. Jamais un
 * bot en mode assistant de conversation (phase 17 : il ne crée pas de liens d'invitation).
 */
export async function actingBotForChannel(channelId: string) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      primaryBot: true,
      botAdmins: {
        where: { revokedAt: null, bot: ACTIVE_CHANNEL_BOT_WHERE },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        include: { bot: true },
      },
    },
  });
  if (!channel) throw new LinkError("Canal introuvable.");
  const admins = channel.botAdmins.map((a) => a.bot).filter(canActFor);
  const primary =
    channel.primaryBot && admins.some((b) => b.id === channel.primaryBot!.id)
      ? channel.primaryBot
      : null;
  const bot = primary ?? admins[0] ?? null;
  if (!bot)
    throw new LinkError(
      `Aucun bot administrateur sur « ${channel.title} » : ajoutez un bot comme administrateur du canal (droit « Inviter des utilisateurs »).`,
    );
  if (!primary)
    console.warn(
      `[links] canal ${channel.id} : bot principal absent ou non administrateur, utilisation de @${bot.username}`,
    );
  return { channel, bot };
}

export type EntryLinkInput = {
  channelId: string;
  name: string;
  platform: AdPlatform;
  adCampaignName?: string | null;
  adSetName?: string | null;
  adName?: string | null;
  language: string;
  approvalRuleId?: string | null;
  userId: string;
};

/**
 * Crée un lien d'entrée par pub : lien d'invitation Telegram (demande d'adhésion) + lien goolink traqué.
 * Même code pour la création unitaire et en lot.
 */
export async function createEntryLink(input: EntryLinkInput) {
  const { channel, bot } = await actingBotForChannel(input.channelId);
  const api = new Api(decrypt(bot.tokenEncrypted));
  let invite;
  try {
    invite = await api.createChatInviteLink(Number(channel.telegramChatId), {
      name: input.name.slice(0, 32),
      creates_join_request: true,
    });
  } catch (err) {
    if (err instanceof GrammyError)
      throw new LinkError(
        `Telegram a refusé la création du lien (${err.error_code}) : ${err.description}`,
      );
    throw err;
  }
  const slug = await freeSlug();
  const result = await prisma.$transaction(async (tx) => {
    const inviteLink = await tx.inviteLink.create({
      data: {
        channelId: channel.id,
        botId: bot.id,
        telegramInviteLink: invite.invite_link,
        name: input.name,
        kind: "AD_ENTRY",
        createsJoinRequest: true,
        adPlatform: input.platform,
        adCampaignName: input.adCampaignName || null,
        adSetName: input.adSetName || null,
        adName: input.adName || null,
        language: input.language,
        createdById: input.userId,
      },
    });
    const trackingLink = await tx.trackingLink.create({
      data: {
        slug,
        kind: "AD_ENTRY",
        destinationTemplate: invite.invite_link,
        label: input.name,
        inviteLinkId: inviteLink.id,
        channelId: channel.id,
        createdById: input.userId,
      },
    });
    if (input.approvalRuleId) {
      const rule = await tx.approvalRule.findFirst({
        where: { id: input.approvalRuleId, channelId: channel.id },
      });
      if (rule) {
        await tx.approvalRule.create({
          data: {
            channelId: channel.id,
            name: `${rule.name} — ${input.name}`,
            isDefault: false,
            // Règle d'un lien précis (phase 11 : exception de portée INVITE_LINK, la plus prioritaire).
            scope: "INVITE_LINK",
            inviteLinkId: inviteLink.id,
            label: `Venu du lien « ${input.name} »`,
            sendWelcome: rule.sendWelcome,
            mode: rule.mode,
            delaySeconds: rule.delaySeconds,
            gateChannelIds: rule.gateChannelIds as object,
            gateMode: rule.gateMode,
            reminderAfterMinutes: rule.reminderAfterMinutes as object,
            maxReminders: rule.maxReminders,
            expireAfterHours: rule.expireAfterHours,
            expireAction: rule.expireAction,
            sendAcceptedMessage: rule.sendAcceptedMessage,
          },
        });
      }
    }
    return { inviteLink, trackingLink };
  });
  await audit({
    userId: input.userId,
    action: "link.entry_created",
    entityType: "TrackingLink",
    entityId: result.trackingLink.id,
    metadata: { name: input.name, channelId: channel.id, platform: input.platform, slug },
  });
  await recordEvent({
    type: "link.created",
    channelId: channel.id,
    botId: bot.id,
    payload: { kind: "AD_ENTRY", slug, inviteLinkId: result.inviteLink.id },
  });
  return result;
}

export async function createGenericLink(input: {
  label: string;
  url: string;
  userId: string;
  kind?: "GENERIC" | "BUTTON";
  postId?: string | null;
}) {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new LinkError("URL invalide.");
  }
  if (!/^https?:$/.test(parsed.protocol))
    throw new LinkError("L'URL doit commencer par http:// ou https://.");
  const slug = await freeSlug();
  const link = await prisma.trackingLink.create({
    data: {
      slug,
      kind: input.kind ?? "GENERIC",
      destinationTemplate: input.url,
      label: input.label,
      createdById: input.userId,
      postId: input.postId ?? null,
    },
  });
  await audit({
    userId: input.userId,
    action: "link.generic_created",
    entityType: "TrackingLink",
    entityId: link.id,
    metadata: { label: input.label, slug },
  });
  return link;
}

/** Slug base62 de 8 caractères, libre. */
export async function freeSlug(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = shortId(8);
    const exists = await prisma.trackingLink.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
  }
  throw new LinkError("Impossible de générer un identifiant libre, réessayez.");
}
