/**
 * Logique du flux d'adhésion, indépendante de grammY (prend une API minimale et des deps).
 */
import { shortId } from "@linkaffipro/core";
import type { ChatJoinRequest, ChatMemberUpdated, User } from "grammy/types";
import type { BotIdentity } from "../ports";
import type { ChannelInfo, GateButton, JoinFlowDeps, MembershipInfo } from "./deps";
import {
  checkGateMembership,
  gateButtonsOf,
  gateCheckProblemsOf,
  gateProblemsOf,
  resolveGateLinks,
  sameGateChannels,
  type FirstBot,
  type GateLinkApi,
  type GateLinkProblem,
  type GateLinksResult,
} from "./gate-links";
import {
  approveAtAfterGate,
  computeInitialState,
  formatDelay,
  hasGate,
  isNoRule,
  OPEN_STATUSES,
  type RuleData,
} from "./rules";
import { baseLang, defaultText, pickText, renderHtmlText, type Lang, type TextVars } from "./texts";

/** Sous-ensemble de l'API Telegram utilisé par le flux (facile à simuler). */
export type JoinFlowApi = GateLinkApi;

const GOOD_STATUSES = new Set(["member", "administrator", "creator", "restricted"]);

/** Fenêtre pendant laquelle Telegram laisse le bot écrire après une demande d'adhésion (`user_chat_id`). */
export const JOIN_REQUEST_DM_WINDOW_MS = 5 * 60_000;

export type JoinFlowResult = { handled: boolean; reason?: string };

function vars(
  member: { firstName: string | null },
  channel: ChannelInfo,
  rule: RuleData,
  identity: Pick<BotIdentity, "username">,
  gateTitles: string[],
): TextVars {
  return {
    prenom: member.firstName ?? "",
    canal: channel.title,
    liste_canaux: gateTitles.join(", "),
    delai: formatDelay(rule.mode === "IMMEDIATE" ? 0 : rule.delaySeconds, "fr"),
    bot: `@${identity.username}`,
  };
}

function varsLang(v: TextVars, rule: RuleData, lang: Lang): TextVars {
  return { ...v, delai: formatDelay(rule.mode === "IMMEDIATE" ? 0 : rule.delaySeconds, lang) };
}

/** Boutons d'accueil : un bouton par canal à rejoindre + « J'ai rejoint ». */
export function buildGateButtons(
  gates: GateButton[],
  startUrl: string,
  lang: Lang,
): Array<Array<{ text: string; url: string }>> {
  const rows = gates.map((g) => [
    { text: `${defaultText("joinLabel", lang)} ${g.title}`, url: g.url },
  ]);
  rows.push([{ text: defaultText("joinedLabel", lang), url: startUrl }]);
  return rows;
}

export function startUrlFor(identity: Pick<BotIdentity, "username">, code: string): string {
  return `https://t.me/${identity.username}?start=g${code}`;
}

/** Canaux à rejoindre d'une règle (sans le canal source), dans l'ordre de la règle. */
export async function gateChannelsOf(
  deps: Pick<JoinFlowDeps, "getChannels">,
  rule: RuleData,
  sourceChannelId: string,
): Promise<ChannelInfo[]> {
  if (!hasGate(rule)) return [];
  return deps.getChannels(rule.gateChannelIds.filter((id) => id !== sourceChannelId));
}

/**
 * Résout les liens des canaux à rejoindre : lien GATE existant, sinon création par le bot qui traite la demande puis
 * par chacun de nos bots administrateurs du canal à rejoindre (gate-links.ts). Les canaux restés sans lien sont
 * renvoyés dans `missing`, avec l'erreur exacte de Telegram.
 */
export async function resolveGateButtons(
  api: JoinFlowApi,
  deps: JoinFlowDeps,
  sourceChannel: ChannelInfo,
  rule: RuleData,
  identity: Pick<BotIdentity, "id" | "username">,
): Promise<GateLinksResult> {
  const gates = await gateChannelsOf(deps, rule, sourceChannel.id);
  const first: FirstBot = { botId: identity.id, username: identity.username, api };
  return resolveGateLinks(deps, sourceChannel, gates, first);
}

