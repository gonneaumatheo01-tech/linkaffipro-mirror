/**
 * Phase 26, section 4 — un message du groupe de l'équipe, ou un message privé d'un membre présenté : que fait Kevin ?
 * Rend une décision que le bot exécute (aucun appel Telegram ici) :
 * - `ignore` : silence (message qui ne s'adresse pas à Kevin, personne inconnue, autre groupe). Rien n'est stocké en
 *   texte ni envoyé à l'IA ;
 * - `reply` : réponse immédiate dans la même conversation ;
 * - `secret` : un secret collé (dans le groupe, ou en privé hors demande) : message à supprimer aussitôt, jamais
 *   journalisé, puis redemandé en privé ;
 * - `media` : média déposé avec des mots-clés (`#casino #roulette`) par l'admin ou un membre qui s'occupe des
 *   médias : le bot le range comme en privé ;
 * - `engine` : message adressé à Kevin par une personne connue → chemin rapide puis interprète (droits vérifiés par
 *   `runBossAction`).
 * Ordre : groupe enregistré → secret → qui parle → réponse à la question ouverte → média → adressé ? → rôle réclamé →
 * moteur.
 */
import { adminTelegramId, agentAudit, agentEvent, esc, nowOf, telegramActorUserId } from "../../admin/journal";
import { isSecretAdminText, isSecretCommandText, parseAdminCommand, type SecretTextContext } from "../../admin/commands";
import { askedMessageIdsOf, currentHumanRequest, formatQuestion, sendNextHumanRequest } from "../../human/requests";
import { respondToRequest, skipRequest, type HumanRequestRow } from "../../human/respond";
import { interpretAnswer, isSkipText, looksLikeSecretValue, secretAcceptsUnreplied, type HumanRequestKindName } from "../../human/answer";
import { hasLibraryKeyword } from "../../library/tags";
import { decideValidation } from "../../validation/requests";
import type { AgentsDeps } from "../../types";
import type { BossChat, BossReply, BossSpeaker, BossTeamInput } from "../contract";
import { looksLikeBotToken, notYoursReply } from "../execute";
import { looksLikeOrderOrQuestion } from "../fast";
import { readBossName, writeBossTurn } from "../memory";
import { createBossPending, rememberBossPendingMessage } from "../confirm";
import { introducedReply, upsertMember } from "../catalog-team";
import { addressedToBoss, isHereWeWork, looksLikeRoleClaim, mentionsOf, type GroupEntity, type MentionRef } from "./addressed";
import {
  adminFirstName,
  claimUnknownReply,
  findTeamMember,
  readSeenPeople,
  rememberAdminProfile,
  rememberSeenPerson,
  responsibilitiesOf,
  takePendingIntro,
  type TeamMemberRow,
} from "./members";
import { bossUsername, claimDeleteRightAsk, claimGroupWelcome, privateLink, readBossGroupId, setBossGroup } from "./group";

export type BossTeamMessage = {
  chat: { id: bigint; type: "private" | "group"; title?: string | null };
  from: { id: bigint; firstName: string | null; username: string | null };
  messageId: number;
  /** Texte ou légende (vide si aucun). */
  text: string;
  entities?: readonly GroupEntity[] | null;
  replyTo?: { messageId: number; fromId: bigint | null } | null;
  forwarded?: boolean;
  /** Photo, vidéo, animation ou document image / vidéo joint. */
  hasMedia?: boolean;
  bot: { telegramId: bigint; username: string };
};

export type BossTeamOutcome =
  | { kind: "ignore"; reason: string }
  | { kind: "reply"; reply: BossReply }
  | { kind: "secret"; ifDeleted: string; ifNotDeleted: string; followUp?: () => Promise<void> }
  | { kind: "media"; caption: string; speaker: BossSpeaker }
  | { kind: "engine"; input: BossTeamInput };

export const MEMBER_PRIVATE_WELCOME = (first: string, name: string) =>
  `Salut ${esc(first)}, c'est ${esc(name)} 👋 Ici, tu peux m'envoyer ce que je te demande (une clé, une réponse) sans que le groupe le voie. Pour le reste, parle-moi normalement ou écris aide.`;

const ignore = (reason: string): BossTeamOutcome => ({ kind: "ignore", reason });
const reply = (text: string, extra: Partial<BossReply> = {}): BossTeamOutcome => ({ kind: "reply", reply: { reply: text, ...extra } });

