import { ACTIVE_CHANNEL_BOT_WHERE, prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { emitAutomationEvent, emitLinkaffiEvent, enqueue, enqueueDm } from "@linkaffipro/queue";
import type { User } from "grammy/types";
import type { PendingGateRow } from "./auto-gate";
import type {
  ChannelInfo,
  InviteLinkInfo,
  JoinFlowDeps,
  MembershipInfo,
  MembershipUpdate,
} from "./deps";
import type { GateLinkApi, GateLinkDeps } from "./gate-links";
import { createPrismaGateLinkDeps } from "./prisma-gate-links";
import { resolveRuleWithDb, ruleForMembershipWithDb } from "./prisma-rules";

function memberData(from: User) {
  return {
    firstName: from.first_name ?? null,
    lastName: from.last_name ?? null,
    username: from.username ?? null,
    languageCode: from.language_code ?? null,
    isPremium: from.is_premium ?? false,
    lastSeenAt: new Date(),
  };
}

const channelSelect = {
  id: true,
  title: true,
  username: true,
  language: true,
  telegramChatId: true,
  primaryBotId: true,
  isActive: true,
} as const;
const linkSelect = {
  id: true,
  kind: true,
  name: true,
  channelId: true,
  campaignId: true,
  adPlatform: true,
  adCampaignName: true,
  adName: true,
  sourceChannelId: true,
  telegramInviteLink: true,
  // Campagne Telegram d'affilié Link Affi (phase 13) : provenance, exceptions de règle, attribution.
  linkaffiCampaignKey: true,
  linkaffiCampaignName: true,
  linkaffiAffiliateId: true,
  linkaffiAffiliateName: true,
  attributionDays: true,
  // Lien désactivé (campagne d'affilié fermée) : plus aucune attribution, l'admission ne change pas.
  isActive: true,
  // Page d'atterrissage et source (phase 15) : provenance LANDING, exceptions « la page <nom> ».
  landingPageId: true,
  landingSource: true,
  landingPage: { select: { name: true } },
} as const;

/** Lien relu en base → `InviteLinkInfo` (nom de la page d'atterrissage à plat). */
function toLinkInfo<T extends { landingPage: { name: string } | null }>(
  row: T,
): Omit<T, "landingPage"> & { landingPageName: string | null } {
  const { landingPage, ...rest } = row;
  return { ...rest, landingPageName: landingPage?.name ?? null };
}
const membershipSelect = {
  id: true,
  code: true,
  memberId: true,
  channelId: true,
  status: true,
  requestedAt: true,
  approveAt: true,
  userChatId: true,
  inviteLinkId: true,
  approvalRuleId: true,
  source: true,
  remindersSent: true,
  approvedAt: true,
  joinedAt: true,
  member: { select: { telegramUserId: true } },
} as const;

function toMembership(
  m: { source: unknown; member?: { telegramUserId: bigint } | null } & Omit<
    MembershipInfo,
    "source" | "telegramUserId"
  >,
): MembershipInfo {
  const { member, ...rest } = m;
  return {
    ...rest,
    source: m.source && typeof m.source === "object" ? (m.source as Record<string, unknown>) : {},
    telegramUserId: member?.telegramUserId ?? null,
  };
}

/** Données d'une mise à jour de demande pour Prisma (source en JSON). */
function membershipData(data: MembershipUpdate) {
  const { source, ...rest } = data;
  return { ...rest, ...(source ? { source: toJsonValue(source) } : {}) };
}

/**
 * Dépendances Prisma du flux d'adhésion. `apiFor` : API d'un de nos bots (site et webhook : instance grammY en cache ;
 * worker : son propre cache d'API) ; `warn` : journal (console par défaut, logger du worker).
 */
export function createPrismaJoinFlowDeps(
  opts: {
    apiFor?: (botId: string) => Promise<GateLinkApi | null>;
    warn?: GateLinkDeps["warn"];
  } = {},
): JoinFlowDeps & {
  listPendingGates(input: { since: Date | null; limit: number }): Promise<PendingGateRow[]>;
} {
  return {
    // Liens des canaux à rejoindre : créés par n'importe lequel de nos bots administrateurs (gate-links.ts).
    ...createPrismaGateLinkDeps(opts),
    async upsertMember(from) {
      const m = await prisma.member.upsert({
        where: { telegramUserId: BigInt(from.id) },
        create: { telegramUserId: BigInt(from.id), ...memberData(from) },
        update: memberData(from),
        select: { id: true, languageCode: true, firstName: true },
      });
      return { memberId: m.id, languageCode: m.languageCode, firstName: m.firstName };
    },
    async findChannelByChatId(chatId) {
      return prisma.channel.findUnique({
        where: { telegramChatId: chatId },
        select: channelSelect,
      });
    },
    async getChannels(ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.channel.findMany({
        where: { id: { in: ids } },
        select: channelSelect,
      });
      return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is ChannelInfo => !!r);
    },
    async actingBotIdFor(channelId) {
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { primaryBotId: true, title: true },
      });
      // Phase 17 : un bot assistant de conversation n'agit jamais pour un canal.
      const admins = await prisma.channelBotAdmin.findMany({
        where: { channelId, revokedAt: null, bot: ACTIVE_CHANNEL_BOT_WHERE },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        select: { botId: true },
      });
      if (admins.length === 0) return null;
      const primary = channel?.primaryBotId && admins.find((a) => a.botId === channel.primaryBotId);
      if (primary) return { botId: primary.botId };
      const fallback = admins[0]!;
      return {
        botId: fallback.botId,
        warning: channel?.primaryBotId
          ? `bot principal non administrateur de « ${channel.title} », bot de secours utilisé`
          : undefined,
      };
    },
    async findInviteLinkByUrl(url) {
      const row = await prisma.inviteLink.findUnique({
        where: { telegramInviteLink: url },
        select: linkSelect,
      });
      return row ? (toLinkInfo(row) as InviteLinkInfo) : null;
    },
    async findInviteLinksByPrefix({ channelId, prefix, creatorTelegramId }) {
      // Lien masqué par Telegram : même canal, même bot créateur, même début (revérifié par `pickMaskedLink`).
      const rows = await prisma.inviteLink.findMany({
        where: {
          channelId,
          telegramInviteLink: { startsWith: prefix },
          bot: { telegramBotId: creatorTelegramId },
        },
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        take: 10,
        select: linkSelect,
      });
      return rows.map(toLinkInfo) as Array<InviteLinkInfo & { isActive: boolean }>;
    },
    // Règle selon la provenance (phase 11) : exception du lien, du canal d'origine, du type, sinon règle par défaut.
    resolveRule: (channelId, link) => resolveRuleWithDb(channelId, link),
    async createMembership(data) {
      const m = await prisma.membership.create({
        data: { ...data, source: toJsonValue(data.source) },
        select: { id: true },
      });
      return { id: m.id };
    },
    async updateMembership(id, data) {
      await prisma.membership.update({ where: { id }, data: membershipData(data) });
    },
    async updateMembershipIfStatus(id, expected, data) {
      // Écriture conditionnelle : une seule validation même si deux bots (ou le worker) vérifient en même temps.
      const r = await prisma.membership.updateMany({
        where: { id, status: expected },
        data: membershipData(data),
      });
      return r.count > 0;
    },
    async findPendingGateMemberships(memberId) {
      const rows = await prisma.membership.findMany({
        where: { memberId, status: "PENDING_GATE", channel: { isActive: true } },
        orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
        take: 50,
        select: membershipSelect,
      });
      return rows.map(toMembership);
    },
    async listPendingGates({ since, limit }) {
      const rows = await prisma.membership.findMany({
        where: {
          status: "PENDING_GATE",
          channel: { isActive: true },
          ...(since ? { requestedAt: { gte: since } } : {}),
        },
        orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
        take: Math.max(1, Math.min(limit, 5000)),
        select: membershipSelect,
      });
      return rows.map((r) => {
        const m = toMembership(r);
        return { ...m, telegramUserId: r.member.telegramUserId };
      });
    },
    async scheduleReminder({ membershipId, index, at }) {
      // Rappel à l'heure (moins de 5 minutes après la demande) : tâche différée, une seule par rappel.
      await enqueue(
        "approvals",
        { type: "reminder", membershipId },
        {
          jobId: `reminder:${membershipId}:${index}`,
          delay: Math.max(0, at.getTime() - Date.now()),
        },
      );
    },
    async botState(memberId, botId) {
      return prisma.memberBotState.findUnique({
        where: { memberId_botId: { memberId, botId } },
        select: { canDm: true, startedAt: true, blockedAt: true },
      });
    },
    async findMembershipByCode(code) {
      const m = await prisma.membership.findUnique({ where: { code }, select: membershipSelect });
      return m ? toMembership(m) : null;
    },
    async findLatestMembership(memberId, channelId) {
      const m = await prisma.membership.findFirst({
        where: { memberId, channelId },
        orderBy: { requestedAt: "desc" },
        select: membershipSelect,
      });
      return m ? toMembership(m) : null;
    },
    getRuleForMembership: (m) => ruleForMembershipWithDb(m),
    async lastWelcomeAt(memberId, botId) {
      // Accueil en file ou envoyé (un accueil en échec ou bloqué n'a pas été reçu : il ne compte pas).
      const last = await prisma.outboundMessage.findFirst({
        where: { memberId, botId, kind: "WELCOME", status: { in: ["QUEUED", "SENT"] } },
        orderBy: { queuedAt: "desc" },
        select: { queuedAt: true },
      });
      return last?.queuedAt ?? null;
    },
    async incrementInviteLink(id, field) {
      await prisma.inviteLink
        .update({ where: { id }, data: { [field]: { increment: 1 } } })
        .catch(() => undefined);
    },
    async findMembershipById(id) {
      const m = await prisma.membership.findUnique({ where: { id }, select: membershipSelect });
      return m ? toMembership(m) : null;
    },
    async getMember(memberId) {
      const m = await prisma.member.findUnique({
        where: { id: memberId },
        select: { id: true, languageCode: true, firstName: true, anonymizedAt: true },
      });
      if (!m || m.anonymizedAt) return null;
      return { memberId: m.id, languageCode: m.languageCode, firstName: m.firstName };
    },
    async getBotIdentity(botId) {
      // Phase 17 : jamais un bot assistant de conversation (il n'écrit pas pour les demandes d'adhésion).
      return prisma.bot.findFirst({
        where: { id: botId, ...ACTIVE_CHANNEL_BOT_WHERE },
        select: { id: true, name: true, username: true, telegramBotId: true, vertical: true },
      });
    },
    async canWriteTo(memberId, botId) {
      const st = await prisma.memberBotState.findUnique({
        where: { memberId_botId: { memberId, botId } },
        select: { canDm: true, startedAt: true, blockedAt: true },
      });
      return Boolean(st?.canDm && st.startedAt && !st.blockedAt);
    },
    async getSequenceText(channelId, botId, trigger) {
      const seq = await prisma.sequence.findFirst({
        where: {
          trigger,
          isActive: true,
          OR: [
            { channelId, botId },
            { channelId, botId: null },
            { channelId: null, botId },
            { channelId: null, botId: null },
          ],
        },
        orderBy: [{ channelId: "desc" }, { botId: "desc" }],
        include: { steps: { orderBy: { order: "asc" }, take: 1 } },
      });
      const step = seq?.steps[0];
      if (!step) return null;
      const texts =
        step.texts && typeof step.texts === "object" ? (step.texts as Record<string, string>) : {};
      const buttons = Array.isArray(step.buttons) ? (step.buttons as unknown[]) : [];
      return { texts, buttons, mediaAssetId: step.mediaAssetId ?? null };
    },
    async enqueueDm(input) {
      return enqueueDm({
        ...input,
        buttons: input.buttons,
        mediaAssetId: input.mediaAssetId ?? null,
      });
    },
    async setCanDm(memberId, botId, canDm) {
      await prisma.memberBotState.upsert({
        where: { memberId_botId: { memberId, botId } },
        create: {
          memberId,
          botId,
          canDm,
          startedAt: canDm ? new Date() : null,
          blockedAt: canDm ? null : new Date(),
        },
        update: {
          canDm,
          ...(canDm ? { startedAt: new Date(), blockedAt: null } : { blockedAt: new Date() }),
        },
      });
    },
    async recordEvent(input) {
      await recordEvent(input);
    },
    async emitAutomation(trigger, memberId, context) {
      await emitAutomationEvent(trigger, memberId, context);
    },
    async getMemberAffiliate(memberId) {
      const m = await prisma.member.findUnique({
        where: { id: memberId },
        select: {
          linkaffiCampaignKey: true,
          linkaffiAffiliateId: true,
          affiliateAttributionEndsAt: true,
        },
      });
      return m
        ? {
            campaignKey: m.linkaffiCampaignKey,
            affiliateId: m.linkaffiAffiliateId,
            attributionEndsAt: m.affiliateAttributionEndsAt,
          }
        : null;
    },
    async attributeAffiliate(input) {
      // Écriture conditionnelle : seulement un membre sans affilié (premier affilié gagne, même en cas de course).
      const r = await prisma.member.updateMany({
        where: {
          id: input.memberId,
          linkaffiCampaignKey: null,
          linkaffiAffiliateId: null,
          anonymizedAt: null,
        },
        data: {
          linkaffiCampaignKey: input.campaignKey,
          linkaffiAffiliateId: input.affiliateId,
          affiliateAttributedAt: input.attributedAt,
          affiliateAttributionEndsAt: input.endsAt,
          affiliateInviteLinkId: input.inviteLinkId,
        },
      });
      return r.count > 0;
    },
    async emitLinkaffiEvent(input) {
      return emitLinkaffiEvent(input);
    },
  };
}

/** Dépendances Prisma du flux d'adhésion pour le webhook et le site (API des bots : instances grammY en cache). */
export const prismaJoinFlowDeps = createPrismaJoinFlowDeps();