/** Journalise les canaux à rejoindre restés sans lien (événement + journal du serveur). */
async function recordGateLinksMissing(
  deps: JoinFlowDeps,
  input: {
    membershipId: string;
    memberId: string;
    channelId: string;
    botId: string;
    stage: "welcome" | "start" | "resend";
    missing: GateLinkProblem[];
  },
): Promise<void> {
  if (input.missing.length === 0) return;
  console.warn("[join-flow] accueil sans certains liens de canaux à rejoindre", {
    membershipId: input.membershipId,
    stage: input.stage,
    missing: input.missing.map((p) => ({ channel: p.title, error: p.error })),
  });
  await deps.recordEvent({
    type: "membership.gate_links_missing",
    memberId: input.memberId,
    channelId: input.channelId,
    botId: input.botId,
    payload: {
      membershipId: input.membershipId,
      stage: input.stage,
      missing: input.missing.map((p) => ({
        channelId: p.channelId,
        title: p.title,
        error: p.error,
        tried: p.tried,
        suggestedBot: p.suggestedBot,
      })),
    },
  });
}

async function sendSequenceOrDefault(
  deps: JoinFlowDeps,
  opts: {
    channel: ChannelInfo;
    botId: string;
    memberId: string;
    chatId: bigint | null;
    memberLang: string | null;
    kind: "WELCOME" | "GATE_REMINDER" | "ACCEPTED";
    trigger: "JOIN_REQUEST" | "GATE_SATISFIED" | "APPROVED" | "GATE_REMINDER";
    fallbackKey: Parameters<typeof defaultText>[0];
    vars: TextVars;
    buttons: Array<Array<{ text: string; url: string }>>;
    rule: RuleData;
  },
): Promise<void> {
  const seq = await deps.getSequenceText(opts.channel.id, opts.botId, opts.trigger);
  const lang = baseLang(opts.memberLang ?? opts.channel.language);
  const template =
    pickText(seq?.texts, opts.memberLang, opts.channel.language) ??
    defaultText(opts.fallbackKey, lang);
  const text = renderHtmlText(template, varsLang(opts.vars, opts.rule, lang));
  await deps.enqueueDm({
    botId: opts.botId,
    memberId: opts.memberId,
    chatId: opts.chatId,
    kind: opts.kind,
    text,
    buttons: opts.buttons,
    mediaAssetId: seq?.mediaAssetId ?? null,
  });
}

