/**
 * Logique du flux d'adhésion, indépendante de grammY (prend une API minimale et des deps).
 */
import { shortId } from "@linkaffipro/core";
import type { ChatJoinRequest, ChatMemberUpdated, User } from "grammy/types";
import type { BotIdentity } from "../ports";
import type { ChannelInfo, GateButton, JoinFlowDeps, MembershipInfo } from "./deps";
import { approveAtAfterGate, computeInitialState, formatDelay, hasGate, type RuleData } from "./rules";
import { baseLang, defaultText, pickText, renderText, type TextVars } from "./texts";

/** Sous-ensemble de l'API Telegram utilisé par le flux (facile à simuler). */
export interface JoinFlowApi {
  createChatInviteLink(chatId: number | string, other?: { name?: string }): Promise<{ invite_link: string }>;
  getChatMember(chatId: number | string, userId: number): Promise<{ status: string }>;
}

const GOOD_STATUSES = new Set(["member", "administrator", "creator", "restricted"]);

export type JoinFlowResult = { handled: boolean; reason?: string };

function vars(member: { firstName: string | null }, channel: ChannelInfo, rule: RuleData, identity: BotIdentity, gates: GateButton[]): TextVars {
  return {
    prenom: member.firstName ?? "",
    canal: channel.title,
    liste_canaux: gates.map((g) => g.title).join(", "),
    delai: formatDelay(rule.mode === "IMMEDIATE" ? 0 : rule.delaySeconds, "fr"),
    bot: `@${identity.username}`,
  };
}

function varsLang(v: TextVars, rule: RuleData, lang: "fr" | "en"): TextVars {
  return { ...v, delai: formatDelay(rule.mode === "IMMEDIATE" ? 0 : rule.delaySeconds, lang) };
}

/** Boutons d'accueil : un bouton par canal à rejoindre + « J'ai rejoint ». */
export function buildGateButtons(gates: GateButton[], startUrl: string, lang: "fr" | "en"): Array<Array<{ text: string; url: string }>> {
  const rows = gates.map((g) => [{ text: `${defaultText("joinLabel", lang)} ${g.title}`, url: g.url }]);
  rows.push([{ text: defaultText("joinedLabel", lang), url: startUrl }]);
  return rows;
}

export function startUrlFor(identity: BotIdentity, code: string): string {
  return `https://t.me/${identity.username}?start=g${code}`;
}

/** Résout les boutons des canaux à rejoindre (liens GATE créés au besoin). */
export async function resolveGateButtons(api: JoinFlowApi, deps: JoinFlowDeps, sourceChannel: ChannelInfo, rule: RuleData, botId: string): Promise<GateButton[]> {
  if (!hasGate(rule)) return [];
  const gates = await deps.getChannels(rule.gateChannelIds.filter((id) => id !== sourceChannel.id));
  const out: GateButton[] = [];
  for (const g of gates) {
    const url = await deps.findOrCreateGateLink(sourceChannel.id, g, botId, async () => {
      try {
        const link = await api.createChatInviteLink(Number(g.telegramChatId), { name: `gate ${sourceChannel.title}`.slice(0, 32) });
        return link.invite_link;
      } catch {
        return null;
      }
    });
    if (url) out.push({ channelId: g.id, title: g.title, url });
  }
  return out;
}

async function sendSequenceOrDefault(
  deps: JoinFlowDeps,
  opts: { channel: ChannelInfo; botId: string; memberId: string; chatId: bigint | null; memberLang: string | null; kind: "WELCOME" | "GATE_REMINDER" | "ACCEPTED"; trigger: "JOIN_REQUEST" | "GATE_SATISFIED" | "APPROVED" | "GATE_REMINDER"; fallbackKey: Parameters<typeof defaultText>[0]; vars: TextVars; buttons: Array<Array<{ text: string; url: string }>>; rule: RuleData },
): Promise<void> {
  const seq = await deps.getSequenceText(opts.channel.id, opts.botId, opts.trigger);
  const lang = baseLang(opts.memberLang ?? opts.channel.language);
  const template = pickText(seq?.texts, opts.memberLang, opts.channel.language) ?? defaultText(opts.fallbackKey, lang);
  const text = renderText(template, varsLang(opts.vars, opts.rule, lang));
  await deps.enqueueDm({ botId: opts.botId, memberId: opts.memberId, chatId: opts.chatId, kind: opts.kind, text, buttons: opts.buttons });
}

