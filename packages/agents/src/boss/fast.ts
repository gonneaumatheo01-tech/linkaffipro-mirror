/**
 * Chemin rapide du Boss (phase 26, appelé dans le webhook : instantané, gratuit, sans IA). Ordre :
 * 1. secret (détecteur partagé `isSecretAdminText` avec le contexte des demandes SECRET de CETTE conversation ;
 *    « jeton boss <valeur> ») : rangé par `handleAdminText` (admin seulement), message supprimé, `[secret]` dans la
 *    mémoire ; jamais envoyé à l'IA. Un jeton qui remplacerait un Boss actif demande d'abord OUI / NON (jeton gardé
 *    chiffré) ;
 * 2. message transféré : une donnée, rien n'est fait ;
 * 3. OUI / NON / annule de la confirmation en attente montrée dans cette conversation (« OUI » sans rien → « Rien à
 *    confirmer. ») ;
 * 4. numéro d'une question de précision : seulement de la personne qui l'a reçue, dans sa conversation, avec SES droits ;
 * 5. commandes exactes d'aujourd'hui et réponses aux questions ouvertes (`handleAdminText`, admin SEULEMENT), plus
 *    `aide`, `commencer`, `annule` ; un membre ne passe que par le catalogue (droits vérifiés) ;
 * 6. le message suivant de l'admin répond à une question TEXT ouverte qui lui est adressée dans cette conversation,
 *    sauf accusé court (« fait », « merci »…), emojis animés, ordre ou question ; si la question n'est plus le dernier
 *    message de Kevin et date de plus de 6 heures, Kevin demande d'abord « C'est ta réponse à : … ? » (OUI / NON) ;
 * 7. sinon : `{ handled: false, needsAi: true }` (tâche `boss-text` du worker).
 */
import { handleAdminText, type AdminTextResult } from "../admin/handle";
import { isSecretAdminText, parseAdminCommand } from "../admin/commands";
import { currentHumanRequest, sendNextHumanRequest } from "../human/requests";
import { respondToRequest, type HumanRequestRow } from "../human/respond";
import { encrypt } from "@linkaffipro/core";
import { isAckText, isSkipText, looksLikeSecretValue, normalizeText, parseYesNo } from "../human/answer";
import { adminTelegramId, esc, nowOf } from "../admin/journal";
import { BOSS_TOKEN_SECRET_KEY } from "./register-port";
import type { BossDeps, BossFastResult, BossReply, BossTeamInput } from "./contract";
import { bossAction } from "./catalog";
import {
  NOTHING_TO_CANCEL,
  NOTHING_TO_CONFIRM,
  PENDING_OTHER_CHAT,
  confirmWordOf,
  createBossPending,
  pendingTargeted,
  readBossPending,
  resolveBossPending,
  voiceStrictRefusal,
} from "./confirm";
import {
  bossActorOf,
  bossSecretContext,
  bossTokenCommand,
  forwardedMemoryText,
  looksLikeBotToken,
  notYoursReply,
  oopsReply,
  runBossAction,
  SECRET_REMOVED_REPLY,
} from "./execute";
import type { AdminCommand } from "../admin/commands";
import { writeBossTurn, type BossTurnStatus } from "./memory";
import { clarifyIsFor, clearClarify, readClarify } from "./resolve";
import { bossActionAllowed } from "./catalog";
import { registerBossToken } from "./catalog-read";

export const FORWARDED_REPLY =
  "J'ai bien reçu ce message transféré : je ne fais rien de ce qu'il contient. Dis-moi ce que tu veux en faire.";

const ORDER_VERBS =
  /^(mets?|met|passe|passer|active|activer|desactive|desactiver|arrete|arreter|stop|pause|reprends?|reprendre|lance|lancer|change|changer|monte|baisse|augmente|diminue|annule|annuler|supprime|envoie|envoyer|montre|donne|dis|fais|fait|produis|teste|tester|valide|refuse|corrige|ajoute|retire|enleve|coupe|relance|applique|appliquer|cree|creer|liste|affiche|explique|combien|c'est quoi|quel|quelle|quels|quelles|est-ce|pourquoi|comment|ou en|t'as|tu as|tu peux|peux-tu|kevin)\b/u;