/** Un long mot qui ressemble à une clé (lettres et chiffres, 20 caractères ou plus) dans le texte (pur). */
export function containsKeyLikeWord(text: string): boolean {
  return text.split(/\s+/).some((w) => w.length >= 20 && /\p{L}/u.test(w) && /\d/.test(w) && !/^https?:\/\//i.test(w) && !/^[#@]/.test(w));
}

/** Contexte du détecteur de secrets pour une conversation : demande SECRET en cours + messages des demandes de cette conversation. */
async function secretContextFor(deps: AgentsDeps, chatId: bigint | null, replyTo: number | null): Promise<SecretTextContext> {
  const rows = (await deps.prisma.humanRequest.findMany({ where: { kind: "SECRET" }, orderBy: { createdAt: "desc" }, take: 500 })) as {
    key: string;
    status: string;
    telegramMessageId: number | null;
    onAnswer: unknown;
    askedAt: Date | null;
    chatId?: bigint | null;
  }[];
  const pending = rows.filter((r) => r.status === "PENDING").sort((a, b) => (a.askedAt?.getTime() ?? 0) - (b.askedAt?.getTime() ?? 0))[0];
  const ids = new Set<number>();
  for (const r of rows) if ((r.chatId ?? null) === chatId) for (const id of askedMessageIdsOf(r)) ids.add(id);
  return {
    pending: pending ? { key: pending.key, telegramMessageId: (pending.chatId ?? null) === chatId ? pending.telegramMessageId : null } : null,
    replyToMessageId: replyTo,
    secretMessageIds: [...ids],
  };
}

/** Le texte contient-il (ou est-il) un secret dans cette conversation (pur après lecture du contexte) ? */
export function isTeamSecretText(text: string, ctx: SecretTextContext, opts: { group: boolean }): boolean {
  if (!text.trim()) return false;
  if (isSecretAdminText(text, ctx) || looksLikeBotToken(text)) return true;
  // Dans le groupe, tout ce qui ressemble à une clé est retiré, même sans demande en cours.
  return opts.group && (looksLikeSecretValue(text.trim()) || containsKeyLikeWord(text) || isSecretCommandText(text));
}

async function speakerOf(deps: AgentsDeps, from: BossTeamMessage["from"], adminId: bigint | null): Promise<{ speaker: BossSpeaker; member: TeamMemberRow | null } | null> {
  if (adminId && from.id === adminId) {
    await rememberAdminProfile(deps, { firstName: from.firstName, username: from.username });
    return { speaker: { kind: "admin", telegramUserId: from.id, firstName: from.firstName }, member: null };
  }
  const m = await findTeamMember(deps, from.id);
  if (!m) return null;
  // Nom d'utilisateur changé (ou appris) : mis à jour pour les mentions.
  if (from.username && from.username !== m.username)
    await deps.prisma.teamMember.update({ where: { telegramUserId: m.telegramUserId }, data: { username: from.username } }).catch(() => undefined);
  return { speaker: { kind: "member", telegramUserId: m.telegramUserId, memberId: m.id, role: m.role, firstName: m.firstName }, member: m };
}

/** Peut-on ranger un média de cette personne ? L'admin, ou un membre qui s'occupe des médias (pur). */
export function mayDepositMedia(speaker: BossSpeaker, member: TeamMemberRow | null): boolean {
  if (speaker.kind === "admin") return true;
  const r = member ? responsibilitiesOf(member.responsibilities) : { teams: [], kinds: [] };
  return r.kinds.length === 0 ? r.teams.length > 0 : r.kinds.includes("media");
}

type CurrentRequest = HumanRequestRow & { telegramMessageId: number | null; askedAt: Date | null; chatId?: bigint | null; assigneeTelegramId?: bigint | null };

async function answerRequest(deps: AgentsDeps, cur: CurrentRequest, text: string, speaker: BossSpeaker, chat: BossChat, messageId: number): Promise<BossTeamOutcome> {
  const actor = { userId: speaker.kind === "admin" ? await telegramActorUserId(deps) : null, via: "TELEGRAM" as const };
  const skip = isSkipText(text);
  const res = skip ? await skipRequest(deps, cur, actor, { deferNext: true }) : await respondToRequest(deps, cur, text, actor, { deferNext: true, confirmText: text });
  await agentAudit(deps, {
    userId: actor.userId,
    action: skip ? "boss.plus_tard" : "boss.repondre_demande",
    entityType: "HumanRequest",
    entityId: cur.id,
    metadata: { via: "TELEGRAM", telegramActorId: speaker.telegramUserId.toString(), speaker: speaker.kind, inGroup: chat.type === "group", key: cur.key, kind: cur.kind },
  });
  await writeBossTurn(deps, { role: "ADMIN", text: cur.kind === "SECRET" ? "" : text, secret: cur.kind === "SECRET", source: "text", telegramMessageId: messageId, chatId: chat.chatId, fromTelegramId: speaker.telegramUserId });
  await writeBossTurn(deps, { role: "BOSS", text: res.message, actionKey: skip ? "plus_tard" : "repondre_demande", status: res.ok ? "done" : "refused", telegramMessageId: messageId, chatId: chat.chatId });
  return {
    kind: "reply",
    reply: {
      reply: esc(res.message),
      ...(cur.kind === "SECRET" ? { deleteMessage: true } : {}),
      followUp: res.closed
        ? async () => {
            await sendNextHumanRequest(deps);
          }
        : undefined,
    },
  };
}

/**
 * Réponse à la question ouverte : de son responsable (ou de l'admin), en réponse au message de la question, ou comme
 * message suivant du responsable (texte qui n'est ni un ordre ni une question ; choix ou oui / non reconnu).
 */
async function maybeAnswer(
  deps: AgentsDeps,
  msg: BossTeamMessage,
  speaker: BossSpeaker,
  chat: BossChat,
  addressed: boolean,
  text: string,
): Promise<BossTeamOutcome | null> {
  const cur = (await currentHumanRequest(deps)) as CurrentRequest | null;
  if (!cur || cur.kind === "SECRET") return null;
  const assignee = cur.assigneeTelegramId ?? null;
  const isAssignee = assignee !== null ? assignee === speaker.telegramUserId : speaker.kind === "admin";
  if (!isAssignee && speaker.kind !== "admin") return null;
  const reqChat = cur.chatId ?? null;
  if (chat.type === "group") {
    if (reqChat !== chat.chatId) return null;
    const replyToQuestion = msg.replyTo ? askedMessageIdsOf(cur).includes(msg.replyTo.messageId) : false;
    if (replyToQuestion) {
      if (cur.kind === "MEDIA" && !isSkipText(text)) return null;
      return answerRequest(deps, cur, text, speaker, chat, msg.messageId);
    }
    if (!isAssignee || msg.replyTo) return null;
  } else {
    // Privé d'un membre : seulement une demande qui lui est adressée (posée dans le groupe).
    if (speaker.kind !== "member" || assignee !== speaker.telegramUserId) return null;
  }
  if (!text.trim()) return null;
  if (isSkipText(text)) return answerRequest(deps, cur, text, speaker, chat, msg.messageId);
  if (cur.kind === "MEDIA") return null;
  if (cur.kind === "TEXT") {
    if (looksLikeOrderOrQuestion(text)) return null;
    return answerRequest(deps, cur, text, speaker, chat, msg.messageId);
  }
  const parsed = interpretAnswer({ kind: cur.kind as HumanRequestKindName, key: cur.key, options: Array.isArray(cur.options) ? (cur.options as string[]) : [] }, text);
  if (parsed.type === "answer" || parsed.type === "skip") return answerRequest(deps, cur, text, speaker, chat, msg.messageId);
  void addressed;
  return null;
}

/** Correction d'un post par le membre qui a appuyé sur « ✏️ Corriger » : sa réponse au message de Kevin est le nouveau texte. */
async function maybeCorrection(deps: AgentsDeps, msg: BossTeamMessage, speaker: BossSpeaker, chat: BossChat, text: string): Promise<BossTeamOutcome | null> {
  if (speaker.kind !== "member" || !msg.replyTo || msg.replyTo.fromId !== msg.bot.telegramId || !text.trim()) return null;
  const v = (await deps.prisma.agentValidation.findFirst({
    where: { status: "PENDING", awaitingEditAt: { not: null }, assigneeTelegramId: speaker.telegramUserId },
    orderBy: { awaitingEditAt: "desc" },
  })) as { id: string; number: number } | null;
  if (!v) return null;
  const r = await decideValidation(deps, { validationId: v.id, decision: "edit", editedText: esc(text), via: "TELEGRAM", byUserId: null });
  await agentAudit(deps, { userId: null, action: "boss.corriger_post", entityType: "AgentValidation", entityId: v.id, metadata: { via: "TELEGRAM", telegramActorId: speaker.telegramUserId.toString(), inGroup: chat.type === "group" } });
  return reply(esc(r.message));
}

/** « Kevin, c'est ici qu'on bosse » de l'admin : enregistre le groupe, ou fait confirmer le remplacement en privé. */
async function hereWeWork(deps: AgentsDeps, msg: BossTeamMessage, adminId: bigint): Promise<BossTeamOutcome> {
  const current = await readBossGroupId(deps);
  if (current === msg.chat.id) return reply("C'est déjà ici qu'on bosse 👍");
  if (current) {
    await askGroupReplacement(deps, { chatId: msg.chat.id, title: msg.chat.title ?? null });
    return reply("Je te demande confirmation en privé 👍");
  }
  await setBossGroup(deps, { chatId: msg.chat.id, title: msg.chat.title ?? null, byTelegramId: adminId, userId: await telegramActorUserId(deps) });
  const first = await adminFirstName(deps);
  const welcome = await claimGroupWelcome(deps, msg.chat.id, first === "l'admin" ? msg.from.firstName : first);
  const ask = await claimDeleteRightAsk(deps);
  return reply([welcome ?? "C'est noté : c'est ici qu'on bosse 👍", ask].filter(Boolean).join("\n\n"));
}

/** Remplacement du groupe : confirmation (OUI / NON) envoyée en privé à l'admin. */
export async function askGroupReplacement(deps: AgentsDeps, input: { chatId: bigint; title: string | null }): Promise<boolean> {
  const summary = `Faire du groupe « ${input.title ?? input.chatId.toString()} » le groupe de l'équipe (à la place de l'ancien) ?\nJe n'écrirai plus que dans celui-là.`;
  const r = await createBossPending(deps, { actionKey: "groupe_equipe", params: { chat_id: input.chatId.toString(), ...(input.title ? { titre: input.title.slice(0, 120) } : {}) }, summary });
  try {
    const sent = await deps.admin?.send(r.reply ?? summary, { buttons: r.buttons });
    if (sent && r.pendingId) await rememberBossPendingMessage(deps, r.pendingId, sent.messageId);
    return !!sent;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] confirmation du nouveau groupe non envoyée");
    return false;
  }
}

