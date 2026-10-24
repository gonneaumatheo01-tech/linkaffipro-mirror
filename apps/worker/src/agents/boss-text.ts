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
import { findTeamMember, readBossGroupId } from "@linkaffipro/agents";
import type { AgentsDeps, AgentsOrchestratorJob, BossChat, BossDeps, BossLlm, BossReply, BossSpeaker, BossTeamInput } from "@linkaffipro/agents";
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
  /**
   * Phase 26 (Kevin en équipe) : qui parle dans cette conversation ? Le groupe doit être celui enregistré ; en privé,
   * un membre présenté. Rend null pour toute autre personne (rien n'est fait).
   */
  teamSpeaker?(chat: BossChat, fromTelegramId: bigint): Promise<BossSpeaker | null>;
};

/** Revérifie en base qui parle (jamais la seule parole de la tâche) : admin ou membre présenté, groupe enregistré. */
export async function resolveTeamSpeaker(agents: AgentsDeps, chat: BossChat, fromTelegramId: bigint, adminId: bigint | null): Promise<BossSpeaker | null> {
  if (chat.type === "group") {
    const group = await readBossGroupId(agents);
    if (group === null || group !== chat.chatId) return null;
  } else if (chat.chatId !== fromTelegramId) return null;
  if (adminId && fromTelegramId === adminId) return { kind: "admin", telegramUserId: adminId, firstName: null };
  const m = await findTeamMember(agents, fromTelegramId);
  return m ? { kind: "member", telegramUserId: m.telegramUserId, memberId: m.id, role: m.role, firstName: m.firstName } : null;
}

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
    // Messager et journal : les alertes 80 / 100 % du plafond de Kevin partent depuis le worker.
    loadLlm: () => {
      const agents = workerAgentsDeps();
      return realBossEngine.loadLlm(prisma, { admin: agents.admin, logger: agents.logger });
    },
    botApi: prismaBotApi,
    async adminTelegramId() {
      const s = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
      return s && typeof s.value === "string" && /^\d+$/.test(s.value) ? BigInt(s.value) : null;
    },
    bossTurnFor: prismaBossTurnFor,
  };
}

/** Repère en base : tour BOSS déjà écrit pour ce message de l'admin (dans cette conversation, ou sans conversation). */
export const prismaBossTurnFor: BossTurnLookup = (messageId, chatId) =>
  prisma.bossTurn.findFirst({
    where: {
      role: "BOSS",
      telegramMessageId: messageId,
      // Groupe (identifiant négatif) : seulement ses tours ; privé : aussi les tours anciens sans conversation notée.
      ...(chatId < 0 ? { chatId: BigInt(chatId) } : { OR: [{ chatId: BigInt(chatId) }, { chatId: null }] }),
    },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });

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
  job: { botId: string; chatId: number; input: BossTeamInput },
): Promise<{ ok: boolean; outcome: BossTextOutcome }> {
  const adminId = await deps.adminTelegramId();
  const team = job.input.chat?.type === "group" || job.input.speaker?.kind === "member";
  if (team) {
    // Groupe de l'équipe ou privé d'un membre : la personne est revérifiée en base.
    const from = job.input.speaker?.telegramUserId ?? null;
    const speaker = from !== null && job.input.chat ? await (deps.teamSpeaker ?? ((c, f) => resolveTeamSpeaker(deps.agents, c, f, adminId)))(job.input.chat, from).catch(() => null) : null;
    if (!speaker) {
      logger.warn({ botId: job.botId, messageId: job.input.messageId }, "[boss] message d'équipe ignoré : personne ou groupe inconnu");
      return { ok: false, outcome: "not-admin" };
    }
    job = { ...job, input: { ...job.input, speaker } };
  } else if (!adminId || BigInt(job.chatId) !== adminId) {
    // Conversation privée : l'identifiant du chat est celui de la personne. Seul l'admin est écouté.
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
    // Conversation privée avec l'admin (le chat porte son identifiant).
    reply = await deps.engine.aiTurn(bossDeps, {
      ...job.input,
      speaker: job.input.speaker ?? { kind: "admin", telegramUserId: adminId!, firstName: null },
      chat: job.input.chat ?? { type: "private", chatId: BigInt(job.chatId) },
    });
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

/** Attente au-delà de laquelle le journal signale un message de l'admin resté trop longtemps en file (mesure seule). */
export const BOSS_TEXT_SLOW_WAIT_MS = 20_000;

/**
 * Temps passé en file par une tâche `boss-text` (mise en file → début du traitement), délai demandé retiré. La file
 * `agents-orchestrator` traite une tâche à la fois : un cycle long du Grand Chef retarde la réponse de Kevin.
 */
export function bossTextWaitMs(job: { timestamp?: number; processedOn?: number; opts?: { delay?: number } }, now = Date.now()): number | null {
  if (typeof job.timestamp !== "number" || !Number.isFinite(job.timestamp)) return null;
  const start = typeof job.processedOn === "number" ? job.processedOn : now;
  return Math.max(0, start - job.timestamp - (job.opts?.delay ?? 0));
}

/** Données gardées dans Redis après le traitement : jamais le texte de l'admin (ni ses mises en forme). */
export function scrubbedBossTextJob(job: BossTextJob): BossTextJob {
  return { ...job, text: "", entities: null, ...(job.mentions ? { mentions: [] } : {}) };
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
      ...teamInputOf(job),
    },
  });
}

/** Champs du mode équipe (phase 26) d'une tâche `boss-text` : qui parle (à revérifier), où, mentions. */
export function teamInputOf(job: BossTextJob): Partial<BossTeamInput> {
  if (!job.fromTelegramId || !/^\d+$/.test(job.fromTelegramId)) return {};
  const from = BigInt(job.fromTelegramId);
  const group = job.chatType === "group";
  const chat: BossChat = group ? { type: "group", chatId: BigInt(job.chatId) } : { type: "private", chatId: BigInt(job.chatId) };
  return {
    chat,
    // Provisoire : remplacé par la personne revérifiée en base (`resolveTeamSpeaker`).
    speaker: { kind: "member", telegramUserId: from, memberId: "", role: "MEMBER", firstName: "" },
    mentions: (job.mentions ?? []).map((m) => ({
      telegramUserId: m.telegramUserId && /^\d+$/.test(m.telegramUserId) ? BigInt(m.telegramUserId) : null,
      username: m.username ?? null,
      firstName: m.firstName ?? null,
    })),
  };
}
