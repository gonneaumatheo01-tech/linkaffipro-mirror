/**
 * Phase 28, chantier D — dépendances de l'équipe Montage dans le worker :
 * - ffmpeg réel (`createFfmpegRunner`, binaire de l'image du worker) et moteur (`createMontageEngine` : ffmpeg + IA) ;
 * - téléchargement Telegram : bot de Kevin ≤ 20 Mo (`createBotFileDownloader`), au-delà le compte connecté de l'admin
 *   (`downloadAccountMedia`, sous `withMtprotoLock`, reprise du fichier partiel) ;
 * - envoi d'une vidéo par le bot de Kevin (`createKevinVideoSender`), identifiant du bot de Kevin ;
 * - mise en file `agents-montage` (`createMontageEnqueue`) ;
 * - crochets de Kevin (chantier E) posés par `setMontageHooks` (sinon ceux exportés par `@linkaffipro/agents`).
 * Créées une fois ; `setWorkerMontageDeps` pour les tests.
 */
import * as agents from "@linkaffipro/agents";
import {
  createFfmpegRunner,
  createMontageEngine,
  createTelegramDownloader,
  MONTAGE_LIMITS,
  type AccountFileDownloader,
  type MontageHooks,
  type MontagePipelineDeps,
} from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { downloadAccountMedia } from "@linkaffipro/mtproto";
import { createMontageEnqueue, getRedis, withMtprotoLock } from "@linkaffipro/queue";
import { adminBot, createBotFileDownloader, createKevinVideoSender, kevinBotIdResolver } from "@linkaffipro/telegram";
import { workerAgentsDeps } from "../agents/deps";
import { loadActiveSession } from "../views/credentials";

/** Attente du verrou du compte connecté (le relevé des vues le tient quelques secondes). */
const ACCOUNT_LOCK_WAIT_MS = 5 * 60_000;

/**
 * Téléchargement par le compte connecté : conversation privée de l'admin avec Kevin → le compte lit sa conversation
 * avec le bot (par son nom d'utilisateur) ; groupe ou canal « Médiathèque » → par l'identifiant de la conversation.
 */
export function createAccountDownloader(): AccountFileDownloader {
  return async (ref, dest) => {
    const { active, reason } = await loadActiveSession();
    if (!active) throw new Error(`vidéo de plus de 20 Mo et ${reason ?? "compte Telegram non connecté"} (Réglages → Connexions → Telegram)`);
    let peer = ref.chatId;
    if (!ref.chatId.startsWith("-")) {
      const bot = await adminBot();
      if (!bot?.username) throw new Error("bot de Kevin introuvable pour relire la conversation");
      peer = bot.username;
    }
    await withMtprotoLock(getRedis(), () => downloadAccountMedia({ session: active.session, peer, messageId: ref.messageId, sizeBytes: ref.sizeBytes ?? null, dest }, active.creds), {
      waitMs: ACCOUNT_LOCK_WAIT_MS,
      owner: "worker:montage",
    });
  };
}

let hooks: MontageHooks | null = null;
let cached: MontagePipelineDeps | null = null;

/** Crochets de Kevin (chantier E) ; par défaut `montageKevinHooks(deps)` s'il est exporté par `@linkaffipro/agents`. */
export function setMontageHooks(next: MontageHooks | null): void {
  hooks = next;
  if (cached?.montage) cached.montage.hooks = next ?? defaultHooks(cached);
}

function defaultHooks(deps: MontagePipelineDeps): MontageHooks | undefined {
  const factory = (agents as unknown as Record<string, unknown>).montageKevinHooks;
  return typeof factory === "function" ? ((factory as (d: MontagePipelineDeps) => MontageHooks)(deps) ?? undefined) : undefined;
}

export function workerMontageDeps(): MontagePipelineDeps {
  if (cached) return cached;
  const base = workerAgentsDeps();
  const runner = createFfmpegRunner();
  const deps: MontagePipelineDeps = {
    ...base,
    prisma,
    ffmpeg: runner,
    downloadTelegramFile: createTelegramDownloader({ bot: createBotFileDownloader(), account: createAccountDownloader() }),
    sendVideo: createKevinVideoSender(),
    montage: {
      enqueue: createMontageEnqueue(),
      workDir: process.env.MONTAGE_WORK_DIR || MONTAGE_LIMITS.workDir,
      kevinBotId: kevinBotIdResolver(),
      fontFile: process.env.MONTAGE_FONT_FILE || null,
    },
  };
  deps.montage!.engine = createMontageEngine({ runner, deps });
  deps.montage!.hooks = hooks ?? defaultHooks(deps);
  cached = deps;
  return deps;
}

/** Tests : dépendances imposées (`null` revient aux vraies). */
export function setWorkerMontageDeps(next: MontagePipelineDeps | null): void {
  cached = next;
}