/** Secret collé : retiré aussitôt, jamais journalisé ; redemandé en privé à la bonne personne. */
async function secretOutcome(deps: AgentsDeps, msg: BossTeamMessage, speaker: BossSpeaker | null, member: TeamMemberRow | null, group: boolean): Promise<BossTeamOutcome> {
  const who = speaker?.firstName ?? msg.from.firstName ?? null;
  const link = privateLink(await bossUsername(deps));
  await agentEvent(deps, group ? "boss.group.secret_removed" : "boss.member.secret_removed", { fromTelegramId: msg.from.id.toString() });
  if (speaker) {
    await writeBossTurn(deps, { role: "ADMIN", text: "", secret: true, source: "text", telegramMessageId: msg.messageId, chatId: msg.chat.id, fromTelegramId: msg.from.id });
    await writeBossTurn(deps, { role: "BOSS", text: "secret retiré", actionKey: "secret", status: "refused", telegramMessageId: msg.messageId, chatId: msg.chat.id });
  }
  if (!group)
    return { kind: "secret", ifDeleted: "🔒 J'ai effacé ce message : il ressemblait à une clé. Je ne range une clé que quand je te la demande.", ifNotDeleted: "🔒 Efface ce message : il ressemble à une clé. Je ne range une clé que quand je te la demande." };
  const cur = (await currentHumanRequest(deps)) as CurrentRequest | null;
  const pendingSecret = cur?.kind === "SECRET" ? cur : null;
  const concerned = !!speaker && !!pendingSecret && (speaker.kind === "admin" || pendingSecret.assigneeTelegramId === speaker.telegramUserId);
  const started = speaker?.kind === "admin" || !!member?.startedPrivateAt;
  const where = started ? `envoie-la-moi en privé 👉 ${link}` : `écris-moi d'abord /start en privé 👉 ${link}, puis envoie-la-moi là-bas`;
  const name = who ? `${esc(who)}, ` : "";
  return {
    kind: "secret",
    ifDeleted: `🔒 ${name}j'ai effacé ton message : il ressemblait à une clé. Jamais ici : ${where}.`,
    ifNotDeleted: `🔒 ${name}efface vite ton message : il ressemble à une clé (je n'ai pas le droit de l'effacer moi-même). Jamais ici : ${where}.`,
    followUp:
      concerned && started && pendingSecret
        ? async () => {
            // La question repart en privé chez la personne (l'admin : sa conversation habituelle).
            const html = formatQuestion(pendingSecret);
            if (speaker!.kind === "admin") await deps.admin?.send(html);
            else await deps.admin?.sendTo?.(speaker!.telegramUserId, html);
          }
        : undefined,
  };
}

