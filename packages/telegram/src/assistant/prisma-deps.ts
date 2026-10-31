// Implémentation Prisma des dépendances de la réception par le bot assistant (phase 17, contrat § 4). Aucun texte de
// conversation n'est écrit dans la table `Event` : seulement des identifiants et des compteurs.
import {
  ASSISTANT_SETTING_KEY,
  canAssistantReply,
  parisDayStart,
  parseAssistantConfig,
} from "@linkaffipro/chat";
import { prisma, recordEvent, toJsonValue, type Prisma } from "@linkaffipro/db";
import { enqueueChatTurn } from "@linkaffipro/queue";
import { prismaTelegramDeps } from "../prisma-deps";
import { createConversationLock, type ConversationLock } from "./conversation-lock";
import type { AssistantConversation, AssistantDeps } from "./deps";
import { canReopenConversation, reopenStage, resetStage } from "./logic";
import { isAssistantTeamMember } from "./team";

/** Violation d'unicité Prisma (P2002) : enregistrement créé par un appel concurrent, ou update renvoyée par Telegram. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

const conversationSelect = {
  id: true,
  status: true,
  stage: true,
  isMinor: true,
  stoppedAt: true,
  closedReason: true,
  language: true,
  personaId: true,
  source: true,
} as const satisfies Prisma.ConversationSelect;

/** Événement de conversation (append-only, sans texte) doublé dans le journal (`conversation.<type>`). */
async function conversationEvent(
  tx: Prisma.TransactionClient,
  input: {
    conversationId: string;
    type: string;
    fromStage?: AssistantConversation["stage"] | null;
    toStage?: AssistantConversation["stage"] | null;
    payload?: Record<string, unknown>;
    at: Date;
  },
): Promise<void> {
  await tx.conversationEvent.create({
    data: {
      conversationId: input.conversationId,
      type: input.type,
      fromStage: input.fromStage ?? null,
      toStage: input.toStage ?? null,
      payload: toJsonValue(input.payload ?? {}),
      createdAt: input.at,
    },
  });
}

/** Doublon dans le journal `Event` (ne lève jamais). */
async function journal(
  type: string,
  input: {
    botId: string;
    memberId: string;
    conversationId: string;
    payload?: Record<string, unknown>;
    at: Date;
  },
): Promise<void> {
  await recordEvent({
    type: `conversation.${type}`,
    botId: input.botId,
    memberId: input.memberId,
    occurredAt: input.at,
    payload: toJsonValue({ conversationId: input.conversationId, ...(input.payload ?? {}) }),
  });
}

/** Erreur gardée sur un message de l'assistant ou de l'équipe encore en file au moment d'un /reset. */
export const RESET_CANCELLED_ERROR = "Annulé : la personne a demandé /reset (tout effacer).";

/** Le /start (`meta.command`) n'est pas un échange : il ne compte pas dans `memberMessages`. */
function isCommandMeta(meta: unknown): boolean {
  return (
    typeof meta === "object" &&
    meta !== null &&
    !Array.isArray(meta) &&
    typeof (meta as { command?: unknown }).command === "string"
  );
}

export type PrismaAssistantDepsOptions = {
  /** Verrou de la conversation (celui du worker) pour /reset ; par défaut Redis, attente bornée. */
  lock?: ConversationLock;
};