/** Un texte ressemble-t-il clairement à un ordre ou à une question (pur) ? Commence par un verbe d'ordre ou finit par « ? ». */
export function looksLikeOrderOrQuestion(text: string): boolean {
  const t = text.trim();
  if (/\?\s*$/.test(t)) return true;
  return ORDER_VERBS.test(normalizeText(t));
}

const AIDE = new Set(["aide", "help", "/aide", "/help", "menu", "?"]);
const QUI = new Set(["qui fait quoi", "qui fait quoi ?", "l'equipe", "equipe", "l'equipe ?", "qui s'occupe de quoi"]);
const COMMENCER = new Set(["commencer", "commence", "/commencer", "demarrer", "on commence", "par ou je commence", "/start"]);

/** Ordre d'écriture : tour de l'admin puis tour du Boss, même identifiant de message. */
async function remember(
  deps: BossDeps,
  input: BossTeamInput,
  r: BossReply,
  opts: { secret?: boolean; actionKey: string; status: BossTurnStatus },
): Promise<void> {
  const chatId = input.chat?.chatId ?? null;
  await writeBossTurn(deps, {
    role: "ADMIN",
    text: opts.secret ? "" : input.forwarded ? forwardedMemoryText(input.text) : input.text,
    secret: opts.secret,
    source: input.source,
    telegramMessageId: input.messageId,
    chatId,
    fromTelegramId: input.speaker?.telegramUserId ?? null,
  });
  await writeBossTurn(deps, {
    role: "BOSS",
    text: r.reply ?? "",
    actionKey: opts.actionKey,
    status: opts.status,
    telegramMessageId: input.messageId,
    chatId,
  });
}

function fromAdmin(r: AdminTextResult): BossReply {
  return {
    reply: r.reply ?? "C'est noté ✅",
    ...(r.deleteMessage ? { deleteMessage: true } : {}),
    ...(r.followUp ? { followUp: r.followUp } : {}),
    ...(r.buttons ? { buttons: r.buttons } : {}),
    ...(r.pendingId ? { pendingId: r.pendingId } : {}),
  };
}

/**
 * « jeton boss <valeur> » : enregistre le Boss ; s'il existe déjà un Boss actif, demande d'abord OUI / NON (« Kevin
 * existe déjà (@x) : le remplacer ? »), jeton gardé CHIFFRÉ dans la confirmation.
 */
async function bossTokenStep(deps: BossDeps, input: BossTeamInput, token: string): Promise<BossReply> {
  const active = (await deps.prisma.bot.findFirst({ where: { role: "ADMIN", isActive: true }, select: { username: true } }).catch(() => null)) as { username: string } | null;
  if (active) {
    const r = await createBossPending(deps, {
      actionKey: "remplacer_boss",
      params: { jeton: encrypt(token) },
      summary: `Kevin existe déjà (@${active.username}) : le remplacer par ce nouveau bot ?\nL'ancien ne répondra plus à l'équipe.`,
      chatId: input.chat?.chatId ?? null,
    });
    return { ...r, deleteMessage: true };
  }
  const actor = await bossActorOf(deps, input.speaker);
  return { reply: await registerBossToken(deps, token, actor.userId), deleteMessage: true };
}

/** Le message porte-t-il des emojis animés (entités `custom_emoji`) ? */
function hasCustomEmoji(input: BossTeamInput): boolean {
  return (input.entities ?? []).some((e) => e.type === "custom_emoji");
}

/** Une question TEXT n'est prise sans « Répondre » que dans les 6 heures, ou si c'est encore le dernier message de Kevin. */
export const TEXT_ANSWER_WINDOW_MS = 6 * 3600_000;

function shortQuestion(q: string): string {
  const l = (q.split("\n")[0] ?? "").replace(/<[^>]+>/g, "").trim();
  return l.length > 80 ? `${l.slice(0, 79)}…` : l;
}