/** Clé envoyée en privé par le membre à qui la demande SECRET est adressée : rangée, message supprimé. */
async function memberPrivateSecret(deps: AgentsDeps, msg: BossTeamMessage, speaker: BossSpeaker, text: string): Promise<BossTeamOutcome | null> {
  const cur = (await currentHumanRequest(deps)) as CurrentRequest | null;
  if (!cur || cur.kind !== "SECRET" || cur.assigneeTelegramId !== speaker.telegramUserId) return null;
  let value: string | null = null;
  const cmd = isSecretCommandText(text) ? parseAdminCommand(text) : null;
  if (cmd?.type === "secret" && cmd.key === cur.key) value = cmd.value;
  else if (!cmd && (secretAcceptsUnreplied(cur.key, text.trim()) || (msg.replyTo && msg.replyTo.fromId === msg.bot.telegramId))) value = text.trim();
  if (value === null) return null;
  return answerRequest(deps, cur, value, speaker, { type: "private", chatId: msg.chat.id }, msg.messageId);
}

/** Message d'une personne qui n'a pas (encore) été présentée : présentation en attente, ou « je ne te connais pas ». */
async function unknownPerson(deps: AgentsDeps, msg: BossTeamMessage, addressed: boolean, group: boolean): Promise<BossTeamOutcome> {
  const intro = await takePendingIntro(deps, { username: msg.from.username });
  if (intro) {
    const member = await upsertMember(deps, {
      person: { id: msg.from.id, username: msg.from.username, firstName: msg.from.firstName },
      firstName: (intro.firstName ?? msg.from.firstName ?? msg.from.username ?? "?").slice(0, 40),
      roleLabel: intro.roleLabel,
      teams: intro.teams,
      kinds: intro.kinds,
      role: intro.role,
      introducedBy: intro.by && /^\d+$/.test(intro.by) ? BigInt(intro.by) : null,
    });
    await agentAudit(deps, { userId: null, action: "boss.presenter_membre", entityType: "TeamMember", entityId: member.id, metadata: { via: "TELEGRAM", telegramActorId: intro.by, pendingIntro: true } });
    const r = introducedReply(member);
    return reply(`${r.reply} Bienvenue ${esc(member.firstName)} 👋`);
  }
  if (!group || !addressed) return ignore("inconnu");
  if (!(await claimUnknownReply(deps, msg.from.id))) return ignore("inconnu déjà prévenu aujourd'hui");
  return reply(`Je ne te connais pas encore : ${esc(await adminFirstName(deps))} doit me présenter.`);
}