/** Traite une demande d'adhésion reçue par le bot `identity`. */
export async function handleJoinRequest(api: JoinFlowApi, identity: BotIdentity, deps: JoinFlowDeps, req: ChatJoinRequest): Promise<JoinFlowResult> {
  const channel = await deps.findChannelByChatId(BigInt(req.chat.id));
  if (!channel) return { handled: false, reason: "canal inconnu" };
  const acting = await deps.actingBotIdFor(channel.id);
  if (!acting) return { handled: false, reason: "aucun bot administrateur" };
  if (acting.botId !== identity.id) return { handled: false, reason: "un autre bot agit pour ce canal" };
  if (acting.warning) console.warn("[join-flow]", acting.warning);

  const member = await deps.upsertMember(req.from);
  const link = req.invite_link?.invite_link ? await deps.findInviteLinkByUrl(req.invite_link.invite_link) : null;
  const rule = await deps.resolveRule(channel.id, link?.id ?? null);
  const requestedAt = new Date(req.date * 1000);
  const initial = computeInitialState(rule, requestedAt);
  const code = shortId();
  const userChatId = req.user_chat_id ? BigInt(req.user_chat_id) : null;

  const gates = await resolveGateButtons(api, deps, channel, rule, identity.id);
  const startUrl = startUrlFor(identity, code);
  const source: Record<string, unknown> = {
    inviteLink: link ? { id: link.id, name: link.name, kind: link.kind, campaignId: link.campaignId, adPlatform: link.adPlatform, adCampaignName: link.adCampaignName, adName: link.adName } : null,
    telegramInviteLink: req.invite_link?.invite_link ?? null,
    rule: { id: rule.id, name: rule.name, mode: rule.mode, delaySeconds: rule.delaySeconds, gateMode: rule.gateMode },
    gates,
    startUrl,
    botId: identity.id,
  };
  const { id: membershipId } = await deps.createMembership({
    code,
    memberId: member.memberId,
    channelId: channel.id,
    status: initial.status,
    inviteLinkId: link?.id ?? null,
    approvalRuleId: rule.id,
    userChatId,
    requestedAt,
    approveAt: initial.approveAt,
    expiresAt: initial.expiresAt,
    source,
  });
  if (link) await deps.incrementInviteLink(link.id, "requests");
  await deps.recordEvent({ type: "membership.requested", memberId: member.memberId, channelId: channel.id, botId: identity.id, payload: { membershipId, code, status: initial.status, inviteLinkId: link?.id ?? null, ruleId: rule.id } });

  // Message d'accueil immédiat (via la file ; un échec d'envoi est géré par le worker : canDm=false, dm.failed).
  const v = vars(member, channel, rule, identity, gates);
  const gateActive = hasGate(rule) && gates.length > 0;
  const fallbackKey = gateActive ? (rule.gateMode === "REQUIRED" ? "joinRequestGate" : "joinRequestSoft") : "joinRequestPlain";
  const lang = baseLang(member.languageCode ?? channel.language);
  const buttons = gateActive ? buildGateButtons(gates, startUrl, lang) : [];
  await sendSequenceOrDefault(deps, { channel, botId: identity.id, memberId: member.memberId, chatId: userChatId, memberLang: member.languageCode, kind: "WELCOME", trigger: "JOIN_REQUEST", fallbackKey, vars: v, buttons, rule });
  return { handled: true };
}

/** Traite `/start g<code>` : vérifie les canaux requis puis planifie l'approbation. Retourne le texte de réponse. */
export async function handleGateStart(api: JoinFlowApi, identity: BotIdentity, deps: JoinFlowDeps, from: User, code: string): Promise<{ text: string; buttons: Array<Array<{ text: string; url: string }>> }> {
  const member = await deps.upsertMember(from);
  await deps.setCanDm(member.memberId, identity.id, true);
  const lang = baseLang(member.languageCode);
  const m = await deps.findMembershipByCode(code);
  if (!m || m.memberId !== member.memberId) return { text: defaultText("unknownCode", lang), buttons: [] };
  const [channel] = await deps.getChannels([m.channelId]);
  if (!channel) return { text: defaultText("unknownCode", lang), buttons: [] };
  const rule = await deps.getRuleForMembership(m);
  const gates = (Array.isArray(m.source.gates) ? (m.source.gates as GateButton[]) : []) ?? [];
  const startUrl = typeof m.source.startUrl === "string" ? m.source.startUrl : startUrlFor(identity, m.code);
  const v = varsLang(vars(member, channel, rule, identity, gates), rule, lang);

  if (m.status === "APPROVED") return { text: renderText(defaultText("approved", lang), v), buttons: [] };
  if (m.status === "SCHEDULED") return { text: renderText(defaultText("gateSatisfied", lang), { ...v, delai: formatDelay(Math.max(0, Math.round(((m.approveAt?.getTime() ?? Date.now()) - Date.now()) / 1000)), lang) }), buttons: [] };
  if (m.status !== "PENDING_GATE" && m.status !== "REQUESTED") return { text: defaultText("unknownCode", lang), buttons: [] };

  // Vérification des canaux requis.
  const required = await deps.getChannels(rule.gateChannelIds.filter((id) => id !== channel.id));
  const missing: ChannelInfo[] = [];
  for (const g of required) {
    try {
      const cm = await api.getChatMember(Number(g.telegramChatId), from.id);
      if (!GOOD_STATUSES.has(cm.status)) missing.push(g);
    } catch {
      missing.push(g);
    }
  }
  if (missing.length > 0) {
    const missingGates = gates.filter((g) => missing.some((c) => c.id === g.channelId));
    const list = missing.map((c) => c.title).join(", ");
    return { text: renderText(defaultText("gateMissing", lang), { ...v, liste_canaux: list }), buttons: buildGateButtons(missingGates.length ? missingGates : gates, startUrl, lang) };
  }
  const now = new Date();
  const approveAt = approveAtAfterGate(rule, now);
  if (m.status === "PENDING_GATE" || rule.mode !== "MANUAL") {
    await deps.updateMembership(m.id, { status: "SCHEDULED", gateSatisfiedAt: now, approveAt });
  } else {
    await deps.updateMembership(m.id, { gateSatisfiedAt: now });
  }
  await deps.recordEvent({ type: "membership.gate_satisfied", memberId: m.memberId, channelId: channel.id, botId: identity.id, payload: { membershipId: m.id, approveAt: approveAt.toISOString() } });
  const seq = await deps.getSequenceText(channel.id, identity.id, "GATE_SATISFIED");
  const template = pickText(seq?.texts, member.languageCode, channel.language) ?? defaultText("gateSatisfied", lang);
  return { text: renderText(template, { ...v, delai: formatDelay(Math.round((approveAt.getTime() - now.getTime()) / 1000), lang) }), buttons: [] };
}

