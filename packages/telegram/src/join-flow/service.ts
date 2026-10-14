/**
 * Logique du flux d'adhésion, indépendante de grammY (prend une API minimale et des deps).
 */
import {
  isDuplicateWelcome,
  provenanceLabel,
  provenanceOfLink,
  shortId,
  welcomeKindFor,
  type Provenance,
} from "@linkaffipro/core";
import type { ChatJoinRequest, ChatMemberUpdated, User } from "grammy/types";
import type { BotIdentity } from "../ports";
import type { ChannelInfo, GateButton, InviteLinkInfo, JoinFlowDeps, MembershipInfo } from "./deps";
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
  isDirectEntry,
  isNoRule,
  OPEN_STATUSES,
  ruleDelayText,
  type RuleData,
} from "./rules";
import { maskedLinkPrefix, pickMaskedLink } from "./masked-link";
import { attributeAffiliateSafely, emitLinkaffi, isLinkaffiInviteLink } from "./affiliate";
import { baseLang, defaultText, pickText, renderHtmlText, type Lang, type TextVars } from "./texts";

/** Sous-ensemble de l'API Telegram utilisé par le flux (facile à simuler). */
export type JoinFlowApi = GateLinkApi;

const GOOD_STATUSES = new Set(["member", "administrator", "creator", "restricted"]);

/** Fenêtre pendant laquelle Telegram laisse le bot écrire après une demande d'adhésion (`user_chat_id`). */
export const JOIN_REQUEST_DM_WINDOW_MS = 5 * 60_000;

export type JoinFlowResult = { handled: boolean; reason?: string };

/** Provenance enregistrée sur une demande (`Membership.source.provenance`) : provenance résolue + texte en français. */
export type ProvenanceSnapshot = Provenance & { label: string };

/** Règle appliquée enregistrée sur une demande (`Membership.source.appliedRule`) ; null : aucune règle. */
export type AppliedRuleSnapshot = {
  id: string;
  scope: RuleData["scope"];
  /** Texte de l'exception ; null pour la règle par défaut (« Règle par défaut »). */
  label: string | null;
  /** Canaux à rejoindre de la règle non imposés pour cette provenance. */
  noGates?: true;
} | null;

/**
 * Provenance d'une demande avec son texte (« Venu de « Tir Cadré » (canal obligatoire) ») : titre du canal d'origine
 * relu (canal supprimé : texte générique), nom du lien pour une pub, un lien de partage ou un lien manuel.
 */
export async function provenanceSnapshot(
  deps: Pick<JoinFlowDeps, "getChannels">,
  provenance: Provenance,
  link: Pick<InviteLinkInfo, "name"> | null,
): Promise<ProvenanceSnapshot> {
  const titles: Record<string, string> = {};
  if (provenance.sourceChannelId)
    for (const c of await deps.getChannels([provenance.sourceChannelId])) titles[c.id] = c.title;
  return { ...provenance, label: provenanceLabel(provenance, titles, link?.name ?? null) };
}

/** Lien d'invitation tel que Telegram le transmet dans une demande ou une entrée (adresse, créateur). */
type TelegramInvite = { invite_link: string; creator?: { id: number } | null };

/**
 * Lien d'invitation d'une demande ou d'une entrée : par son adresse exacte, sinon (fin masquée par Telegram : lien créé
 * par un autre de nos bots administrateurs du canal) par son début, son canal et son créateur. Plusieurs liens
 * possibles : null (provenance inconnue, jamais devinée).
 */
export async function findRequestLink(
  deps: Pick<JoinFlowDeps, "findInviteLinkByUrl" | "findInviteLinksByPrefix">,
  channelId: string,
  invite: TelegramInvite | null | undefined,
): Promise<InviteLinkInfo | null> {
  const url = invite?.invite_link;
  if (!url) return null;
  const exact = await deps.findInviteLinkByUrl(url);
  if (exact) return exact;
  const prefix = maskedLinkPrefix(url);
  if (!prefix || !invite?.creator || !deps.findInviteLinksByPrefix) return null;
  const found = pickMaskedLink(
    prefix,
    await deps.findInviteLinksByPrefix({
      channelId,
      prefix,
      creatorTelegramId: BigInt(invite.creator.id),
    }),
  );
  if (!found)
    console.warn("[join-flow] lien masqué par Telegram non retrouvé (provenance inconnue)", {
      channelId,
      prefix,
      creatorTelegramId: invite.creator.id,
    });
  return found;
}

/** Règle appliquée telle qu'enregistrée sur la demande (null : aucune règle). */
export function appliedRuleOf(rule: RuleData): AppliedRuleSnapshot {
  if (!rule.id) return null;
  return {
    id: rule.id,
    scope: rule.scope,
    label: rule.scope === "DEFAULT" ? null : rule.label,
    ...(rule.noGates ? { noGates: true as const } : {}),
  };
}

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
    delai: ruleDelayText(rule, "fr"),
    bot: `@${identity.username}`,
  };
}

