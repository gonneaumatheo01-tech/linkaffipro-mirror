/**
 * Dépendances du flux d'adhésion (accès base et file d'attente), abstraites pour les tests.
 */
import type { InviteLinkKind, MembershipStatus, Prisma } from "@linkaffipro/db";
import type { User } from "grammy/types";
import type { RuleData } from "./rules";

export type ChannelInfo = { id: string; title: string; username: string | null; language: string; telegramChatId: bigint; primaryBotId: string | null };
export type InviteLinkInfo = { id: string; kind: InviteLinkKind; name: string; channelId: string; campaignId: string | null; adPlatform: string | null; adCampaignName: string | null; adName: string | null; sourceChannelId: string | null; telegramInviteLink: string };
export type MembershipInfo = {
  id: string;
  code: string;
  memberId: string;
  channelId: string;
  status: MembershipStatus;
  requestedAt: Date;
  approveAt: Date | null;
  userChatId: bigint | null;
  inviteLinkId: string | null;
  approvalRuleId: string | null;
  source: Record<string, unknown>;
  remindersSent: number;
};
export type GateButton = { channelId: string; title: string; url: string };
export type SequenceText = { texts: Record<string, string>; buttons: unknown[] } | null;

export interface JoinFlowDeps {
  upsertMember(from: User): Promise<{ memberId: string; languageCode: string | null; firstName: string | null }>;
  findChannelByChatId(chatId: bigint): Promise<ChannelInfo | null>;
  getChannels(ids: string[]): Promise<ChannelInfo[]>;
  /** Bot qui doit agir pour ce canal : bot principal s'il est administrateur, sinon le premier bot administrateur. */
  actingBotIdFor(channelId: string): Promise<{ botId: string; warning?: string } | null>;
  findInviteLinkByUrl(url: string): Promise<InviteLinkInfo | null>;
  resolveRule(channelId: string, inviteLinkId: string | null): Promise<RuleData>;
  createMembership(data: {
    code: string;
    memberId: string;
    channelId: string;
    status: MembershipStatus;
    inviteLinkId: string | null;
    approvalRuleId: string | null;
    userChatId: bigint | null;
    requestedAt: Date;
    approveAt: Date | null;
    expiresAt: Date | null;
    source: Record<string, unknown>;
  }): Promise<{ id: string }>;
  updateMembership(id: string, data: Partial<{ status: MembershipStatus; approveAt: Date | null; gateSatisfiedAt: Date; joinedAt: Date; leftAt: Date; source: Record<string, unknown>; remindersSent: number; lastReminderAt: Date }>): Promise<void>;
  findMembershipByCode(code: string): Promise<MembershipInfo | null>;
  /** Dernière demande ouverte ou approuvée d'un membre sur un canal. */
  findLatestMembership(memberId: string, channelId: string): Promise<MembershipInfo | null>;
  getRuleForMembership(m: MembershipInfo): Promise<RuleData>;
  incrementInviteLink(id: string, field: "requests" | "approved" | "joined" | "left"): Promise<void>;
  /** Lien GATE (canal source → canal requis) existant, ou création via `create` (createChatInviteLink). */
  findOrCreateGateLink(sourceChannelId: string, gate: ChannelInfo, botId: string, create: () => Promise<string | null>): Promise<string | null>;
  getSequenceText(channelId: string, botId: string, trigger: "JOIN_REQUEST" | "GATE_SATISFIED" | "APPROVED" | "GATE_REMINDER"): Promise<SequenceText>;
  enqueueDm(input: { botId: string; memberId: string; chatId: bigint | null; kind: "WELCOME" | "GATE_REMINDER" | "ACCEPTED"; text: string; buttons: Array<Array<{ text: string; url: string }>> }): Promise<void>;
  setCanDm(memberId: string, botId: string, canDm: boolean): Promise<void>;
  recordEvent(input: { type: string; memberId?: string | null; channelId?: string | null; botId?: string | null; payload?: Prisma.InputJsonValue }): Promise<void>;
  /** Le membre est-il dans le chat ? (getChatMember est appelé par le handler ; ici on isole pour les tests.) */
}