async function fastPathInner(deps: BossDeps, input: BossTeamInput): Promise<BossFastResult> {
  const text = (input.text ?? "").trim();
  const voice = input.source === "voice";
  const replyTo = input.replyToMessageId ?? null;
  if (!text) {
    const r = { reply: "Je n'ai rien lu dans ce message. Écris-moi ce que tu veux en quelques mots (ou aide)." };
    return { handled: true, ...r };
  }

  // 1. Secret : jamais envoyé à l'IA, jamais journalisé en clair. Seul l'admin range un secret ou enregistre le Boss
  // ici ; un membre (privé : `memberPrivateSecret` du groupe) n'a que le retrait du message.
  const isMember = !!input.speaker && input.speaker.kind !== "admin";
  if (!voice) {
    const ctx = await bossSecretContext(deps, replyTo, { chat: input.chat, speaker: input.speaker });
    if (!isMember && !input.forwarded) {
      const tokenAnswer =
        ctx.pending?.key === BOSS_TOKEN_SECRET_KEY &&
        (replyTo === null ? looksLikeSecretValue(text) : replyTo === ctx.pending.telegramMessageId || (ctx.secretMessageIds ?? []).includes(replyTo));
      // Un message transféré est une donnée : jamais un enregistrement du Boss, même s'il contient « jeton boss … ».
      const token = bossTokenCommand(text) ?? (tokenAnswer ? text : null);
      if (token) {
        const r = await bossTokenStep(deps, input, token);
        await remember(deps, input, r, { secret: true, actionKey: "jeton_boss", status: r.pendingId ? "confirm" : "done" });
        return { handled: true, ...r };
      }
    }
    if (isSecretAdminText(text, ctx) || looksLikeBotToken(text)) {
      // Un message transféré qui contient une clé : retiré, jamais rangé (c'est une donnée).
      const handled =
        input.forwarded || isMember
          ? null
          : await handleAdminText(deps, { text, messageId: input.messageId, replyToMessageId: replyTo, source: "text", entities: input.entities, chat: input.chat });
      const r: BossReply = handled?.handled ? { ...fromAdmin(handled), deleteMessage: true } : { reply: SECRET_REMOVED_REPLY, deleteMessage: true };
      await remember(deps, input, r, { secret: true, actionKey: "secret", status: handled?.handled ? "done" : "refused" });
      return { handled: true, ...r };
    }
  }

  // 2. Message transféré : une donnée.
  if (input.forwarded) {
    const r = { reply: FORWARDED_REPLY };
    await remember(deps, input, r, { actionKey: "transfere", status: "refused" });
    return { handled: true, ...r };
  }

  const current = (await currentHumanRequest(deps)) as (HumanRequestRow & { askedAt: Date | null; telegramMessageId?: number | null }) | null;
  const pending = await readBossPending(deps);
  const word = confirmWordOf(voice ? (input.spokenText ?? text) : text);

  // 3. OUI / NON / annule de la confirmation du Boss, montrée dans CETTE conversation. Une question CONFIRM / CHOICE
  // posée APRÈS la confirmation (ou une réponse au message de la question) garde la priorité.
  if (word && pending) {
    const target = pendingTargeted(pending, { replyTo, chatId: input.chat?.chatId ?? null, current });
    if (target === "target" || (target === "other-chat" && word === "yes" && replyTo === null && !pending.expired)) {
      const speaker = input.speaker;
      if (speaker && speaker.kind !== "admin") {
        const r = { reply: await notYoursReply(deps) };
        await remember(deps, input, r, { actionKey: "confirmation", status: "refused" });
        return { handled: true, ...r };
      }
      if (target === "other-chat") {
        const r = { reply: PENDING_OTHER_CHAT };
        await remember(deps, input, r, { actionKey: "confirmation", status: "refused" });
        return { handled: true, ...r };
      }
      const strict = pending.expired ? null : voiceStrictRefusal(pending, word, voice, input.spokenText ?? text);
      if (strict) return { handled: true, reply: strict };
      const r = await resolveBossPending(deps, word);
      if (r.handled) {
        const { handled: _h, ...reply } = r;
        await remember(deps, input, reply, { actionKey: `confirmation:${pending.actionKey}`, status: word === "yes" ? "done" : "refused" });
        return { handled: true, ...reply };
      }
    }
  }

  // 4. Numéro d'une question de précision du Boss.
  if (/^\s*\d{1,2}\s*[).]?\s*$/.test(text) && !(current && (current.kind === "CHOICE" || current.kind === "CONFIRM") && replyTo !== null)) {
    const found = await readClarify(deps);
    // Seulement la personne qui a reçu la question, dans sa conversation (jamais le numéro d'un autre).
    const clarify = found && clarifyIsFor(found, { speaker: input.speaker, chatId: input.chat?.chatId ?? null }) ? found : null;
    const choiceFirst = current?.kind === "CHOICE" && clarify && (current.askedAt?.getTime() ?? 0) > new Date(clarify.createdAt).getTime();
    if (clarify && !choiceFirst) {
      const n = Number(text.replace(/\D/g, ""));
      const opt = clarify.options[n - 1];
      const action = bossAction(clarify.actionKey);
      if (!opt || !action) {
        const r = { reply: `Réponds par un numéro de 1 à ${clarify.options.length}.` };
        return { handled: true, ...r };
      }
      await clearClarify(deps);
      const params = { ...clarify.params, [clarify.field]: opt.value };
      const parsed = action.parse(params);
      if (!parsed.ok) return { handled: true, reply: oopsReply(parsed.error) };
      const actor = await bossActorOf(deps, input.speaker);
      const r = await runBossAction(deps, action, parsed.params as Record<string, unknown>, { actor, inputText: text, speaker: input.speaker, chat: input.chat, mentions: input.mentions });
      const { status, ...reply } = r;
      await remember(deps, input, reply, { actionKey: action.key, status });
      return { handled: true, ...reply };
    }
  }

  // 5. Aide, commencer, annule, commandes exactes et réponses aux questions ouvertes.
  const n = normalizeText(text);
  for (const [set, key] of [
    [AIDE, "aide"],
    [COMMENCER, "commencer"],
    [QUI, "qui_fait_quoi"],
  ] as const) {
    if (set.has(n)) {
      const action = bossAction(key)!;
      const actor = await bossActorOf(deps, input.speaker);
      if (!bossActionAllowed(action, input.speaker)) return { handled: true, reply: await notYoursReply(deps) };
      const r = await action.execute(deps, {}, actor);
      await remember(deps, input, r, { actionKey: key, status: "done" });
      return { handled: true, ...r };
    }
  }
  if (input.speaker && input.speaker.kind !== "admin") {
    // Membre de l'équipe : les commandes exactes passent par le catalogue (droits vérifiés), sans IA.
    const cmd = parseAdminCommand(text);
    const mapped = cmd ? memberCommandAction(cmd) : null;
    const action = mapped ? bossAction(mapped.key) : null;
    if (mapped && action) {
      const parsed = action.parse(mapped.params);
      if (parsed.ok) {
        const actor = await bossActorOf(deps, input.speaker);
        const r = await runBossAction(deps, action, parsed.params as Record<string, unknown>, { actor, inputText: text, speaker: input.speaker, chat: input.chat, mentions: input.mentions });
        const { status, ...reply } = r;
        await remember(deps, input, reply, { actionKey: action.key, status });
        return { handled: true, ...reply };
      }
    }
    return { handled: false, needsAi: true };
  }
  const admin = await handleAdminText(deps, {
    text: input.text,
    messageId: input.messageId,
    replyToMessageId: replyTo,
    source: voice ? "voice" : "text",
    entities: input.entities,
    spokenText: input.spokenText,
    chat: input.chat,
  });
  if (admin.handled) {
    const r = fromAdmin(admin);
    await remember(deps, input, r, { actionKey: parseAdminCommand(text)?.type ?? "demande", status: "done" });
    return { handled: true, ...r };
  }
  if (word === "cancel" || word === "no") {
    await clearClarify(deps);
    const r = { reply: word === "cancel" ? NOTHING_TO_CANCEL : "D'accord, je ne fais rien." };
    await remember(deps, input, r, { actionKey: "annule", status: "done" });
    return { handled: true, ...r };
  }
  if (word === "yes" || parseYesNo(text) === "oui") {
    // « ok », « 👍 » ne confirment jamais une action : Kevin le dit s'il y en a une en attente.
    const r = {
      reply:
        pending && !pending.expired
          ? word
            ? "Pour confirmer, réponds OUI sans « Répondre » à un autre message, ou appuie sur le bouton ✅ OUI."
            : "Pour confirmer, réponds OUI (ou appuie sur le bouton ✅ OUI)."
          : NOTHING_TO_CONFIRM,
    };
    await remember(deps, input, r, { actionKey: "confirmation", status: "refused" });
    return { handled: true, ...r };
  }

  // 6. Question TEXT ouverte : le message suivant est la réponse (le client n'arrive pas à utiliser « Répondre »),
  // seulement pour une question adressée à l'admin et posée dans cette conversation ; jamais un accusé court ni un
  // message à emojis animés.
  if (current && current.kind === "TEXT" && replyTo === null && !isSkipText(text) && !isAckText(text) && !hasCustomEmoji(input) && !looksLikeOrderOrQuestion(text)) {
    const req = current as typeof current & { assigneeTelegramId?: bigint | null; chatId?: bigint | null; remindedAt?: Date | null };
    const adminId = await adminTelegramId(deps);
    const forAdmin = req.assigneeTelegramId == null || (adminId != null && req.assigneeTelegramId === adminId);
    const conv = input.chat?.type === "group" ? input.chat.chatId : null;
    const sameConv = (req.chatId ?? null) === conv;
    if (forAdmin && sameConv) {
      const askedMs = Math.max(req.askedAt?.getTime() ?? 0, req.remindedAt?.getTime() ?? 0);
      const recent = askedMs > 0 && nowOf(deps).getTime() - askedMs < TEXT_ANSWER_WINDOW_MS;
      const lastFromKevin = askedMs > 0 && !(await deps.prisma.bossTurn.findFirst({
        where: {
          role: "BOSS",
          createdAt: { gt: new Date(askedMs) },
          ...(input.chat ? { OR: [{ chatId: input.chat.chatId }, { chatId: null }] } : {}),
        },
      }));
      if (!recent && !lastFromKevin) {
        // Doute : Kevin demande d'abord si c'est bien la réponse (confirmation du Boss, OUI / NON).
        const short = text.length > 80 ? `${text.slice(0, 79)}…` : text;
        const r = await createBossPending(deps, {
          actionKey: "repondre_demande_confirmee",
          params: { demande: req.id, reponse: text.slice(0, 2000) },
          summary: `C'est ta réponse à : « ${shortQuestion(req.question)} » ?\nRéponse : « ${short} »`,
          chatId: input.chat?.chatId ?? null,
        });
        await remember(deps, input, r, { actionKey: "repondre_demande", status: "confirm" });
        return { handled: true, ...r };
      }
      const actor = await bossActorOf(deps, input.speaker);
      const res = await respondToRequest(deps, current, text, { userId: actor.userId, via: "TELEGRAM" }, { deferNext: true, confirmText: input.spokenText ?? text });
      const r: BossReply = {
        reply: esc(res.message),
        followUp: res.closed
          ? async () => {
              await sendNextHumanRequest(deps);
            }
          : undefined,
      };
      await remember(deps, input, r, { actionKey: "repondre_demande", status: res.ok ? "done" : "refused" });
      return { handled: true, ...r };
    }
  }

  return { handled: false, needsAi: true };
}

