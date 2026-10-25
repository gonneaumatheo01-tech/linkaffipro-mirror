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
  confirmText,
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
import { inspirationFastPath } from "./catalog-inspiration";
import { orderQuickCancel } from "../orders/recap";
import { pick, voiceTemplate, type VoiceTable } from "./voice";

/** Textes fixes du chemin rapide (charte `docs/KEVIN-VOIX.md`). */
export const FAST_VARIANTS = {
  forwarded: [
    "Bien reçu ce message transféré. Je ne fais rien de ce qu'il contient : tu veux que j'en fasse quoi ?",
    "J'ai le message transféré, je n'exécute rien de ce qu'il dit. Tu veux en faire quoi ?",
    "Message transféré reçu. Je le garde comme info, sans rien lancer. Je m'en sers comment ?",
  ],
  empty: [
    "Je n'ai rien lu dans ce message. Tu me dis ce que tu veux en quelques mots ?",
    "Ton message est vide de mon côté. Tu me l'écris en quelques mots ?",
  ],
  numberRange: voiceTemplate([{ max: 3 }], (p: { max: number }) => [
    `Réponds juste par un numéro, de 1 à ${p.max}.`,
    `Il me faut un numéro entre 1 et ${p.max}.`,
  ]),
  noted: ["C'est noté ✅", "Noté ✅", "Ok, c'est noté ✅"],
  doNothing: ["D'accord, je ne fais rien.", "Ok, je ne touche à rien.", "Pas de souci, je laisse comme ça."],
  confirmNoReply: [
    "Pour confirmer, réponds OUI sans « Répondre » à un autre message, ou appuie sur le bouton ✅ OUI.",
    "Il me faut un OUI tout seul, pas en réponse à un autre message. Ou appuie sur le bouton ✅ OUI.",
  ],
  confirmHow: [
    "Pour confirmer, réponds OUI (ou appuie sur le bouton ✅ OUI).",
    "« ok » ne suffit pas pour ça : réponds OUI, ou appuie sur le bouton ✅ OUI.",
  ],
  replaceBoss: voiceTemplate([{ username: "kevin_boss_bot" }], (p: { username: string }) => [
    `Kevin existe déjà (@${p.username}). Je le remplace par ce nouveau bot ?\nL'ancien ne répondra plus à l'équipe.`,
    `Il y a déjà un Kevin (@${p.username}). Je passe sur ce nouveau bot ?\nL'ancien ne répondra plus à l'équipe.`,
  ]),
  answerDoubt: voiceTemplate([{ question: "Quelle tenue pour Léa ?", answer: "robe rouge" }], (p: { question: string; answer: string }) => [
    `C'est ta réponse à « ${p.question} » ?\nTa réponse : « ${p.answer} »`,
    `Je prends ça comme réponse à « ${p.question} » ?\nTa réponse : « ${p.answer} »`,
  ]),
  hello: [
    "Salut ! Écris « commencer » pour la mise en route, ou demande-moi par exemple « combien j'ai dépensé ce mois ? ». « aide » te montre ce que je sais faire.",
    "Salut 👋 Tu veux faire quoi ? Par exemple « combien j'ai dépensé ce mois ? », ou « commencer » pour la mise en route.",
    "Hello ! Dis-moi ce qu'il te faut. Si tu débutes, écris « commencer ». Pour des idées, écris « aide ».",
  ],
  howAreYou: [
    "Ça roule de mon côté 👍 Écris « agents » pour l'état des équipes, ou « commencer » pour la mise en route.",
    "Ça va bien, merci. Tu veux l'état des équipes ? Écris « agents ».",
    "Tranquille, les équipes tournent. Écris « agents » si tu veux voir où elles en sont.",
  ],
  thanks: ["Avec plaisir 👍", "De rien !", "Avec plaisir, je suis là si besoin."],
  areYouABot: [
    "Je suis le bot de l'équipe, pas une personne. Je pilote les agents avec toi.",
    "Je suis un bot, celui de l'équipe, qui fait tourner les agents.",
    "Franchement : je suis le bot de l'équipe, pas un humain. Ça ne m'empêche pas de bosser.",
  ],
} satisfies VoiceTable;