function varsLang(v: TextVars, rule: RuleData, lang: Lang): TextVars {
  return { ...v, delai: ruleDelayText(rule, lang) };
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
  const link = await findRequestLink(deps, channel.id, req.invite_link);
  // Provenance (phase 11) : d'après le lien de la demande (retrouvé même si Telegram en masque la fin) ; un lien que la
  // plateforme n'a pas créé ou une demande sans lien suit la règle par défaut.
  const provenance = provenanceOfLink(link);
  const rule = await deps.resolveRule(channel.id, link);
  const requestedAt = new Date(req.date * 1000);
  const initial = computeInitialState(rule, requestedAt);
  const code = shortId();
  const userChatId = req.user_chat_id ? BigInt(req.user_chat_id) : null;

  // Canaux à rejoindre effectifs de la règle (sans ce canal ni celui d'où vient la personne).
  const gateChannels = await gateChannelsOf(deps, rule, channel.id);
  const { gates, missing } = await resolveGateLinks(deps, channel, gateChannels, {
    botId: identity.id,
    username: identity.username,
    api,
  });
  const startUrl = startUrlFor(identity, code);
  const provenanceRecord = await provenanceSnapshot(deps, provenance, link);
  const appliedRule = appliedRuleOf(rule);
  // Lien d'affilié Link Affi (phase 13) : dernière demande sur ce canal AVANT celle-ci (« déjà dans le canal ? »).
  const latestBefore = isLinkaffiInviteLink(link)
    ? await deps.findLatestMembership(member.memberId, channel.id)
    : null;
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
    // D'où vient la personne et quelle règle s'applique (listes des demandes, fiche membre, statistiques).
    provenance: provenanceRecord,
    appliedRule,
    // Aucune règle : validation à la main, ou entrée directe pour une personne venue d'un canal obligatoire.
    ...(rule.id === null ? { noRule: isDirectEntry(rule) ? "IMMEDIATE" : "MANUAL" } : {}),
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
      provenance: provenanceRecord,
      appliedRule,
    },
  });

  // Affilié Link Affi (phase 13) : rattachement si c'est son lien (premier affilié gagne, pas un membre déjà dans le
  // canal), puis événement « demande » pour Link Affi (seulement pour un membre rattaché à une campagne de ce canal).
  await attributeAffiliateSafely(api, deps, {
    stage: "request",
    memberId: member.memberId,
    telegramUserId: req.from.id,
    channel,
    link,
    membershipId,
    latestBefore,
    at: requestedAt,
    botId: identity.id,
  });
  await emitLinkaffi(deps, {
    type: "join_requested",
    sourceId: membershipId,
    memberId: member.memberId,
    channelId: channel.id,
    occurredAt: requestedAt,
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

  // Message à l'arrivée : accueil complet dès qu'il reste des canaux à rejoindre ; sinon rien si l'équipe l'a coupé,
  // court message pour une personne venue du bouton « canal à rejoindre » d'un autre canal, accueil complet sinon.
  const hasGates = hasGate(rule);
  const kind = welcomeKindFor({ provenance, hasGates, sendWelcome: rule.sendWelcome });
  if (kind === "none") return { handled: true };
  if (!hasGates) {
    // Anti-doublon : un même bot n'envoie pas deux accueils à la même personne en 10 minutes (jamais un accueil avec
    // des canaux à rejoindre : ses boutons sont nécessaires pour entrer).
    const lastWelcomeAt = await deps.lastWelcomeAt(member.memberId, identity.id);
    if (isDuplicateWelcome({ kind, hasGates, lastWelcomeAt, now: new Date() })) {
      await deps.recordEvent({
        type: "membership.welcome_skipped",
        memberId: member.memberId,
        channelId: channel.id,
        botId: identity.id,
        payload: {
          membershipId,
          reason: "duplicate",
          kind,
          lastWelcomeAt: lastWelcomeAt?.toISOString() ?? null,
        },
      });
      return { handled: true };
    }
  }

  // Message d'accueil immédiat (via la file ; un échec d'envoi est géré par le worker : canDm=false, dm.failed).
  if (kind === "short")
    await sendShortWelcome(deps, { channel, identity, member, chatId: userChatId, rule });
  else
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
 * Court message d'une personne venue du bouton « canal à rejoindre » d'un autre canal : « Ta demande pour <canal> est
 * bien reçue, accès dans 1 jour. » (validation à la main : « … elle sera examinée par l'équipe. »). Six langues, sans
 * bouton : jamais deux accueils complets à la suite.
 */
async function sendShortWelcome(
  deps: JoinFlowDeps,
  input: {
    channel: ChannelInfo;
    identity: Pick<BotIdentity, "id" | "username">;
    member: { memberId: string; languageCode: string | null; firstName: string | null };
    chatId: bigint | null;
    rule: RuleData;
  },
): Promise<void> {
  const { channel, identity, member, rule } = input;
  const lang = baseLang(member.languageCode ?? channel.language);
  const key = rule.mode === "MANUAL" ? "joinRequestShortManual" : "joinRequestShort";
  const text = renderHtmlText(
    defaultText(key, lang),
    varsLang(vars(member, channel, rule, identity, []), rule, lang),
  );
  await deps.enqueueDm({
    botId: identity.id,
    memberId: member.memberId,
    chatId: input.chatId,
    kind: "WELCOME",
    text,
    buttons: [],
    mediaAssetId: null,
  });
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

/** Mêmes boutons (canal et lien), dans le même ordre ? */
function sameGateButtons(a: readonly GateButton[], b: readonly GateButton[]): boolean {
  return (
    a.length === b.length &&
    a.every((g, i) => g.channelId === b[i]!.channelId && g.url === b[i]!.url)
  );
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
  // Canaux à rejoindre effectifs (jamais un canal que l'accueil n'a pas demandé). Une demande de la personne en cours
  // ou acceptée dans un canal obligatoire compte comme rejointe (Telegram répond « left » tant qu'elle attend).
  const required = await gateChannelsOf(deps, rule, channel.id);
  const first: FirstBot = { botId: identity.id, username: identity.username, api };
  const check = await checkGateMembership(deps, required, from.id, first, {
    memberId: m.memberId,
  });
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
    // Liens recalculés pour TOUS les canaux encore à rejoindre (comme les rappels), jamais le lien enregistré à
    // l'accueil tel quel : manquant alors (droits corrigés depuis ?), ancien lien à entrée directe d'une demande d'avant
    // la phase 11 (plus proposé, révoqué au bout de 7 jours), lien d'un bot qui a perdu ses droits.
    const r = await resolveGateLinks(deps, channel, check.missing, first);
    const missingIds = new Set(check.missing.map((c) => c.id));
    const fresh = new Map(r.gates.map((g) => [g.channelId, g]));
    const known = required.flatMap((c) => {
      const g = missingIds.has(c.id) ? fresh.get(c.id) : gates.find((x) => x.channelId === c.id);
      return g ? [g] : [];
    });
    const before = gateProblemsOf(m.source);
    if (!sameGateButtons(gates, known) || !sameGateChannels(before, r.missing)) {
      source = { ...source, gates: known, gateLinksMissing: r.missing };
      sourceChanged = true;
    }
    if (r.missing.length > 0 && before.length === 0)
      await recordGateLinksMissing(deps, {
        membershipId: m.id,
        memberId: m.memberId,
        channelId: channel.id,
        botId: identity.id,
        stage: "start",
        missing: r.missing,
      });
    if (sourceChanged) await deps.updateMembership(m.id, { source });
    const missingGates = known.filter((g) => missingIds.has(g.channelId));
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
  // Validation à la main (demande à valider par l'équipe) : les canaux rejoints sont notés, rien n'est planifié.
  const scheduled = m.status === "PENDING_GATE" || rule.mode !== "MANUAL";
  if (scheduled) {
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
    payload: { membershipId: m.id, approveAt: scheduled ? approveAt.toISOString() : null },
  });
  const seq = await deps.getSequenceText(channel.id, identity.id, "GATE_SATISFIED");
  // Texte de l'équipe s'il existe ; sinon le texte intégré (« sera examinée par l'équipe » quand rien n'est planifié :
  // jamais une heure d'acceptation qui n'existe pas). `{delai}` vaut alors « par l'équipe ».
  const template =
    pickText(seq?.texts, member.languageCode, channel.language) ??
    defaultText(scheduled ? "gateSatisfied" : "gateSatisfiedManual", lang);
  return {
    text: renderHtmlText(template, {
      ...v,
      delai: scheduled
        ? formatDelay(Math.round((approveAt.getTime() - now.getTime()) / 1000), lang)
        : ruleDelayText({ mode: "MANUAL", delaySeconds: 0 }, lang),
    }),
    buttons: [],
  };
}

/**
 * Date d'un fait de `chat_member` (entrée, départ) qui suit un fait déjà enregistré (acceptation, entrée). Telegram date
 * la mise à jour à la seconde (tronquée), alors que le site et le worker datent l'acceptation à la milliseconde, souvent
 * dans la même seconde : sans correction, « entrée » précéderait « acceptée » dans le parcours rendu à Link Affi
 * (`GET /members`, trié par date). Le fait suivant est donc daté au plus tôt 1 ms après le précédent.
 */
export function chatMemberFactDate(telegramDate: Date, previous: Date | null | undefined): Date {
  if (!previous || previous.getTime() < telegramDate.getTime()) return telegramDate;
  return new Date(previous.getTime() + 1);
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
    const link = await findRequestLink(deps, channel.id, upd.invite_link);
    if (link) await deps.incrementInviteLink(link.id, "joined");
    const provenance = provenanceOfLink(link);
    let membershipId: string;
    // Demande encore ouverte chez nous : acceptée hors de la plateforme (par un administrateur dans Telegram), ou
    // acceptation du worker pas encore enregistrée (même identifiant d'événement : aucun doublon vers Link Affi).
    const approvedHere = !!latest && OPEN_STATUSES.includes(latest.status);
    // Entrée datée après l'acceptation (enregistrée chez nous, ou constatée ici à la date de Telegram).
    const joinedAt = chatMemberFactDate(
      now,
      approvedHere ? now : latest?.status === "APPROVED" ? latest.approvedAt : null,
    );
    if (
      latest &&
      (latest.status === "APPROVED" ||
        latest.status === "SCHEDULED" ||
        latest.status === "PENDING_GATE" ||
        latest.status === "REQUESTED")
    ) {
      await deps.updateMembership(latest.id, { status: "APPROVED", joinedAt });
      membershipId = latest.id;
    } else {
      const created = await deps.createMembership({
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
          // Entrée directe (sans demande) : provenance enregistrée aussi, aucune règle appliquée.
          provenance: await provenanceSnapshot(deps, provenance, link),
          appliedRule: null,
        },
      });
      membershipId = created.id;
    }
    // Entrée directe par le lien d'un affilié Link Affi (sans demande) : même règle d'attribution qu'une demande.
    await attributeAffiliateSafely(null, deps, {
      stage: "join",
      memberId: member.memberId,
      telegramUserId: user.id,
      channel,
      link,
      membershipId,
      latestBefore: latest,
      at: now,
      botId: identity.id,
    });
    if (approvedHere)
      await emitLinkaffi(deps, {
        type: "join_approved",
        sourceId: membershipId,
        memberId: member.memberId,
        channelId: channel.id,
        occurredAt: now,
      });
    await emitLinkaffi(deps, {
      type: "joined",
      sourceId: membershipId,
      memberId: member.memberId,
      channelId: channel.id,
      occurredAt: joinedAt,
    });
    await deps.recordEvent({
      type: "membership.joined",
      memberId: member.memberId,
      channelId: channel.id,
      botId: identity.id,
      payload: {
        inviteLink: viaLink,
        inviteLinkId: link?.id ?? null,
        gateFromChannelId: link?.sourceChannelId ?? null,
        provenanceType: provenance.type,
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
    // Départ jamais daté avant l'entrée (ou l'acceptation) enregistrée dans la même seconde.
    const leftAt = chatMemberFactDate(now, latest?.joinedAt ?? latest?.approvedAt ?? null);
    if (latest && latest.status !== "LEFT" && latest.status !== "KICKED")
      await deps.updateMembership(latest.id, { status: kicked ? "KICKED" : "LEFT", leftAt });
    if (latest?.inviteLinkId) await deps.incrementInviteLink(latest.inviteLinkId, "left");
    await deps.recordEvent({
      type: kicked ? "membership.kicked" : "membership.left",
      memberId: member.memberId,
      channelId: channel.id,
      botId: identity.id,
      payload: { membershipId: latest?.id ?? null },
    });
    // Départ (ou exclusion) d'un membre d'affilié : « left » pour Link Affi (une seule fois par demande).
    if (latest)
      await emitLinkaffi(deps, {
        type: "left",
        sourceId: latest.id,
        memberId: member.memberId,
        channelId: channel.id,
        occurredAt: leftAt,
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
export { gateLinkCreatesJoinRequest } from "./gate-links";
export {
  canInviteFromRights,
  createPrismaGateLinkDeps,
  GATE_SATISFYING_STATUSES,
  listGateLinksMissing,
  webBotApi,
} from "./prisma-gate-links";
// Règles relues en base selon la provenance (phase 11) : webhook, site et worker.
export { activeChannelRules, resolveRuleWithDb, ruleForMembershipWithDb } from "./prisma-rules";
export type { GateLinksMissingRow } from "./prisma-gate-links";

/** `resendGateWelcome` avec la base (site : bouton « Renvoyer l'accueil avec les liens »). */
export async function resendGateWelcomeWithDb(
  membershipId: string,
  opts: { byUserId?: string | null; now?: Date } = {},
): Promise<ResendWelcomeOutcome> {
  const { prismaJoinFlowDeps } = await import("./prisma-deps");
  return resendGateWelcome(prismaJoinFlowDeps, membershipId, opts);
}