/** Texte d'une commande pour le Boss : `/aide@kevin` → « aide » (pur). */
export function teamCommandText(text: string): string {
  const m = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return text;
  const cmd = m[1]!.toLowerCase() === "help" ? "aide" : m[1]!.toLowerCase();
  return m[2]?.trim() ? `${cmd} ${m[2].trim()}` : cmd;
}

/** Décision pour un message du groupe ou un message privé d'un membre (voir l'en-tête). Ne lève jamais. */
export async function bossTeamIncoming(deps: AgentsDeps, msg: BossTeamMessage): Promise<BossTeamOutcome> {
  try {
    return await incoming(deps, msg);
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[boss] message d'équipe en échec");
    return ignore("erreur");
  }
}

async function incoming(deps: AgentsDeps, msg: BossTeamMessage): Promise<BossTeamOutcome> {
  const group = msg.chat.type === "group";
  const adminId = await adminTelegramId(deps);
  const isAdmin = !!adminId && msg.from.id === adminId;
  const name = await readBossName(deps);
  const addr = group
    ? addressedToBoss({ text: msg.text, entities: msg.entities, replyToFromId: msg.replyTo?.fromId ?? null, botTelegramId: msg.bot.telegramId, botUsername: msg.bot.username, bossName: name })
    : { addressed: true, via: null, text: msg.text.trim() };

  if (group) {
    const groupId = await readBossGroupId(deps);
    if (groupId !== msg.chat.id) {
      if (isAdmin && addr.addressed && isHereWeWork(addr.text)) {
        await rememberAdminProfile(deps, { firstName: msg.from.firstName, username: msg.from.username });
        return hereWeWork(deps, msg, adminId!);
      }
      if (addr.addressed) await agentEvent(deps, "boss.group.ignored", { chatId: msg.chat.id.toString(), fromTelegramId: msg.from.id.toString(), reason: groupId ? "autre groupe" : "aucun groupe enregistré" });
      return ignore("autre groupe");
    }
  } else if (isAdmin) {
    // L'admin en privé passe par le dialogue habituel (`handlers/agents-admin.ts`).
    return ignore("admin en privé");
  }

  // 1. Secret : avant tout le reste (même d'une personne inconnue), jamais transmis ni journalisé.
  const resolved = await speakerOf(deps, msg.from, adminId);
  if (!msg.forwarded && msg.text.trim()) {
    const ctx = await secretContextFor(deps, group ? msg.chat.id : null, msg.replyTo?.messageId ?? null);
    if (!group && resolved?.speaker.kind === "member") {
      const stored = await memberPrivateSecret(deps, msg, resolved.speaker, msg.text);
      if (stored) return stored;
    }
    if (isTeamSecretText(msg.text, ctx, { group })) {
      if (!group && !resolved) return ignore("inconnu");
      return secretOutcome(deps, msg, resolved?.speaker ?? null, resolved?.member ?? null, group);
    }
  }

  if (group) await rememberSeenPerson(deps, { id: msg.from.id, firstName: msg.from.firstName, username: msg.from.username });
  if (!resolved) return unknownPerson(deps, msg, addr.addressed, group);
  const { speaker, member } = resolved;
  const chat: BossChat = group ? { type: "group", chatId: msg.chat.id } : { type: "private", chatId: msg.chat.id };

  // Privé d'un membre : /start (il peut désormais recevoir un message privé de Kevin).
  if (!group && member) {
    if (!member.startedPrivateAt)
      await deps.prisma.teamMember.update({ where: { telegramUserId: member.telegramUserId }, data: { startedPrivateAt: nowOf(deps) } }).catch(() => undefined);
    if (/^\/start(?:@\w+)?(?:\s|$)/.test(msg.text.trim())) return reply(MEMBER_PRIVATE_WELCOME(member.firstName, name));
  }
  if (msg.forwarded && !addr.addressed) return ignore("message transféré");

  // 2. Réponse à la question ouverte (de son responsable ou de l'admin).
  const text = addr.addressed ? addr.text : msg.text.trim();
  if (!msg.forwarded) {
    const answered = await maybeAnswer(deps, msg, speaker, chat, addr.addressed, text);
    if (answered) return answered;
    const corrected = await maybeCorrection(deps, msg, speaker, chat, msg.text.trim());
    if (corrected) return corrected;
  }

  // 3. Média avec mots-clés de la médiathèque, déposé par l'admin ou un membre qui s'occupe des médias.
  if (msg.hasMedia && !msg.forwarded && hasLibraryKeyword(msg.text) && mayDepositMedia(speaker, member)) return { kind: "media", caption: msg.text, speaker };

  // 4. Seuls les messages adressés à Kevin vont plus loin (jamais à l'IA sinon).
  if (!addr.addressed) return ignore("pas pour Kevin");
  if (group && isAdmin && isHereWeWork(text)) return hereWeWork(deps, msg, adminId!);
  if (!text) return reply(`Je t'écoute${speaker.firstName ? `, ${esc(speaker.firstName)}` : ""} 🙂 Dis-moi ce qu'il te faut (ou écris aide).`);
  if (speaker.kind === "member" && looksLikeRoleClaim(text)) {
    await agentAudit(deps, { userId: null, action: "boss.role_claim", entityType: "TeamMember", entityId: speaker.memberId, metadata: { via: "TELEGRAM", telegramActorId: speaker.telegramUserId.toString(), refused: true } });
    return reply(await notYoursReply(deps));
  }
  if (msg.hasMedia && !hasLibraryKeyword(msg.text))
    return reply("Bien reçu. Pour ranger un média, renvoie-le avec des mots-clés en légende (par exemple #casino #roulette).");

  const known = await readSeenPeople(deps).catch(() => []);
  const mentions: MentionRef[] = mentionsOf(msg.text, msg.entities, msg.bot.username, msg.bot.telegramId).map((m) => {
    if (m.telegramUserId || !m.username) return m;
    const seen = known.find((p) => p.username?.toLowerCase() === m.username!.toLowerCase());
    return seen ? { telegramUserId: BigInt(seen.id), username: seen.username, firstName: seen.firstName } : m;
  });
  return {
    kind: "engine",
    input: {
      text: addr.via === "command" ? teamCommandText(text) : text,
      messageId: msg.messageId,
      // Numéros de message propres au groupe : jamais comparés à ceux de la conversation privée de l'admin.
      replyToMessageId: group ? null : (msg.replyTo?.messageId ?? null),
      source: "text",
      entities: null,
      ...(msg.forwarded ? { forwarded: true } : {}),
      speaker,
      chat,
      mentions,
    },
  };
}