export const FORWARDED_REPLY = FAST_VARIANTS.forwarded[0]!;

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
    reply: r.reply ?? pick(FAST_VARIANTS.noted, "fast.noted"),
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
  const active = (await deps.prisma.bot.findFirst({ where: BOSS_BOT_WHERE, orderBy: { createdAt: "desc" }, select: { username: true } }).catch(() => null)) as { username: string } | null;
  if (active) {
    const r = await createBossPending(deps, {
      actionKey: "remplacer_boss",
      params: { jeton: encrypt(token) },
      summary: pick(FAST_VARIANTS.replaceBoss({ username: active.username }), "fast.replaceBoss", input.chat?.chatId ?? null),
      chatId: input.chat?.chatId ?? null,
    });
    return { ...r, deleteMessage: true };
  }
  const actor = await bossActorOf(deps, input.speaker);
  return { reply: await registerBossToken(deps, token, actor.userId), deleteMessage: true };
}

/** Le Boss actif (même filtre que `BOSS_BOT_WHERE` de `@linkaffipro/telegram/admin-bot`, que ce paquet n'importe pas). */
const BOSS_BOT_WHERE = {
  isActive: true,
  role: "ADMIN" as const,
  mode: "STANDARD" as const,
  userbotAccounts: { none: {} },
  NOT: { username: { startsWith: "userbot_" } },
};

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
    const r = { reply: pick(FAST_VARIANTS.empty, "fast.empty", input.chat?.chatId ?? null) };
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
    const r = { reply: pick(FAST_VARIANTS.forwarded, "fast.forwarded", input.chat?.chatId ?? null) };
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
        const r = { reply: confirmText("otherChat", input.chat?.chatId ?? null) };
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

  // Phase 27 : numéros en réponse au choix d'inspiration (plus récent que toute autre question, jamais en « Répondre »
  // à un autre message) ; « annule » juste après une application. Sans IA, admin seulement.
  {
    const clarifyNow = await readClarify(deps);
    // Toute question ouverte compte (texte, choix, confirmation), et la précision du Boss.
    const otherQuestionAt = Math.max(current ? (current.askedAt?.getTime() ?? 0) : 0, clarifyNow ? new Date(clarifyNow.createdAt).getTime() : 0);
    // Phase 33 : « annule » dans la minute qui suit un ordre lancé sans confirmation (chantier B, `orders/recap.ts`).
    const insp = (await orderQuickCancel(deps, input, { word, pendingOpen: !!pending && !pending.expired })) ?? await inspirationFastPath(deps, input, {
      word,
      pendingOpen: !!pending && !pending.expired,
      otherQuestionAt,
      run: async (action, params) => {
        const actor = await bossActorOf(deps, input.speaker);
        const { status: _s, ...reply } = await runBossAction(deps, action, params, { actor, inputText: text, speaker: input.speaker, chat: input.chat, mentions: input.mentions });
        return reply;
      },
    });
    if (insp) {
      await remember(deps, input, insp.reply, { actionKey: insp.actionKey, status: "done" });
      return { handled: true, ...insp.reply };
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
        const r = { reply: pick(FAST_VARIANTS.numberRange({ max: clarify.options.length }), "fast.numberRange", input.chat?.chatId ?? null) };
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
    const chatId = input.chat?.chatId ?? null;
    const r = { reply: word === "cancel" ? confirmText("nothingToCancel", chatId) : pick(FAST_VARIANTS.doNothing, "fast.doNothing", chatId) };
    await remember(deps, input, r, { actionKey: "annule", status: "done" });
    return { handled: true, ...r };
  }
  if (word === "yes" || parseYesNo(text) === "oui") {
    // « ok », « 👍 » ne confirment jamais une action : Kevin le dit s'il y en a une en attente.
    const chatId = input.chat?.chatId ?? null;
    const r = {
      reply:
        pending && !pending.expired
          ? pick(word ? FAST_VARIANTS.confirmNoReply : FAST_VARIANTS.confirmHow, word ? "fast.confirmNoReply" : "fast.confirmHow", chatId)
          : confirmText("nothingToConfirm", chatId),
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
          summary: pick(FAST_VARIANTS.answerDoubt({ question: shortQuestion(req.question), answer: short }), "fast.answerDoubt", input.chat?.chatId ?? null),
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

  // Politesse (« salut », « ça va ? », « merci », « t'es un bot ? ») : réponse simple et gratuite (jamais l'IA), variée
  // d'un message à l'autre.
  const small = smallTalkReply(text, input.chat?.chatId ?? null);
  if (small) {
    const r: BossReply = { reply: small };
    await remember(deps, input, r, { actionKey: "politesse", status: "done" });
    return { handled: true, ...r };
  }

  return { handled: false, needsAi: true };
}

const GREETINGS = new Set(["salut", "bonjour", "bonsoir", "coucou", "hello", "hey", "yo", "slt", "cc", "wesh"]);
const HOW_ARE_YOU = new Set(["ca va", "ca va ?", "comment ca va", "ca va bien", "tu vas bien", "comment tu vas", "quoi de neuf", "la forme"]);
const THANKS = new Set(["merci", "merci beaucoup", "merci bien", "top merci", "super merci", "parfait merci", "thanks", "merci kevin"]);
/** « t'es un bot ? » posé sincèrement : Kevin répond franchement (charte, honnêteté). */
const ARE_YOU_A_BOT =
  /^(?:(?:dis|dis moi|serieux|serieusement|franchement|au fait|attends)\s+)?(?:t'es|t es|tes|tu es|es tu|es-tu|est ce que tu es|est-ce que tu es|c'est|c est|t'es pas|tu n'es pas|tu es pas)\s+(?:un|une|vraiment un|vraiment une|un vrai|une vraie)?\s*(?:bot|robot|ia|i a|intelligence artificielle|machine|humain|vrai humain|une vraie personne|vraie personne|personne reelle)(?:\s+ou\s+(?:quoi|pas|un humain|une vraie personne|un bot))?$/u;

/** La phrase demande-t-elle sincèrement si Kevin est un bot (pur) ? */
export function isAreYouABotQuestion(text: string): boolean {
  const n = normalizeText(text)
    .replace(/[\p{Extended_Pictographic}\uFE0F!.,…?]+/gu, " ")
    .replace(/\bkevin\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ARE_YOU_A_BOT.test(n);
}

/**
 * Petites phrases de politesse (pur sauf la rotation des variantes) : « salut », « ça va ? », « bonjour Kevin »,
 * « merci », « t'es un bot ? ». Rend la réponse, ou null. Une phrase qui contient une demande (« salut, combien j'ai
 * dépensé ? ») n'est pas de la politesse : null. Même conversation : jamais deux fois de suite la même phrase.
 */
export function smallTalkReply(text: string, chatId?: bigint | string | number | null): string | null {
  const n = normalizeText(text)
    .replace(/[\p{Extended_Pictographic}\uFE0F!.,…]+/gu, " ")
    .replace(/\bkevin\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return null;
  const words = n.replace(/\s*\?$/, "").trim();
  const say = (key: "hello" | "howAreYou" | "thanks" | "areYouABot") => pick(FAST_VARIANTS[key], `fast.${key}`, chatId ?? null);
  if (isAreYouABotQuestion(text)) return say("areYouABot");
  if (GREETINGS.has(words)) return say("hello");
  const tail = words.split(" ");
  // « salut ça va », « bonjour, comment ça va ».
  const withoutGreeting = GREETINGS.has(tail[0]!) ? tail.slice(1).join(" ") : words;
  if (HOW_ARE_YOU.has(withoutGreeting) || HOW_ARE_YOU.has(`${withoutGreeting} ?`)) return say("howAreYou");
  if (THANKS.has(words)) return say("thanks");
  return null;
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

