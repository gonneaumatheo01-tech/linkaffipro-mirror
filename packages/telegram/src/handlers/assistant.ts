import type { Bot } from "grammy";
import { detectMinor, fixedText, type FixedTextKey } from "@linkaffipro/chat";
import { pickLang, t } from "../i18n";
import { isAssistantBot, type BotIdentity } from "../ports";
import type { AssistantConversation, AssistantDeps, AssistantPersonaInfo } from "../assistant/deps";
import {
  adminLinkToken,
  assistantCommandOf,
  assistantReplyLang,
  canReopenConversation,
  classifyAssistantMessage,
  cleanStartSource,
  conversationPersonaId,
  fixedReplyAllowed,
} from "../assistant/logic";
import { seenMemberIdOf } from "./core";

let defaultDeps: AssistantDeps | null = null;
async function loadDefaultDeps(): Promise<AssistantDeps> {
  if (!defaultDeps) defaultDeps = (await import("../assistant/prisma-deps")).prismaAssistantDeps;
  return defaultDeps;
}

function warn(message: string, err: unknown, details: Record<string, unknown> = {}): void {
  console.warn(`[assistant] ${message}`, {
    ...details,
    error: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Réception par un bot en mode assistant de conversation (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 4).
 * Conversations privées seulement (rien en groupe ni en canal, messages de bots ignorés) ; aucune prise de contact :
 * le bot ne fait que recevoir. Le webhook n'appelle JAMAIS l'IA : il enregistre le message et met un tour en file
 * (`chat`), seulement si l'assistant peut répondre à cette personne (bot en mode assistant, persona de la conversation
 * active — même règle que le worker —, activation, conversation ni reprise par l'équipe, ni fermée, ni stoppée, ni
 * mineure). Sinon le message est seulement gardé (boîte de réception).
 * - `/start [source]` : conversation créée si besoin, source gardée (première reçue), message entrant `/start` pour que
 *   l'assistant se présente ; `/start admin_<jeton>` (Mon compte) lie le compte Telegram de l'équipe, sans conversation ;
 * - `/stop` : définitif (plus aucune réponse ni relance), réponse fixe si l'activation permet de répondre à la personne ;
 *   une demande d'arrêt écrite sans la barre oblique (« STOP », « arrête de m'écrire », « unsubscribe »…, seule dans le
 *   message) vaut /stop ;
 * - `/reset` : historique, résumé, faits et style effacés (une seule fois par /reset, même renvoyé par Telegram) ; après
 *   un `/stop`, rien ne repart (réponse fixe « tu m'as demandé de ne plus t'écrire » une fois par jour au plus) ;
 * - tout autre message (texte, photo, autocollant, vocal…) : enregistré (une update renvoyée est ignorée), tour en file ;
 *   un âge déclaré de moins de 18 ans (règle 3) est détecté ICI, quel que soit le statut (équipe aux commandes, limite
 *   du jour, persona désactivée…) : conversation fermée (mineur) dans la même transaction que le message, texte fixe
 *   d'arrêt seulement si l'assistante avait la parole.
 * Aucune réponse fixe vers un mineur ni vers une conversation bloquée par l'équipe.
 * Une conversation fermée seulement parce que l'envoi avait échoué (bot bloqué, personne injoignable) repart quand la
 * personne réécrit d'elle-même. Les boutons (`callback_query`) reçoivent seulement leur accusé de réception.
 */
export function registerAssistantHandlers(
  bot: Bot,
  identity: BotIdentity,
  deps?: AssistantDeps,
): void {
  bot.on("callback_query", async (ctx) => {
    await ctx.answerCallbackQuery().catch((err: unknown) => warn("accusé du bouton", err));
  });

  // Bot bloqué par la personne : plus aucune relance prévue. Le statut du bot (core) suit.
  bot.on("my_chat_member", async (ctx, next) => {
    const upd = ctx.myChatMember;
    const status = upd.new_chat_member.status;
    if (upd.chat.type === "private" && (status === "kicked" || status === "left")) {
      const d = deps ?? (await loadDefaultDeps());
      await d
        .conversationBlocked?.({
          botId: identity.id,
          telegramUserId: BigInt(upd.from.id),
          at: new Date(),
        })
        .catch((err: unknown) => warn("blocage non enregistré", err, { botId: identity.id }));
    }
    await next();
  });

  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    const from = ctx.from;
    if (!from || from.is_bot || msg.chat.type !== "private" || msg.chat.id !== from.id) return;
    const d = deps ?? (await loadDefaultDeps());
    const now = new Date();
    const telegramUserId = BigInt(from.id);
    const memberIdOf = async (): Promise<string> =>
      seenMemberIdOf(ctx.update) ?? (await d.memberSeen(identity, from)).memberId;
    const conversationOf = (memberId: string, source: string | null) =>
      d.ensureConversation({
        botId: identity.id,
        memberId,
        personaId: identity.personaId ?? null,
        source,
      });

    // Persona lue une fois par update (réponse fixe et contrôle « peut répondre »).
    const personas = new Map<string, Promise<AssistantPersonaInfo | null>>();
    const personaOf = (conv: AssistantConversation): Promise<AssistantPersonaInfo | null> => {
      const id = conversationPersonaId(conv, identity);
      if (!id) return Promise.resolve(null);
      let p = personas.get(id);
      if (!p) {
        p = d.persona(id);
        personas.set(id, p);
      }
      return p;
    };

    /**
     * L'assistant peut-il répondre à cette personne ? Bot en mode assistant, persona de la conversation (sinon du bot)
     * active, activation (désactivé / équipe / tout le monde). Même règle que le contrôle du worker avant l'appel.
     */
    const assistantMayReply = async (conv: AssistantConversation): Promise<boolean> => {
      if (!isAssistantBot(identity)) return false;
      const persona = await personaOf(conv);
      if (!persona?.isActive) return false;
      return d.activationAllows(telegramUserId);
    };

    /** Texte fixe (langue de la conversation ou de la personne), gardé dans la conversation. Ne lève jamais. */
    const sendFixed = async (conv: AssistantConversation, key: FixedTextKey): Promise<void> => {
      const persona = await personaOf(conv);
      const lang = assistantReplyLang({
        conversationLanguage: conv.language,
        memberLanguage: from.language_code,
        personaLanguages: persona?.languages,
      });
      const text = fixedText(lang, key, { name: persona?.name, gender: persona?.gender });
      let telegramMessageId: number | null = null;
      try {
        const sent = await ctx.reply(text, { link_preview_options: { is_disabled: true } });
        telegramMessageId = sent.message_id;
      } catch (err) {
        warn("texte fixe non envoyé", err, { conversationId: conv.id, key });
        return;
      }
      await d.recordFixedReply({
        conversationId: conv.id,
        key,
        text,
        telegramMessageId,
        at: new Date(),
      });
    };

    /** Après un /stop : « tu m'as demandé de ne plus t'écrire », une fois par jour au plus. */
    const replyStoppedAlready = async (conv: AssistantConversation, memberId: string) => {
      if (!fixedReplyAllowed(conv)) return;
      if (!(await assistantMayReply(conv))) return;
      const claimed = await d.claimStoppedReply({
        conversationId: conv.id,
        botId: identity.id,
        memberId,
        at: now,
      });
      if (claimed) await sendFixed(conv, "stoppedAlready");
    };

    /** Tour de l'assistant en file, seulement s'il peut répondre à cette personne. */
    const maybeEnqueue = async (conv: AssistantConversation): Promise<void> => {
      if (conv.status !== "BOT" || conv.stoppedAt || conv.isMinor) return;
      if (!(await assistantMayReply(conv))) return;
      // File indisponible : le message reste non traité, le passage périodique du worker le remet en file.
      await d
        .enqueueTurn(conv.id)
        .catch((err: unknown) => warn("tour non mis en file", err, { conversationId: conv.id }));
    };

    /**
     * Conversation fermée seulement parce que l'envoi avait échoué (bot bloqué, personne injoignable) : la personne
     * réécrit d'elle-même, elle repart. Jamais après un /stop, pour un mineur ni après une fermeture par l'équipe.
     */
    const reopenIfNeeded = async (
      conv: AssistantConversation,
      memberId: string,
    ): Promise<AssistantConversation> => {
      if (!canReopenConversation(conv)) return conv;
      const reopened = await d.reopenConversation({
        conversationId: conv.id,
        botId: identity.id,
        memberId,
        at: now,
      });
      return reopened ?? conv;
    };

    const cmd =
      typeof msg.text === "string" ? assistantCommandOf(msg.text, identity.username) : null;

    if (cmd?.command === "start") {
      // Lien « Lier votre Telegram » de Mon compte : liaison seulement, aucune conversation, jeton jamais journalisé.
      const adminToken = adminLinkToken(cmd.payload);
      if (adminToken !== null) {
        const linked = adminToken ? await d.linkAdminAccount(adminToken, telegramUserId) : null;
        await d.memberStarted(identity, from, undefined);
        const lang = pickLang(from.language_code);
        await ctx
          .reply(
            linked ? t(lang, "adminLinked", { name: linked.name }) : t(lang, "adminLinkInvalid"),
          )
          .catch((err: unknown) => warn("réponse de liaison non envoyée", err));
        return;
      }
      const source = cleanStartSource(cmd.payload);
      // Journal (`member.start`) : la source nettoyée seulement, jamais un texte tapé après /start.
      const { memberId } = await d.memberStarted(identity, from, source ?? undefined);
      const conv = await reopenIfNeeded(await conversationOf(memberId, source), memberId);
      // Le /start est un message entrant (sans compter comme un échange) : l'assistant se présente en réponse.
      const { duplicate } = await d.recordInbound({
        conversationId: conv.id,
        telegramMessageId: msg.message_id,
        text: "/start",
        media: null,
        meta: { command: "start", ...(source ? { source } : {}) },
        countsAsExchange: false,
        at: now,
      });
      if (duplicate) return;
      if (conv.stoppedAt) await replyStoppedAlready(conv, memberId);
      else await maybeEnqueue(conv);
      return;
    }

    if (cmd?.command === "stop") {
      const memberId = await memberIdOf();
      const conv = await conversationOf(memberId, null);
      // Déjà stoppée : rien de nouveau.
      if (conv.stoppedAt) return;
      const { changed } = await d.stopConversation({
        conversationId: conv.id,
        botId: identity.id,
        memberId,
        at: now,
      });
      if (!changed) return;
      // « STOP » écrit sans la barre oblique : gardé dans le fil (sans compter comme un échange, sans réponse de l'IA).
      if (cmd.typed)
        await d
          .recordInbound({
            conversationId: conv.id,
            telegramMessageId: msg.message_id,
            text: msg.text ?? "",
            media: null,
            meta: { command: "stop", typed: true },
            countsAsExchange: false,
            at: now,
          })
          .catch((err: unknown) =>
            warn("demande d'arrêt non gardée", err, { conversationId: conv.id }),
          );
      if (!fixedReplyAllowed(conv)) return;
      if (await d.activationAllows(telegramUserId)) await sendFixed(conv, "stopDone");
      return;
    }

    if (cmd?.command === "reset") {
      const memberId = await memberIdOf();
      const conv = await reopenIfNeeded(await conversationOf(memberId, null), memberId);
      const { duplicate } = await d.resetConversation({
        conversationId: conv.id,
        botId: identity.id,
        memberId,
        telegramMessageId: msg.message_id,
        at: now,
      });
      // Même /reset renvoyé par Telegram : déjà effacé et déjà répondu.
      if (duplicate) return;
      if (conv.stoppedAt) {
        await replyStoppedAlready(conv, memberId);
        return;
      }
      // Conversation fermée, mineure, reprise par l'équipe ou en pause : l'assistant se tait.
      if (!fixedReplyAllowed(conv) || conv.status !== "BOT") return;
      if (await assistantMayReply(conv)) await sendFixed(conv, "resetDone");
      return;
    }

    const inbound = classifyAssistantMessage(msg);
    if (!inbound) return;
    const memberId = await memberIdOf();
    const conv = await reopenIfNeeded(await conversationOf(memberId, null), memberId);
    // Âge déclaré de moins de 18 ans (règle 3) : détecté à la réception, quel que soit le statut de la conversation.
    const minor = detectMinor(inbound.text);
    const { duplicate, minorClosed } = await d.recordInbound({
      conversationId: conv.id,
      telegramMessageId: msg.message_id,
      text: inbound.text,
      media: inbound.media,
      meta: minor.minor ? { minor: true } : {},
      countsAsExchange: true,
      ...(minor.minor && !conv.isMinor
        ? { minor: { age: minor.age, botId: identity.id, memberId } }
        : {}),
      at: now,
    });
    if (duplicate) return;
    if (minorClosed) {
      // L'assistante avait la parole : arrêt poli (texte fixe, jamais de lien) ; sinon rien ne part.
      if (minorClosed.wasAnswering && (await assistantMayReply(conv)))
        await sendFixed(conv, "minorStop");
      return;
    }
    await maybeEnqueue(conv);
  });
}
