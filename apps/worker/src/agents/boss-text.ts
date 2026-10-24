/**
 * Phase 26 : tâche `agents-orchestrator` `boss-text` — message de l'admin au Boss que le chemin rapide du webhook n'a
 * pas pris (il faut l'interprète IA). `bossAiTurn` (chantier B) choisit une action du catalogue fermé, l'exécute par
 * les fonctions existantes et écrit les `BossTurn` ; ici on prépare les dépendances (`llm: loadBossLlm`), on garde
 * contre la double exécution et on répond dans la conversation du bot qui a reçu le message (en « Répondre » au message
 * d'origine, boutons, message de confirmation mémorisé, suite).
 * - Jamais deux fois : `jobId` `boss-text:<botId>:<messageId>` (webhook rejoué) ET repère en base : un tour BOSS déjà
 *   écrit pour ce message → rien n'est refait (tâche rejouée après un redémarrage du worker).
 * - Jamais de silence : erreur de l'interprète → « Oups… » quand même.
 * - Seul l'admin (`Setting` `admin.telegramUserId`) est écouté, en privé.
 */
import { Api } from "grammy";
import type { AgentsDeps, AgentsOrchestratorJob, BossDeps, BossInput, BossLlm, BossReply } from "@linkaffipro/agents";
import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { BOSS_ERROR_REPLY, deliverBossReply, realBossEngine, type BossEngine, type BossReplyApi } from "@linkaffipro/telegram";
import { logger } from "../logger";
import { workerAgentsDeps } from "./deps";

export type BossTextJob = Extract<AgentsOrchestratorJob, { type: "boss-text" }>;

/** Tâche rejouée alors que le premier passage s'était arrêté en route : rien n'est refait, l'admin est prévenu. */
export const BOSS_INTERRUPTED_REPLY =
  "Je me suis interrompu pendant ce message : écris « agents » pour voir où on en est avant de redemander.";

export type BossTurnLookup = (messageId: number, chatId: number) => Promise<{ status: string | null } | null>;

export type BossTextDeps = {
  agents: AgentsDeps;
  engine: Pick<BossEngine, "aiTurn" | "rememberPendingMessage">;
  loadLlm(): Promise<BossLlm | null>;
  botApi(botId: string): Promise<BossReplyApi | null>;
  adminTelegramId(): Promise<bigint | null>;
  bossTurnFor: BossTurnLookup;
};

/** API du bot qui a reçu le message (jeton déchiffré en mémoire). */
async function prismaBotApi(botId: string): Promise<BossReplyApi | null> {
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { tokenEncrypted: true, isActive: true } });
  if (!bot?.isActive) return null;
  const api = new Api(decrypt(bot.tokenEncrypted));
  return {
    sendMessage: (chatId, text, other) => api.sendMessage(chatId, text, other),
    deleteMessage: (chatId, messageId) => api.deleteMessage(chatId, messageId),
  };
}

export function defaultBossTextDeps(): BossTextDeps {
  return {
    agents: workerAgentsDeps(),
    engine: realBossEngine,
    loadLlm: () => realBossEngine.loadLlm(prisma),
    botApi: prismaBotApi,
    async adminTelegramId() {
      const s = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
      return s && typeof s.value === "string" && /^\d+$/.test(s.value) ? BigInt(s.value) : null;
    },
    async bossTurnFor(messageId, chatId) {
      return prisma.bossTurn.findFirst({
        where: {
          role: "BOSS",
          telegramMessageId: messageId,
          OR: [{ chatId: BigInt(chatId) }, { chatId: null }],
        },
        orderBy: { createdAt: "desc" },
        select: { status: true },
      });
    },
  };
}