/** Traite une demande d'adhésion reçue par le bot `identity`. */
export async function handleJoinRequest(
  api: JoinFlowApi,
  identity: BotIdentity,
  deps: JoinFlowDeps,
  req: ChatJoinRequest,
): Promise<JoinFlowResult> {
  const channel = await deps.findChannelByChatId(BigInt(req.chat.id));
  if (!channel) return { handled: false, reason: "canal inconnu" };
  // Canal désactivé par l'équipe (case « Actif ») : le flux d'adhésion l'ignore (ni acceptation, ni message privé).
  if (!channel.isActive) return { handled: false, reason: "canal inactif" };
  const acting = await deps.actingBotIdFor(channel.id);
  if (!acting) return { handled: false, reason: "aucun bot administrateur" };
  if (acting.botId !== identity.id)
    return { handled: false, reason: "un autre bot agit pour ce canal" };
  if (acting.warning) console.warn("[join-flow]", acting.warning);

  const member = await deps.upsertMember(req.from);
  const link = req.invite_link?.invite_link
    ? await deps.findInviteLinkByUrl(req.invite_link.invite_link)
    : null;
  const rule = await deps.resolveRule(channel.id, link?.id ?? null);
  const requestedAt = new Date(req.date * 1000);
  const initial = computeInitialState(rule, requestedAt);
  const code = shortId();
  const userChatId = req.user_chat_id ? BigInt(req.user_chat_id) : null;

  const gateChannels = await gateChannelsOf(deps, rule, channel.id);
  const { gates, missing } = await resolveGateLinks(deps, channel, gateChannels, {
    botId: identity.id,
    username: identity.username,
    api,
  });
  const startUrl = startUrlFor(identity, code);
  const source: Record<string, unknown> = {
    inviteLink: link
      ? {
          id: link.id,
          name: link.name,
          kind: link.kind,
          campaignId: link.campaignId,
          adPlatform: link.adPlatform,
          adCampaignName: link.adCampaignName,
          adName: link.adName,
        }
      : null,
    telegramInviteLink: req.invite_link?.invite_link ?? null,
    rule: {
      id: rule.id,
      name: rule.name,
      mode: rule.mode,
      delaySeconds: rule.delaySeconds,
      gateMode: rule.gateMode,
    },
    gates,
    // Canaux à rejoindre restés sans lien : point « À faire » de l'accueil, alerte, bouton « Renvoyer l'accueil ».
    gateLinksMissing: missing,
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
  await deps.recordEvent({
    type: "membership.requested",
    memberId: member.memberId,
    channelId: channel.id,
    botId: identity.id,
    payload: {
      membershipId,
      code,
      status: initial.status,
      inviteLinkId: link?.id ?? null,
      ruleId: rule.id,
    },
  });

  await recordGateLinksMissing(deps, {
    membershipId,
    memberId: member.memberId,
    channelId: channel.id,
    botId: identity.id,
    stage: "welcome",
    missing,
  });

  // Canal pas encore réglé (aucune règle) : la demande attend une validation manuelle, sans message privé au membre.
  if (isNoRule(rule)) return { handled: true };

  // Message d'accueil immédiat (via la file ; un échec d'envoi est géré par le worker : canDm=false, dm.failed).
  await sendWelcome(deps, {
    channel,
    identity,
    member,
    chatId: userChatId,
    rule,
    gateChannels,
    gates,
    startUrl,
  });
  return { handled: true };
}

/**
 * Message d'accueil (texte de « Ce que dit le bot » ou texte intégré) : avec des canaux à rejoindre, un bouton par
 * canal dont le lien existe et TOUJOURS le bouton « ✅ J'ai rejoint » (jamais un accueil muet sans boutons) ;
 * `{liste_canaux}` nomme tous les canaux de la règle, même ceux restés sans lien.
 */
async function sendWelcome(
  deps: JoinFlowDeps,
  input: {
    channel: ChannelInfo;
    identity: Pick<BotIdentity, "id" | "username">;
    member: { memberId: string; languageCode: string | null; firstName: string | null };
    chatId: bigint | null;
    rule: RuleData;
    gateChannels: ChannelInfo[];
    gates: GateButton[];
    startUrl: string;
  },
): Promise<void> {
  const { channel, identity, member, rule } = input;
  const gateActive = hasGate(rule);
  const v = vars(
    member,
    channel,
    rule,
    identity,
    input.gateChannels.map((c) => c.title),
  );
  const fallbackKey = gateActive
    ? rule.gateMode === "REQUIRED"
      ? "joinRequestGate"
      : "joinRequestSoft"
    : "joinRequestPlain";
  const lang = baseLang(member.languageCode ?? channel.language);
  const buttons = gateActive ? buildGateButtons(input.gates, input.startUrl, lang) : [];
  await sendSequenceOrDefault(deps, {
    channel,
    botId: identity.id,
    memberId: member.memberId,
    chatId: input.chatId,
    memberLang: member.languageCode,
    kind: "WELCOME",
    trigger: "JOIN_REQUEST",
    fallbackKey,
    vars: v,
    buttons,
    rule,
  });
}

/** Traite `/start g<code>` : vérifie les canaux requis puis planifie l'approbation. Retourne le texte de réponse. */
export async function handleGateStart(
  api: JoinFlowApi,
  identity: BotIdentity,
  deps: JoinFlowDeps,
  from: User,
  code: string,
): Promise<{ text: string; buttons: Array<Array<{ text: string; url: string }>> }> {
  const member = await deps.upsertMember(from);
  await deps.setCanDm(member.memberId, identity.id, true);
  const lang = baseLang(member.languageCode);
  const m = await deps.findMembershipByCode(code);
  if (!m || m.memberId !== member.memberId)
    return { text: defaultText("unknownCode", lang), buttons: [] };
  const [channel] = await deps.getChannels([m.channelId]);
  if (!channel) return { text: defaultText("unknownCode", lang), buttons: [] };
  const rule = await deps.getRuleForMembership(m);
  const gates = gateButtonsOf(m.source);
  const startUrl =
    typeof m.source.startUrl === "string" ? m.source.startUrl : startUrlFor(identity, m.code);
  const v = varsLang(
    vars(
      member,
      channel,
      rule,
      identity,
      gates.map((g) => g.title),
    ),
    rule,
    lang,
  );

  if (m.status === "APPROVED")
    return { text: renderHtmlText(defaultText("approved", lang), v), buttons: [] };
  if (m.status === "SCHEDULED")
    return {
      text: renderHtmlText(defaultText("gateSatisfied", lang), {
        ...v,
        delai: formatDelay(
          Math.max(0, Math.round(((m.approveAt?.getTime() ?? Date.now()) - Date.now()) / 1000)),
          lang,
        ),
      }),
      buttons: [],
    };
  if (m.status !== "PENDING_GATE" && m.status !== "REQUESTED")
    return { text: defaultText("unknownCode", lang), buttons: [] };

  // Vérification des canaux requis : par nos bots administrateurs du canal, puis par le bot qui traite la demande.
  const required = await gateChannelsOf(deps, rule, channel.id);
  const first: FirstBot = { botId: identity.id, username: identity.username, api };
  const check = await checkGateMembership(deps, required, from.id, first);
  if (check.unverified.length > 0)
    await deps.recordEvent({
      type: "membership.gate_check_failed",
      memberId: m.memberId,
      channelId: channel.id,
      botId: identity.id,
      payload: { membershipId: m.id, unverified: check.unverified },
    });
  // Canaux obligatoires qu'aucun de nos bots ne peut vérifier : la personne resterait bloquée en silence. La demande
  // est marquée (`source.gateCheckFailed` : point « À faire », alerte, « Renvoyer l'accueil »), effacée une fois vérifiée.
  let source: Record<string, unknown> = m.source;
  let sourceChanged = false;
  const checkFailed: GateLinkProblem[] =
    rule.gateMode === "REQUIRED"
      ? check.unverified.map((u) => ({
          channelId: u.channelId,
          title: u.title,
          error: u.error,
          tried: u.tried,
          suggestedBot: identity.username,
          reason: "cannot_verify" as const,
        }))
      : [];
  if (!sameGateChannels(gateCheckProblemsOf(m.source), checkFailed)) {
    source = { ...source, gateCheckFailed: checkFailed };
    sourceChanged = true;
  }
  if (check.missing.length > 0) {
    // Liens manquants à l'accueil (droits corrigés depuis ?) : recalculés maintenant pour les canaux encore à rejoindre.
    let known = gates;
    const lacking = check.missing.filter((c) => !gates.some((g) => g.channelId === c.id));
    if (lacking.length > 0) {
      const r = await resolveGateLinks(deps, channel, lacking, first);
      known = [...gates, ...r.gates];
      const stillMissing = r.missing;
      const before = gateProblemsOf(m.source);
      const fixed = r.gates.length > 0;
      if (fixed || !sameGateChannels(before, stillMissing)) {
        source = { ...source, gates: known, gateLinksMissing: stillMissing };
        sourceChanged = true;
      }
      if (stillMissing.length > 0 && before.length === 0)
        await recordGateLinksMissing(deps, {
          membershipId: m.id,
          memberId: m.memberId,
          channelId: channel.id,
          botId: identity.id,
          stage: "start",
          missing: stillMissing,
        });
    }
    if (sourceChanged) await deps.updateMembership(m.id, { source });
    const missingGates = known.filter((g) => check.missing.some((c) => c.id === g.channelId));
    const list = check.missing.map((c) => c.title).join(", ");
    return {
      text: renderHtmlText(defaultText("gateMissing", lang), { ...v, liste_canaux: list }),
      buttons: buildGateButtons(missingGates, startUrl, lang),
    };
  }
  const now = new Date();
  const approveAt = approveAtAfterGate(rule, now);
  // Canaux rejoints : les liens qui manquaient ne servent plus (le point « À faire » de cette demande disparaît).
  if (gateProblemsOf(source).length > 0) {
    source = { ...source, gateLinksMissing: [] };
    sourceChanged = true;
  }
  const cleared = sourceChanged ? { source } : {};
  if (m.status === "PENDING_GATE" || rule.mode !== "MANUAL") {
    await deps.updateMembership(m.id, {
      status: "SCHEDULED",
      gateSatisfiedAt: now,
      approveAt,
      ...cleared,
    });
  } else {
    await deps.updateMembership(m.id, { gateSatisfiedAt: now, ...cleared });
  }
  await deps.recordEvent({
    type: "membership.gate_satisfied",
    memberId: m.memberId,
    channelId: channel.id,
    botId: identity.id,
    payload: { membershipId: m.id, approveAt: approveAt.toISOString() },
  });
  const seq = await deps.getSequenceText(channel.id, identity.id, "GATE_SATISFIED");
  const template =
    pickText(seq?.texts, member.languageCode, channel.language) ??
    defaultText("gateSatisfied", lang);
  return {
    text: renderHtmlText(template, {
      ...v,
      delai: formatDelay(Math.round((approveAt.getTime() - now.getTime()) / 1000), lang),
    }),
    buttons: [],
  };
}

/** Traite `chat_member` : entrée effective, départ, exclusion. */
export async function handleChatMember(
  identity: BotIdentity,
  deps: JoinFlowDeps,
  upd: ChatMemberUpdated,
): Promise<JoinFlowResult> {
  if (upd.chat.type === "private") return { handled: false };
  const channel = await deps.findChannelByChatId(BigInt(upd.chat.id));
  if (!channel) return { handled: false, reason: "canal inconnu" };
  if (!channel.isActive) return { handled: false, reason: "canal inactif" };
  const user = upd.new_chat_member.user;
  if (user.is_bot) return { handled: false };
  const acting = await deps.actingBotIdFor(channel.id);
  if (acting && acting.botId !== identity.id)
    return { handled: false, reason: "un autre bot agit pour ce canal" };
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
    if (
      latest &&
      (latest.status === "APPROVED" ||
        latest.status === "SCHEDULED" ||
        latest.status === "PENDING_GATE" ||
        latest.status === "REQUESTED")
    ) {
      await deps.updateMembership(latest.id, { status: "APPROVED", joinedAt: now });
    } else {
      await deps.createMembership({
        code: shortId(),
        memberId: member.memberId,
        channelId: channel.id,
        status: "APPROVED",
        inviteLinkId: link?.id ?? null,
        approvalRuleId: null,
        userChatId: null,
        requestedAt: now,
        approveAt: null,
        expiresAt: null,
        source: {
          joinedDirectly: true,
          telegramInviteLink: viaLink,
          gateFromChannelId: link?.sourceChannelId ?? null,
        },
      });
    }
    await deps.recordEvent({
      type: "membership.joined",
      memberId: member.memberId,
      channelId: channel.id,
      botId: identity.id,
      payload: {
        inviteLink: viaLink,
        inviteLinkId: link?.id ?? null,
        gateFromChannelId: link?.sourceChannelId ?? null,
      },
    });
    await deps.emitAutomation?.("JOINED", member.memberId, {
      channelId: channel.id,
      inviteLinkId: link?.id ?? latest?.inviteLinkId ?? null,
      botId: identity.id,
    });
    return { handled: true };
  }
  if (oldOk && !newOk) {
    const kicked = newStatus === "kicked";
    if (latest && latest.status !== "LEFT" && latest.status !== "KICKED")
      await deps.updateMembership(latest.id, { status: kicked ? "KICKED" : "LEFT", leftAt: now });
    if (latest?.inviteLinkId) await deps.incrementInviteLink(latest.inviteLinkId, "left");
    await deps.recordEvent({
      type: kicked ? "membership.kicked" : "membership.left",
      memberId: member.memberId,
      channelId: channel.id,
      botId: identity.id,
      payload: { membershipId: latest?.id ?? null },
    });
    if (!kicked)
      await deps.emitAutomation?.("LEFT", member.memberId, {
        channelId: channel.id,
        inviteLinkId: latest?.inviteLinkId ?? null,
        botId: identity.id,
      });
    return { handled: true };
  }
  return { handled: false };
}