// ------------------------------------------------------------------------------------------- arrivée dans un groupe

export type BossMembershipEvent = {
  chat: { id: bigint; type: "group" | "supergroup" | "channel" | "private"; title?: string | null };
  from: { id: bigint; firstName: string | null; username: string | null };
  oldStatus: string;
  newStatus: string;
  /** Kevin est administrateur avec le droit de supprimer des messages. */
  canDelete?: boolean;
};

export type BossMembershipOutcome = { say: string[]; reason: string };

const IN = new Set(["member", "administrator", "restricted"]);

/**
 * Kevin ajouté à un groupe, retiré, ou ses droits changés (`my_chat_member`). Ajouté par l'admin : groupe enregistré
 * et accueil une fois (ou remplacement confirmé en privé s'il y a déjà un groupe). Ajouté par quelqu'un d'autre :
 * silence, une ligne de journal. Ne lève jamais.
 */
export async function bossGroupMembership(deps: AgentsDeps, ev: BossMembershipEvent): Promise<BossMembershipOutcome> {
  try {
    if (ev.chat.type !== "group" && ev.chat.type !== "supergroup") return { say: [], reason: "pas un groupe" };
    const { markGroupLeft, setGroupCanDelete, bossGroupLeft } = await import("./group");
    const groupId = await readBossGroupId(deps);
    const wasIn = IN.has(ev.oldStatus);
    const isIn = IN.has(ev.newStatus);
    if (!isIn) {
      if (groupId === ev.chat.id) await markGroupLeft(deps, ev.chat.id);
      return { say: [], reason: "retiré" };
    }
    if (groupId === ev.chat.id) await setGroupCanDelete(deps, ev.canDelete === true);
    if (wasIn) return { say: [], reason: "droits changés" };
    const adminId = await adminTelegramId(deps);
    if (!adminId || ev.from.id !== adminId) {
      await agentEvent(deps, "boss.group.ignored", { chatId: ev.chat.id.toString(), byTelegramId: ev.from.id.toString(), reason: "ajouté par quelqu'un d'autre" });
      return { say: [], reason: "ajouté par un autre" };
    }
    await rememberAdminProfile(deps, { firstName: ev.from.firstName, username: ev.from.username });
    if (groupId && groupId !== ev.chat.id && !(await bossGroupLeft(deps, groupId))) {
      await askGroupReplacement(deps, { chatId: ev.chat.id, title: ev.chat.title ?? null });
      return { say: [], reason: "remplacement à confirmer" };
    }
    if (groupId !== ev.chat.id) await setBossGroup(deps, { chatId: ev.chat.id, title: ev.chat.title ?? null, byTelegramId: adminId, userId: await telegramActorUserId(deps) });
    else await deps.prisma.setting.deleteMany({ where: { key: "boss.group.left" } });
    await setGroupCanDelete(deps, ev.canDelete === true);
    const first = (await adminFirstName(deps)) === "l'admin" ? ev.from.firstName : await adminFirstName(deps);
    const welcome = await claimGroupWelcome(deps, ev.chat.id, first);
    const ask = ev.canDelete ? null : await claimDeleteRightAsk(deps);
    return { say: [welcome, ask].filter((x): x is string => !!x), reason: "enregistré" };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[boss] arrivée dans un groupe en échec");
    return { say: [], reason: "erreur" };
  }
}