export function createPrismaAssistantDeps(opts: PrismaAssistantDepsOptions = {}): AssistantDeps {
  const lock =
    opts.lock ??
    createConversationLock({
      onFallback: ({ conversationId, reason }) =>
        console.warn("[assistant] /reset sans le verrou de la conversation", {
          conversationId,
          reason,
        }),
    });
  return {
    memberSeen: (bot, from) => prismaTelegramDeps.memberSeen(bot, from),
    memberStarted: (bot, from, payload) => prismaTelegramDeps.memberStarted(bot, from, payload),
    linkAdminAccount: (token, telegramUserId) =>
      prismaTelegramDeps.linkAdminAccount(token, telegramUserId),

    async ensureConversation({ botId, memberId, personaId, source }) {
      const where = { botId_memberId: { botId, memberId } };
      let conv: AssistantConversation;
      try {
        conv = await prisma.conversation.upsert({
          where,
          create: { botId, memberId, personaId, source },
          update: {},
          select: conversationSelect,
        });
      } catch (err) {
        // Deux messages de la même personne traités en même temps : l'autre appel vient de la créer.
        if (!isUniqueViolation(err)) throw err;
        conv = await prisma.conversation.findUniqueOrThrow({ where, select: conversationSelect });
      }
      // Source : la première reçue, jamais écrasée ; persona : celle du bot, posée si elle manquait.
      const setSource = Boolean(source && !conv.source);
      const setPersona = Boolean(personaId && !conv.personaId);
      if (setSource || setPersona) {
        await prisma.conversation.updateMany({
          where: {
            id: conv.id,
            ...(setSource ? { source: null } : {}),
            ...(setPersona ? { personaId: null } : {}),
          },
          data: {
            ...(setSource ? { source } : {}),
            ...(setPersona ? { personaId } : {}),
          },
        });
        conv = await prisma.conversation.findUniqueOrThrow({
          where: { id: conv.id },
          select: conversationSelect,
        });
      }
      return conv;
    },

    async reopenConversation({ conversationId, botId, memberId, at }) {
      const result = await prisma.$transaction(async (tx) => {
        const conv = await tx.conversation.findUnique({
          where: { id: conversationId },
          select: {
            status: true,
            stage: true,
            closedReason: true,
            stoppedAt: true,
            isMinor: true,
            assistantTurns: true,
            convertedAt: true,
          },
        });
        if (!conv || !canReopenConversation(conv)) return null;
        // Étape d'avant la fermeture : celle du dernier passage vers CLOSED.
        const lastClose = await tx.conversationEvent.findFirst({
          where: { conversationId, type: "stage_changed", toStage: "CLOSED" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { fromStage: true },
        });
        const toStage = reopenStage({
          stageBeforeClose: lastClose?.fromStage ?? null,
          assistantTurns: conv.assistantTurns,
          convertedAt: conv.convertedAt,
        });
        // Comparaison-échange : un /stop, une reprise par l'équipe ou une autre réouverture arrivés entre-temps gagnent.
        const { count } = await tx.conversation.updateMany({
          where: {
            id: conversationId,
            status: "CLOSED",
            closedReason: conv.closedReason,
            stoppedAt: null,
            isMinor: false,
          },
          data: {
            status: "BOT",
            stage: toStage,
            closedAt: null,
            closedReason: null,
            nextFollowUpAt: null,
            retryAt: null,
          },
        });
        if (count === 0) return null;
        await conversationEvent(tx, {
          conversationId,
          type: "reopened",
          fromStage: conv.stage,
          toStage,
          payload: { closedReason: conv.closedReason },
          at,
        });
        const stageChanged = conv.stage !== toStage;
        if (stageChanged)
          await conversationEvent(tx, {
            conversationId,
            type: "stage_changed",
            fromStage: conv.stage,
            toStage,
            payload: { reason: "REOPENED" },
            at,
          });
        return { closedReason: conv.closedReason, fromStage: conv.stage, toStage, stageChanged };
      });
      if (!result) return null;
      await journal("reopened", {
        botId,
        memberId,
        conversationId,
        payload: { closedReason: result.closedReason, toStage: result.toStage },
        at,
      });
      if (result.stageChanged)
        await journal("stage_changed", {
          botId,
          memberId,
          conversationId,
          payload: { fromStage: result.fromStage, toStage: result.toStage, reason: "REOPENED" },
          at,
        });
      return prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: conversationSelect,
      });
    },

    async persona(personaId) {
      return prisma.persona.findUnique({
        where: { id: personaId },
        select: { id: true, name: true, gender: true, languages: true, isActive: true },
      });
    },

    async activationAllows(telegramUserId) {
      const row = await prisma.setting.findUnique({ where: { key: ASSISTANT_SETTING_KEY } });
      const { activation } = parseAssistantConfig(row?.value);
      if (activation === "off") return false;
      const isTeamMember =
        activation === "team" ? await isAssistantTeamMember(telegramUserId) : false;
      return canAssistantReply(activation, { isTeamMember });
    },

    async recordInbound(input) {
      type MinorClosure = {
        wasAnswering: boolean;
        fromStage: AssistantConversation["stage"];
        stageChanged: boolean;
      };
      let closure: MinorClosure | null = null;
      try {
        closure = await prisma.$transaction(async (tx) => {
          await tx.conversationMessage.create({
            data: {
              conversationId: input.conversationId,
              direction: "IN",
              author: "MEMBER",
              text: input.text,
              media: input.media ? toJsonValue(input.media) : undefined,
              meta: toJsonValue(input.meta),
              telegramMessageId: BigInt(input.telegramMessageId),
              createdAt: input.at,
            },
            select: { id: true },
          });
          // Le worker recalcule la prochaine relance après sa réponse.
          await tx.conversation.update({
            where: { id: input.conversationId },
            data: {
              lastInboundAt: input.at,
              followUpCount: 0,
              nextFollowUpAt: null,
              ...(input.countsAsExchange ? { memberMessages: { increment: 1 } } : {}),
            },
            select: { id: true },
          });
          if (!input.minor) return null;
          // Âge déclaré de moins de 18 ans : fermée dans la même transaction que le message (un tour de l'assistant ne
          // peut jamais le voir sans voir aussi la fermeture ; son contrôle avant chaque envoi l'arrête).
          const conv = await tx.conversation.findUniqueOrThrow({
            where: { id: input.conversationId },
            select: {
              status: true,
              stage: true,
              isMinor: true,
              stoppedAt: true,
              closedAt: true,
              closedReason: true,
            },
          });
          if (conv.isMinor) return null;
          const alreadyClosed = conv.status === "CLOSED";
          await tx.conversation.update({
            where: { id: input.conversationId },
            data: {
              isMinor: true,
              status: "CLOSED",
              stage: "CLOSED",
              closedAt: alreadyClosed && conv.closedAt ? conv.closedAt : input.at,
              closedReason: alreadyClosed && conv.closedReason ? conv.closedReason : "MINOR",
              nextFollowUpAt: null,
              retryAt: null,
              takenOverById: null,
              takenOverAt: null,
            },
            select: { id: true },
          });
          await conversationEvent(tx, {
            conversationId: input.conversationId,
            type: "minor",
            payload: { source: "reception", age: input.minor.age },
            at: input.at,
          });
          const stageChanged = conv.stage !== "CLOSED";
          if (stageChanged)
            await conversationEvent(tx, {
              conversationId: input.conversationId,
              type: "stage_changed",
              fromStage: conv.stage,
              toStage: "CLOSED",
              payload: { reason: "MINOR" },
              at: input.at,
            });
          return {
            wasAnswering: conv.status === "BOT" && !conv.stoppedAt,
            fromStage: conv.stage,
            stageChanged,
          };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { duplicate: true };
        throw err;
      }
      if (!closure || !input.minor) return { duplicate: false };
      const ref = {
        botId: input.minor.botId,
        memberId: input.minor.memberId,
        conversationId: input.conversationId,
        at: input.at,
      };
      await journal("minor", { ...ref, payload: { source: "reception", age: input.minor.age } });
      if (closure.stageChanged)
        await journal("stage_changed", {
          ...ref,
          payload: { fromStage: closure.fromStage, toStage: "CLOSED", reason: "MINOR" },
        });
      return { duplicate: false, minorClosed: { wasAnswering: closure.wasAnswering } };
    },

    async recordFixedReply(input) {
      try {
        await prisma.conversationMessage.create({
          data: {
            conversationId: input.conversationId,
            direction: "OUT",
            author: "SYSTEM",
            text: input.text,
            meta: toJsonValue({ fixed: input.key }),
            telegramMessageId:
              input.telegramMessageId === null ? null : BigInt(input.telegramMessageId),
            createdAt: input.at,
          },
          select: { id: true },
        });
      } catch (err) {
        console.warn("[assistant] texte fixe non gardé dans la conversation", {
          conversationId: input.conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async stopConversation({ conversationId, botId, memberId, at }) {
      const result = await prisma.$transaction(async (tx) => {
        const conv = await tx.conversation.findUnique({
          where: { id: conversationId },
          select: {
            stage: true,
            status: true,
            stoppedAt: true,
            closedReason: true,
            closedAt: true,
          },
        });
        if (!conv || conv.stoppedAt) return null;
        // Conversation déjà fermée (mineur, équipe) : sa raison de fermeture est gardée.
        const alreadyClosed = conv.status === "CLOSED";
        const { count } = await tx.conversation.updateMany({
          where: { id: conversationId, stoppedAt: null },
          data: {
            stoppedAt: at,
            status: "CLOSED",
            stage: "CLOSED",
            closedAt: alreadyClosed && conv.closedAt ? conv.closedAt : at,
            closedReason: alreadyClosed && conv.closedReason ? conv.closedReason : "STOP",
            nextFollowUpAt: null,
            retryAt: null,
          },
        });
        if (count === 0) return null;
        await conversationEvent(tx, { conversationId, type: "stopped", at });
        const stageChanged = conv.stage !== "CLOSED";
        if (stageChanged)
          await conversationEvent(tx, {
            conversationId,
            type: "stage_changed",
            fromStage: conv.stage,
            toStage: "CLOSED",
            payload: { reason: "STOP" },
            at,
          });
        return { fromStage: conv.stage, stageChanged };
      });
      if (!result) return { changed: false };
      await journal("stopped", { botId, memberId, conversationId, at });
      if (result.stageChanged)
        await journal("stage_changed", {
          botId,
          memberId,
          conversationId,
          payload: { fromStage: result.fromStage, toStage: "CLOSED", reason: "STOP" },
          at,
        });
      return { changed: true };
    },

    async resetConversation({ conversationId, botId, memberId, telegramMessageId }) {
      const { value: result, locked } = await lock(conversationId, (underLock) =>
        prisma.$transaction(async (tx) => {
          // Ligne verrouillée : un même /reset renvoyé par Telegram et traité en même temps passe après le premier.
          const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
          if (rows.length === 0) return null;
          const already = await tx.conversationEvent.findFirst({
            where: {
              conversationId,
              type: "reset",
              payload: { path: ["telegramMessageId"], equals: telegramMessageId },
            },
            select: { id: true },
          });
          if (already) return { duplicate: true as const };
          const conv = await tx.conversation.findUniqueOrThrow({
            where: { id: conversationId },
            select: { stage: true, status: true, convertedAt: true },
          });
          // Heure de l'effacement (et de l'événement `reset`) : le worker peut comparer un tour commencé avant.
          const at = new Date();
          // Messages encore en file (équipe, ou partie de l'assistant en attente du débit) : annulés, texte vidé ; l'envoi
          // les ignore (rien ne part après « j'ai tout oublié »). Un envoi déjà engagé vide son texte en partant.
          await tx.outboundMessage.updateMany({
            where: {
              botId,
              memberId,
              kind: "ASSISTANT",
              status: "QUEUED",
              queuedAt: { lte: at },
            },
            data: {
              status: "FAILED",
              error: RESET_CANCELLED_ERROR,
              text: "",
              buttons: [],
            },
          });
          // Texte des messages déjà partis (ou refusés) du bot à cette personne : il reprend souvent ce qu'elle a dit.
          await tx.outboundMessage.updateMany({
            where: {
              botId,
              memberId,
              kind: "ASSISTANT",
              status: { not: "QUEUED" },
              queuedAt: { lte: at },
            },
            data: { text: "", buttons: [] },
          });
          // Effacés : tout ce que le bot a envoyé jusqu'ici, et les messages de la personne jusqu'au /reset compris (ceux
          // qu'elle a envoyés juste après restent : l'assistant y répondra).
          const { count: deletedMessages } = await tx.conversationMessage.deleteMany({
            where: {
              conversationId,
              OR: [
                { direction: "OUT", createdAt: { lte: at } },
                {
                  direction: "IN",
                  OR: [
                    { telegramMessageId: null },
                    { telegramMessageId: { lte: BigInt(telegramMessageId) } },
                  ],
                },
              ],
            },
          });
          const kept = await tx.conversationMessage.findMany({
            where: { conversationId, direction: "IN" },
            select: { meta: true },
          });
          // Conversation fermée (/stop, mineur, équipe) : elle le reste ; inscription déjà comptée : « Inscrite » reste ;
          // sinon elle repart de l'accueil.
          const toStage = resetStage(conv);
          await tx.conversation.update({
            where: { id: conversationId },
            data: {
              summary: null,
              facts: [],
              styleProfile: {},
              language: null,
              // La série de photos repart de zéro : « j'ai tout oublié » vaut aussi pour elle.
              flirtStep: "NONE",
              flirtTeases: 0,
              stage: toStage,
              memberMessages: kept.filter((m) => !isCommandMeta(m.meta)).length,
              assistantTurns: 0,
              followUpCount: 0,
              nextFollowUpAt: null,
              retryAt: null,
            },
            select: { id: true },
          });
          await conversationEvent(tx, {
            conversationId,
            type: "reset",
            fromStage: conv.stage,
            toStage,
            payload: { deletedMessages, telegramMessageId, locked: underLock },
            at,
          });
          return { duplicate: false as const, fromStage: conv.stage, toStage, deletedMessages, at };
        }),
      );
      if (!result) return { duplicate: false };
      if (result.duplicate) return { duplicate: true };
      await journal("reset", {
        botId,
        memberId,
        conversationId,
        payload: {
          fromStage: result.fromStage,
          toStage: result.toStage,
          deletedMessages: result.deletedMessages,
          locked,
        },
        at: result.at,
      });
      return { duplicate: false };
    },

    async claimStoppedReply({ conversationId, botId, memberId, at }) {
      const already = await prisma.conversationEvent.findFirst({
        where: { conversationId, type: "stopped_reply", createdAt: { gte: parisDayStart(at) } },
        select: { id: true },
      });
      if (already) return false;
      await prisma.conversationEvent.create({
        data: { conversationId, type: "stopped_reply", createdAt: at },
      });
      await journal("stopped_reply", { botId, memberId, conversationId, at });
      return true;
    },

    async conversationBlocked({ botId, telegramUserId, at }) {
      const conv = await prisma.conversation.findFirst({
        where: { botId, member: { telegramUserId } },
        select: { id: true, memberId: true, nextFollowUpAt: true },
      });
      if (!conv) return;
      if (conv.nextFollowUpAt)
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { nextFollowUpAt: null },
          select: { id: true },
        });
      await prisma.conversationEvent.create({
        data: {
          conversationId: conv.id,
          type: "blocked",
          payload: { via: "telegram" },
          createdAt: at,
        },
      });
      // La personne a bloqué le bot (≠ « Bloquer » de l'équipe) : la conversation reprend si elle réécrit.
      await journal("blocked", {
        botId,
        memberId: conv.memberId,
        conversationId: conv.id,
        payload: { via: "telegram" },
        at,
      });
    },

    async enqueueTurn(conversationId) {
      await enqueueChatTurn(conversationId);
    },
  };
}

export const prismaAssistantDeps: AssistantDeps = createPrismaAssistantDeps();