/** Traite `chat_member` : entrée effective, départ, exclusion. */
export async function handleChatMember(identity: BotIdentity, deps: JoinFlowDeps, upd: ChatMemberUpdated): Promise<JoinFlowResult> {
  if (upd.chat.type === "private") return { handled: false };
  const channel = await deps.findChannelByChatId(BigInt(upd.chat.id));
  if (!channel) return { handled: false, reason: "canal inconnu" };
  const user = upd.new_chat_member.user;
  if (user.is_bot) return { handled: false };
  const acting = await deps.actingBotIdFor(channel.id);
  if (acting && acting.botId !== identity.id) return { handled: false, reason: "un autre bot agit pour ce canal" };
  const member = await deps.upsertMember(user);
  const oldOk = GOOD_STATUSES.has(upd.old_chat_member.status);
  const newStatus = upd.new_chat_member.status;
  const newOk = GOOD_STATUSES.has(newStatus);
  const now = new Date(upd.date * 1000);
  const latest = await deps.findLatestMembership(member.memberId, channel.id);
  const viaLink = upd.invite_link?.invite_link ?? null;

  if (!oldOk && newOk) {
    const link = viaLink ? await deps.findInviteLinkByUrl(viaLink) : null;
    if (link) await deps.incrementInviteLink(link.id, "joined");
    if (latest && (latest.status === "APPROVED" || latest.status === "SCHEDULED" || latest.status === "PENDING_GATE" || latest.status === "REQUESTED")) {
      await deps.updateMembership(latest.id, { status: "APPROVED", joinedAt: now });
    } else {
      await deps.createMembership({ code: shortId(), memberId: member.memberId, channelId: channel.id, status: "APPROVED", inviteLinkId: link?.id ?? null, approvalRuleId: null, userChatId: null, requestedAt: now, approveAt: null, expiresAt: null, source: { joinedDirectly: true, telegramInviteLink: viaLink, gateFromChannelId: link?.sourceChannelId ?? null } });
    }
    await deps.recordEvent({ type: "membership.joined", memberId: member.memberId, channelId: channel.id, botId: identity.id, payload: { inviteLink: viaLink, inviteLinkId: link?.id ?? null, gateFromChannelId: link?.sourceChannelId ?? null } });
    return { handled: true };
  }
  if (oldOk && !newOk) {
    const kicked = newStatus === "kicked";
    if (latest && latest.status !== "LEFT" && latest.status !== "KICKED") await deps.updateMembership(latest.id, { status: kicked ? "KICKED" : "LEFT", leftAt: now });
    if (latest?.inviteLinkId) await deps.incrementInviteLink(latest.inviteLinkId, "left");
    await deps.recordEvent({ type: kicked ? "membership.kicked" : "membership.left", memberId: member.memberId, channelId: channel.id, botId: identity.id, payload: { membershipId: latest?.id ?? null } });
    return { handled: true };
  }
  return { handled: false };
}

/** Index pratique (pour le worker et l'interface) : échéance d'un rappel. */
export { dueReminderIndex, expirationOutcome, OPEN_STATUSES } from "./rules";
export type { MembershipInfo };
