/**
 * Création partagée des messages de canal programmés (phase 19) : choix du bot qui publie (site et worker) et
 * `createAgentPost` (agent Publication). Le `Post` créé est envoyé ensuite par le scheduler et `telegram-send`
 * existants, sans modification. Le client est passé en paramètre (transaction possible).
 */
import { hasCustomEmoji, jsonIds, shortId } from "@linkaffipro/core";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as sharedPrisma, type Db } from "./client";

export type PostingDb = Db | PrismaClient | Prisma.TransactionClient;

/** Champs d'un bot lus pour choisir celui qui publie (jamais le jeton). */
const publishingBotSelect = { id: true, username: true, isActive: true, mode: true } as const;

/** Un bot peut-il publier dans un canal ? Actif et normal : jamais un assistant de conversation (phase 17). */
function canPublish(bot: { isActive: boolean; mode: string } | null | undefined): boolean {
  return Boolean(bot?.isActive && bot.mode === "STANDARD");
}

/**
 * Bot qui publie dans un canal : bot principal, sinon le plus ancien bot administrateur actif. Jamais un bot en mode
 * assistant de conversation (phase 17 : il ne s'occupe que de ses conversations privées).
 * `keep` (modification d'un message) : le bot actuel du message est gardé s'il peut encore publier dans ce canal (bot
 * principal ou administrateur, actif et normal) ; sinon (désactivé, devenu assistant, plus administrateur) le choix
 * ci-dessus le remplace.
 */
export async function publishingBotFor(
  channelId: string,
  opts: { keep?: string | null } = {},
  db: PostingDb = sharedPrisma,
): Promise<{ id: string; username: string } | null> {
  const channel = await (db as PrismaClient).channel.findUnique({
    where: { id: channelId },
    select: {
      primaryBot: { select: publishingBotSelect },
      botAdmins: {
        where: { revokedAt: null, bot: { isActive: true, mode: "STANDARD" } },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        select: { bot: { select: publishingBotSelect } },
      },
    },
  });
  if (!channel) return null;
  const candidates = [channel.primaryBot, ...channel.botAdmins.map((a) => a.bot)].filter(
    (b): b is NonNullable<typeof b> => canPublish(b),
  );
  const chosen = (opts.keep && candidates.find((b) => b.id === opts.keep)) || candidates[0];
  return chosen ? { id: chosen.id, username: chosen.username } : null;
}

export class PostingError extends Error {}

export type AgentPostInput = {
  /** Canal où le message part (canal Test en simulation). */
  channelId: string;
  /** HTML Telegram, déjà contrôlé. */
  text: string;
  scheduledAt: Date;
  mediaAssetIds?: string[];
  agentMissionId: string;
  language?: string;
  /** Bouton Offre de notre campagne (lien traqué OFFER créé pour ce message). */
  offer?: { campaignId: string; buttonText: string; labelSuffix?: string } | null;
};

export type AgentPostResult = {
  postId: string;
  botId: string;
  publisher: "BOT" | "ACCOUNT";
  trackingLinkId: string | null;
};

/**
 * Crée un message programmé produit par un agent. Emojis animés dans un canal → publié par le compte Telegram connecté
 * (`ACCOUNT`), sans boutons (règle de la phase 12) ; sinon par le bot du canal, avec le bouton Offre de la campagne :
 * offre de la campagne la première active, lien `TrackingLink` OFFER rattaché au message, au canal et à la campagne.
 * Créé en brouillon puis programmé une fois les boutons enregistrés (comme le site).
 */
export async function createAgentPost(db: PostingDb, input: AgentPostInput): Promise<AgentPostResult> {
  const client = db as PrismaClient;
  const bot = await publishingBotFor(input.channelId, {}, db);
  if (!bot) throw new PostingError("Le canal n'a aucun bot administrateur actif : ajoutez un bot dans Telegram (page Canaux).");
  const channel = await client.channel.findUnique({
    where: { id: input.channelId },
    select: { type: true, vertical: true, language: true },
  });
  if (!channel) throw new PostingError("Canal introuvable.");
  const publisher: "BOT" | "ACCOUNT" = hasCustomEmoji(input.text) && channel.type !== "GROUP" ? "ACCOUNT" : "BOT";
  const post = await client.post.create({
    select: { id: true },
    data: {
      code: shortId(8),
      channelId: input.channelId,
      botId: bot.id,
      status: "DRAFT",
      scheduledAt: input.scheduledAt,
      language: input.language ?? channel.language,
      text: input.text,
      mediaAssetIds: input.mediaAssetIds ?? [],
      buttons: [],
      publisher,
      vertical: channel.vertical,
      disableLinkPreview: true,
      agentMissionId: input.agentMissionId,
    },
  });
  let trackingLinkId: string | null = null;
  let buttons: unknown[] = [];
  if (input.offer && publisher === "BOT") {
    const campaign = await client.campaign.findUnique({
      where: { id: input.offer.campaignId },
      select: { id: true, name: true, affiliateCampaignIds: true },
    });
    if (!campaign) throw new PostingError("La campagne du plan du canal est introuvable : choisissez-en une autre.");
    const ids = jsonIds(campaign.affiliateCampaignIds);
    const offers = ids.length
      ? await client.affiliateCampaign.findMany({
          where: { id: { in: ids } },
          select: { id: true, isActive: true, trackingUrlTemplate: true },
        })
      : [];
    const byId = new Map(offers.map((o) => [o.id, o]));
    const offer = ids.map((id) => byId.get(id)).find((o) => o && o.isActive && o.trackingUrlTemplate);
    if (!offer) throw new PostingError(`La campagne « ${campaign.name} » n'a plus d'offre active : ajoutez-lui une offre.`);
    const link = await client.trackingLink.create({
      data: {
        slug: shortId(8),
        kind: "OFFER",
        destinationTemplate: offer.trackingUrlTemplate,
        label: `${input.offer.buttonText}${input.offer.labelSuffix ?? " (agents)"}`,
        channelId: input.channelId,
        postId: post.id,
        affiliateCampaignId: offer.id,
        campaignId: campaign.id,
      },
      select: { id: true, slug: true },
    });
    trackingLinkId = link.id;
    buttons = [
      [
        {
          text: input.offer.buttonText,
          type: "OFFER",
          trackingLinkId: link.id,
          slug: link.slug,
          affiliateCampaignId: offer.id,
          campaignId: campaign.id,
        },
      ],
    ];
  }
  await client.post.update({
    where: { id: post.id },
    data: { buttons: buttons as Prisma.InputJsonValue, status: "SCHEDULED" },
  });
  return { postId: post.id, botId: bot.id, publisher, trackingLinkId };
}
