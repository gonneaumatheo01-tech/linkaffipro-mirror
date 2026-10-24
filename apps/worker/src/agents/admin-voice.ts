/**
 * Vocal de l'admin (phase 20, tâche `agents-orchestrator` `admin-voice`, chantier B) : le webhook l'a mis en file ; ici
 * on télécharge le vocal par le bot qui l'a reçu, on le transcrit (même transcription que les comptes réels de la
 * phase 18 : Venice `openai/whisper-large-v3`, ffmpeg, repli en français ; clé `Setting` `assistant.venice`), puis
 * `handleAdminVoice` le traite comme un texte. Les réponses partent dans la même conversation, par le même bot.
 * Seul l'identifiant admin (`Setting` `admin.telegramUserId`) est écouté ; le texte transcrit n'est jamais journalisé
 * en clair par ce module.
 */
import { Api } from "grammy";
import {
  VOICE_NOT_UNDERSTOOD,
  VOICE_SECRET_REFUSAL,
  handleAdminVoice,
  voiceToAdminText,
  type AgentsDeps,
  type AgentsOrchestratorJob,
  type BossInput,
  type Transcriber,
} from "@linkaffipro/agents";
import { BOSS_ERROR_REPLY, deliverBossReply, realBossEngine, type BossEngine } from "@linkaffipro/telegram";
import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { transcribe } from "@linkaffipro/userbot/voice";
import { loadAssistantSettings } from "../assistant/settings";
import { logger } from "../logger";
import { workerAgentsDeps } from "./deps";
import { defaultBossTextDeps, runBossAiTurn, type BossTextDeps } from "./boss-text";

export type AdminVoiceJob = Extract<AgentsOrchestratorJob, { type: "admin-voice" }>;

/** Biais de vocabulaire des vocaux de l'admin : les commandes du dialogue des agents. */
export const ADMIN_STT_PROMPT =
  "Commandes vocales en français pour le bot des agents : agents, demandes, pause dating, reprends casino, ok 12, non 12, vrai dating, niveau dating 1, budget vidéo 100, plus tard, oui, non.";

/** Limite de la transcription (au-delà, rien n'est envoyé au fournisseur). */
const MAX_VOICE_BYTES = 2 * 1024 * 1024;

/** Pas de clé Venice : les vocaux ne peuvent pas être écoutés (message clair à l'admin). */
export class NoTranscriptionKeyError extends Error {
  constructor() {
    super("clé Venice absente");
  }
}

/** Bot qui a reçu le vocal : téléchargement du fichier et réponse dans la conversation. */
export type VoiceBotApi = {
  download(fileId: string): Promise<Uint8Array | null>;
  send(chatId: number, html: string, replyToMessageId?: number): Promise<void>;
};

export type AdminVoiceDeps = {
  agents: AgentsDeps;
  transcribe: Transcriber;
  botApi(botId: string): Promise<VoiceBotApi | null>;
  adminTelegramId(): Promise<bigint | null>;
  /**
   * Phase 26 : chemin du Boss (même que le texte : chemin rapide, puis interprète IA). Absent (tests de la phase 20) :
   * ancien traitement `handleAdminVoice`.
   */
  boss?: BossTextDeps & { engine: Pick<BossEngine, "fastPath" | "aiTurn" | "rememberPendingMessage"> };
};

export const NOT_DOWNLOADED = "Je n'ai pas pu récupérer ton vocal : réessaie, ou écris-le-moi.";
export const NO_KEY =
  "Je ne peux pas encore écouter les vocaux : la clé Venice manque (Réglages → IA de conversation). Écris-moi en attendant.";

function htmlToPlain(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Bot réel : jeton déchiffré, `getFile` puis téléchargement, envoi HTML (repli en texte brut). */
async function prismaBotApi(botId: string): Promise<VoiceBotApi | null> {
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { tokenEncrypted: true, isActive: true } });
  if (!bot?.isActive) return null;
  const token = decrypt(bot.tokenEncrypted);
  const api = new Api(token);
  return {
    async download(fileId) {
      const file = await api.getFile(fileId);
      if (!file.file_path || (file.file_size ?? 0) > MAX_VOICE_BYTES) return null;
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    },
    async send(chatId, html, replyToMessageId) {
      const reply_parameters = replyToMessageId
        ? { message_id: replyToMessageId, allow_sending_without_reply: true }
        : undefined;
      try {
        await api.sendMessage(chatId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_parameters });
      } catch {
        await api.sendMessage(chatId, htmlToPlain(html), { link_preview_options: { is_disabled: true }, reply_parameters });
      }
    },
  };
}

/** Transcripteur réel : clé Venice des réglages de l'IA de conversation, relue à chaque vocal. */
export const veniceAdminTranscriber: Transcriber = async (audio) => {
  const { apiKey } = await loadAssistantSettings();
  if (!apiKey) throw new NoTranscriptionKeyError();
  return transcribe(apiKey, Buffer.from(audio.bytes), audio.mimeType, {
    logger: { info: (o, m) => logger.info(o, m), warn: (o, m) => logger.warn(o, m) },
    prompt: ADMIN_STT_PROMPT,
  });
};