/** Envoi par le bot reçu ; sans lui (désactivé entre-temps), par le messager du dialogue admin. */
function fallbackApi(agents: AgentsDeps): BossReplyApi | null {
  const admin = agents.admin;
  if (!admin) return null;
  return {
    async sendMessage(_chatId, text, other) {
      const sent = await admin.send(text, {
        ...(other?.reply_parameters ? { replyToMessageId: other.reply_parameters.message_id } : {}),
        ...(other?.reply_markup
          ? {
              buttons: other.reply_markup.inline_keyboard.map((row) =>
                row.map((b) => ({ text: b.text, callbackData: "callback_data" in b ? String(b.callback_data) : "" })),
              ),
            }
          : {}),
      });
      return { message_id: sent?.messageId ?? 0 };
    },
    async deleteMessage(_chatId, messageId) {
      await admin.deleteMessage?.(messageId);
    },
  };
}

export type BossTextOutcome = "not-admin" | "already-done" | "interrupted" | "answered" | "error" | "no-bot";

/** Commun au texte (tâche `boss-text`) et au vocal transcrit (`admin-voice`, `source: "voice"`). */
export async function runBossAiTurn(
  deps: BossTextDeps,
  job: { botId: string; chatId: number; input: BossInput },
): Promise<{ ok: boolean; outcome: BossTextOutcome }> {
  const adminId = await deps.adminTelegramId();
  // Conversation privée : l'identifiant du chat est celui de la personne. Seul l'admin est écouté.
  if (!adminId || BigInt(job.chatId) !== adminId) {
    logger.warn({ botId: job.botId, messageId: job.input.messageId }, "[boss] message ignoré : pas l'admin");
    return { ok: false, outcome: "not-admin" };
  }
  const api = (await deps.botApi(job.botId).catch(() => null)) ?? fallbackApi(deps.agents);
  if (!api) return { ok: false, outcome: "no-bot" };
  const send = (reply: BossReply, bossDeps: BossDeps) =>
    deliverBossReply({
      api,
      chatId: job.chatId,
      messageId: job.input.messageId,
      reply,
      deps: bossDeps,
      engine: deps.engine,
      log: (msg, err) => logger.warn({ err: (err as Error)?.message }, msg),
    });

  const done = await deps.bossTurnFor(job.input.messageId, job.chatId).catch(() => null);
  if (done) {
    if (done.status === "running") {
      await send({ reply: BOSS_INTERRUPTED_REPLY }, deps.agents).catch(() => undefined);
      return { ok: false, outcome: "interrupted" };
    }
    logger.info({ messageId: job.input.messageId }, "[boss] tâche rejouée : message déjà traité, rien n'est refait");
    return { ok: true, outcome: "already-done" };
  }

  const llm = await deps.loadLlm().catch((err: unknown) => {
    logger.warn({ err: (err as Error).message }, "[boss] interprète indisponible");
    return null;
  });
  const bossDeps: BossDeps = { ...deps.agents, llm };
  let reply: BossReply;
  let outcome: BossTextOutcome = "answered";
  try {
    reply = await deps.engine.aiTurn(bossDeps, job.input);
  } catch (err) {
    logger.error({ err: (err as Error).message, messageId: job.input.messageId }, "[boss] interprète en erreur");
    reply = { reply: BOSS_ERROR_REPLY };
    outcome = "error";
  }
  try {
    await send(reply, bossDeps);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[boss] réponse non envoyée");
    return { ok: false, outcome: "error" };
  }
  return { ok: outcome === "answered", outcome };
}

export async function processBossText(
  job: BossTextJob,
  deps: BossTextDeps = defaultBossTextDeps(),
): Promise<{ ok: boolean; outcome: BossTextOutcome }> {
  return runBossAiTurn(deps, {
    botId: job.botId,
    chatId: job.chatId,
    input: {
      text: job.text,
      messageId: job.messageId,
      replyToMessageId: job.replyToMessageId ?? null,
      source: job.source ?? "text",
      entities: job.entities ?? null,
      ...(job.forwarded ? { forwarded: true } : {}),
    },
  });
}