export type ResendWelcomeOutcome =
  /** Accueil renvoyé avec tous les liens. */
  | { status: "sent"; gates: number }
  /** Liens prêts, mais Telegram ne laisse plus le bot écrire en premier : le membre les aura avec « ✅ J'ai rejoint ». */
  | { status: "links_ready"; gates: number }
  /** Des liens restent impossibles à créer : rien n'est envoyé. */
  | { status: "still_missing"; missing: GateLinkProblem[] }
  /** La demande n'est plus en attente (acceptée, refusée, expirée…) ou n'a plus de canaux à rejoindre : rien n'est envoyé. */
  | { status: "not_pending" }
  | { status: "not_found" }
  /** Aucun de nos bots ne peut écrire pour ce canal. */
  | { status: "no_bot" };

/** Marque « vérification impossible » effacée (seulement si la demande en portait une). */
function clearedCheck(source: Record<string, unknown>): { gateCheckFailed?: [] } {
  return "gateCheckFailed" in source ? { gateCheckFailed: [] } : {};
}

/**
 * Canaux obligatoires marqués « vérification impossible » toujours sans aucun de nos bots administrateurs : renvoyer
 * l'accueil ne servirait à rien (le « ✅ J'ai rejoint » échouerait encore).
 */
async function stillUnverifiable(
  deps: JoinFlowDeps,
  source: Record<string, unknown>,
  gateChannels: readonly ChannelInfo[],
  rule: RuleData,
): Promise<GateLinkProblem[]> {
  if (rule.gateMode !== "REQUIRED") return [];
  const out: GateLinkProblem[] = [];
  for (const p of gateCheckProblemsOf(source)) {
    if (!gateChannels.some((c) => c.id === p.channelId)) continue;
    if ((await deps.adminBots(p.channelId)).length === 0) out.push(p);
  }
  return out;
}