/** Commande exacte d'un membre → entrée du catalogue (jamais les secrets ni le plafond vidéo de l'ancien dialogue) (pur). */
export function memberCommandAction(cmd: AdminCommand): { key: string; params: Record<string, unknown> } | null {
  const team = (t: string) => (t === "all" ? "tout" : t);
  switch (cmd.type) {
    case "status":
      return { key: "etat_general", params: {} };
    case "report":
      return { key: "rapport_du_jour", params: {} };
    case "requests":
      return { key: "demandes_ouvertes", params: {} };
    case "later":
      return { key: "plus_tard", params: {} };
    case "pause":
      return { key: "pause", params: { equipe: team(cmd.team) } };
    case "resume":
      return { key: "reprise", params: { equipe: team(cmd.team) } };
    case "approve":
      return { key: "valider_post", params: { numero: cmd.number } };
    case "reject":
      return { key: "refuser_post", params: { numero: cmd.number, ...(cmd.reason ? { raison: cmd.reason } : {}) } };
    case "live":
      return { key: "simulation", params: { equipe: cmd.team, mode: "vrai" } };
    case "level":
      return { key: "niveau", params: { equipe: cmd.team, niveau: cmd.level } };
    default:
      return null;
  }
}

/** Chemin rapide (webhook) : réponse immédiate, ou passage à l'interprète. Ne lève jamais. */
export async function bossFastPath(deps: BossDeps, input: BossTeamInput): Promise<BossFastResult> {
  try {
    return await fastPathInner(deps, input);
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[boss] chemin rapide en échec");
    return { handled: true, reply: oopsReply((err as Error).message || "erreur interne") };
  }
}