export function defaultAdminVoiceDeps(): AdminVoiceDeps {
  return {
    agents: workerAgentsDeps(),
    transcribe: veniceAdminTranscriber,
    botApi: prismaBotApi,
    async adminTelegramId() {
      const s = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
      return s && typeof s.value === "string" && /^\d+$/.test(s.value) ? BigInt(s.value) : null;
    },
    boss: { ...defaultBossTextDeps(), engine: realBossEngine },
  };
}

/** Transcription sans guillemets ni ponctuation d'élocution, SANS remise à « oui » (confirmation stricte). */
function spokenForConfirm(transcript: string): string {
  return transcript
    .trim()
    .replace(/^[\s"«»“”'’]+|[\s"«»“”'’]+$/g, "")
    .replace(/[,;:](?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Un long morceau sans espace mêlant lettres et chiffres ressemble à une clé dictée : jamais traité ni répété. */
function looksLikeDictatedKey(text: string): boolean {
  return text.split(/\s+/).some((w) => w.length >= 20 && /\d/.test(w) && /[a-z]/i.test(w) && !/^https?:\/\//i.test(w));
}

/**
 * Phase 26 : vocal transcrit → même chemin qu'un texte (`bossFastPath`, puis `bossAiTurn` si besoin), `source: "voice"`
 * (jamais pris pour un secret). La première ligne (« 🎧 J'ai compris… ») répond au vocal.
 */
async function bossVoiceTurn(
  deps: AdminVoiceDeps,
  boss: NonNullable<AdminVoiceDeps["boss"]>,
  job: AdminVoiceJob,
  transcript: string | null,
  say: (html: string) => Promise<void>,
): Promise<{ ok: boolean; outcome: string }> {
  const text = transcript ? voiceToAdminText(transcript) : "";
  if (!text || text.replace(/[^\p{L}\p{N}]/gu, "").length < 1) {
    await say(VOICE_NOT_UNDERSTOOD);
    return { ok: false, outcome: "not-understood" };
  }
  if (looksLikeDictatedKey(text)) {
    await say(VOICE_SECRET_REFUSAL);
    return { ok: false, outcome: "secret-refused" };
  }
  await say(`🎧 J'ai compris : "${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}".`);
  const input: BossInput = {
    text,
    spokenText: spokenForConfirm(transcript ?? ""),
    messageId: job.messageId,
    replyToMessageId: job.replyToMessageId ?? null,
    source: "voice",
  };
  let fast: Awaited<ReturnType<BossEngine["fastPath"]>>;
  try {
    fast = await boss.engine.fastPath(deps.agents, input);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[boss] chemin rapide du vocal en erreur");
    await say(BOSS_ERROR_REPLY);
    return { ok: false, outcome: "error" };
  }
  if (fast.handled) {
    const api = await boss.botApi(job.botId).catch(() => null);
    if (api)
      await deliverBossReply({ api, chatId: job.chatId, messageId: job.messageId, reply: fast, deps: deps.agents, engine: boss.engine });
    else await say(fast.reply ?? BOSS_ERROR_REPLY);
    return { ok: true, outcome: "handled" };
  }
  const r = await runBossAiTurn(boss, { botId: job.botId, chatId: job.chatId, input });
  return { ok: r.ok, outcome: r.outcome === "answered" ? "handled" : r.outcome };
}

export async function processAdminVoice(
  job: AdminVoiceJob,
  deps: AdminVoiceDeps = defaultAdminVoiceDeps(),
): Promise<{ ok: boolean; outcome: string }> {
  // Conversation privée : l'identifiant du chat est celui de la personne. Seul l'admin est écouté.
  const adminId = await deps.adminTelegramId();
  if (!adminId || BigInt(job.chatId) !== adminId) {
    logger.warn({ botId: job.botId, messageId: job.messageId }, "[agents] vocal ignoré : pas l'admin");
    return { ok: false, outcome: "not-admin" };
  }
  const api = await deps.botApi(job.botId).catch(() => null);
  let first = true;
  const say = async (html: string) => {
    const replyTo = first ? job.messageId : undefined;
    first = false;
    if (api) await api.send(job.chatId, html, replyTo);
    else await deps.agents.admin?.send(html, replyTo ? { replyToMessageId: replyTo } : {});
  };

  let bytes: Uint8Array | null = null;
  try {
    bytes = api ? await api.download(job.fileId) : null;
  } catch (err) {
    logger.warn({ err: (err as Error).message, botId: job.botId }, "[agents] vocal non téléchargé");
  }
  if (!bytes || bytes.byteLength === 0) {
    await say(NOT_DOWNLOADED);
    return { ok: false, outcome: "not-downloaded" };
  }

  let transcript: string | null = null;
  try {
    transcript = await deps.transcribe({ bytes, mimeType: job.mimeType ?? "audio/ogg" });
  } catch (err) {
    if (err instanceof NoTranscriptionKeyError) {
      await say(NO_KEY);
      return { ok: false, outcome: "no-key" };
    }
    logger.warn({ err: (err as Error).message }, "[agents] transcription du vocal de l'admin en erreur");
    transcript = null;
  }

  if (deps.boss) return bossVoiceTurn(deps, deps.boss, job, transcript, say);

  const r = await handleAdminVoice(
    deps.agents,
    { transcript, messageId: job.messageId, replyToMessageId: job.replyToMessageId ?? null },
    say,
  );
  return { ok: r.outcome === "handled", outcome: r.outcome };
}