/**
 * « Renvoyer l'accueil avec les liens » (bouton de l'équipe, jamais automatique) : recrée les liens des canaux à
 * rejoindre, puis renvoie l'accueil par la file (`enqueueDm`) si TOUS les liens existent et si le bot peut encore
 * écrire au membre. Rien n'est envoyé pour une demande qui n'est plus en attente.
 */
export async function resendGateWelcome(
  deps: JoinFlowDeps,
  membershipId: string,
  opts: { byUserId?: string | null; now?: Date } = {},
): Promise<ResendWelcomeOutcome> {
  const now = opts.now ?? new Date();
  const m = await deps.findMembershipById(membershipId);
  if (!m) return { status: "not_found" };
  if (!OPEN_STATUSES.includes(m.status)) return { status: "not_pending" };
  const [channel] = await deps.getChannels([m.channelId]);
  if (!channel) return { status: "not_found" };
  const rule = await deps.getRuleForMembership(m);
  if (!hasGate(rule)) {
    if (gateProblemsOf(m.source).length > 0 || gateCheckProblemsOf(m.source).length > 0)
      await deps.updateMembership(m.id, {
        source: { ...m.source, gateLinksMissing: [], ...clearedCheck(m.source) },
      });
    return { status: "not_pending" };
  }
  const sourceBotId = typeof m.source.botId === "string" ? m.source.botId : null;
  const botId = sourceBotId ?? (await deps.actingBotIdFor(channel.id))?.botId ?? null;
  const identity = botId ? await deps.getBotIdentity(botId) : null;
  const api = identity ? await deps.apiFor(identity.id) : null;
  if (!identity || !api) return { status: "no_bot" };

  const gateChannels = await gateChannelsOf(deps, rule, channel.id);
  const { gates, missing } = await resolveGateLinks(deps, channel, gateChannels, {
    botId: identity.id,
    username: identity.username,
    api,
  });
  const unverifiable = await stillUnverifiable(deps, m.source, gateChannels, rule);
  if (missing.length > 0 || unverifiable.length > 0) {
    await deps.updateMembership(m.id, {
      source: {
        ...m.source,
        gates,
        gateLinksMissing: missing,
        ...("gateCheckFailed" in m.source ? { gateCheckFailed: unverifiable } : {}),
      },
    });
    await recordGateLinksMissing(deps, {
      membershipId: m.id,
      memberId: m.memberId,
      channelId: channel.id,
      botId: identity.id,
      stage: "resend",
      missing,
    });
    return { status: "still_missing", missing: [...missing, ...unverifiable] };
  }

  const startUrl =
    typeof m.source.startUrl === "string" ? m.source.startUrl : startUrlFor(identity, m.code);
  const inWindow =
    m.userChatId !== null && now.getTime() - m.requestedAt.getTime() < JOIN_REQUEST_DM_WINDOW_MS;
  const canWrite = inWindow || (await deps.canWriteTo(m.memberId, identity.id));
  const member = canWrite ? await deps.getMember(m.memberId) : null;
  const sent = Boolean(canWrite && member);
  if (sent && member)
    await sendWelcome(deps, {
      channel,
      identity,
      member,
      chatId: m.userChatId,
      rule,
      gateChannels,
      gates,
      startUrl,
    });
  await deps.updateMembership(m.id, {
    source: {
      ...m.source,
      gates,
      gateLinksMissing: [],
      ...clearedCheck(m.source),
      startUrl,
      ...(sent ? { welcomeResentAt: now.toISOString() } : {}),
    },
  });
  await deps.recordEvent({
    type: sent ? "membership.welcome_resent" : "membership.gate_links_ready",
    memberId: m.memberId,
    channelId: channel.id,
    botId: identity.id,
    payload: { membershipId: m.id, byUserId: opts.byUserId ?? null, gates: gates.length },
  });
  return sent
    ? { status: "sent", gates: gates.length }
    : { status: "links_ready", gates: gates.length };
}

/** Index pratique (pour le worker et l'interface) : échéance d'un rappel. */
export { dueReminderIndex, expirationOutcome, OPEN_STATUSES } from "./rules";
export type { MembershipInfo };
// Liens des canaux à rejoindre : partagés avec le site (vérification à l'enregistrement d'une règle, renvoi de
// l'accueil, point « À faire ») et le worker (rappels, alerte), exportés par l'index du paquet via ce fichier.
export {
  checkCandidates,
  checkGateMembership,
  gateButtonsOf,
  gateCheckProblemsOf,
  gateProblemsOf,
  sameGateChannels,
  inviteCandidates,
  resolveGateLink,
  resolveGateLinks,
  telegramErrorText,
} from "./gate-links";
export type {
  FirstBot,
  GateBot,
  GateCheckResult,
  GateLinkApi,
  GateLinkDeps,
  GateLinkProblem,
  GateLinksResult,
  GateProblemReason,
} from "./gate-links";
export type { ChannelInfo, GateButton } from "./deps";
export {
  canInviteFromRights,
  createPrismaGateLinkDeps,
  listGateLinksMissing,
  webBotApi,
} from "./prisma-gate-links";
export type { GateLinksMissingRow } from "./prisma-gate-links";

/** `resendGateWelcome` avec la base (site : bouton « Renvoyer l'accueil avec les liens »). */
export async function resendGateWelcomeWithDb(
  membershipId: string,
  opts: { byUserId?: string | null; now?: Date } = {},
): Promise<ResendWelcomeOutcome> {
  const { prismaJoinFlowDeps } = await import("./prisma-deps");
  return resendGateWelcome(prismaJoinFlowDeps, membershipId, opts);
}
