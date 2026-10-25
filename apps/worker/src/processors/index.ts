import type { Job, Processor } from "bullmq";
import type { QueueName } from "@linkaffipro/queue";
import { processApprovals, repeatableApprovals } from "./approvals";
import { processScheduler, repeatableScheduler } from "./scheduler";
import { processTelegramSend, repeatableTelegramSend } from "./telegram-send";
import { processSyncLinkaffi, repeatableSyncLinkaffi } from "./sync-linkaffi";
import { processStats, repeatableStats } from "./stats";
import { processMaintenance, repeatableMaintenance } from "./maintenance";
import { processAutomations, repeatableAutomations } from "./automations";
import { processSyncAds, repeatableSyncAds } from "./sync-ads";
import { processSyncViews, repeatableSyncViews } from "./sync-views";
import { processCustomEmoji, repeatableCustomEmoji } from "./custom-emoji";
import { processLinkaffiEvents, repeatableLinkaffiEvents } from "./linkaffi-events";
import { processLandingEvents, repeatableLandingEvents } from "./landing-events";
import { processChat, repeatableChat } from "./chat";
import { processAgentsOrchestrator, repeatableAgentsOrchestrator } from "./agents-orchestrator";
import { processAgentsDating, repeatableAgentsDating } from "./agents-dating";
import { processAgentsCasino, repeatableAgentsCasino } from "./agents-casino";
import { processAgentsSports, repeatableAgentsSports } from "./agents-sports";
import { processAgentsAlgo, repeatableAgentsAlgo } from "./agents-algo";
import { processAgentsAds, repeatableAgentsAds } from "./agents-ads";
import { processAgentsBookmakers, repeatableAgentsBookmakers } from "./agents-bookmakers";
import { processAgentsMontage, repeatableAgentsMontage } from "./agents-montage";

export type Repeatable = { data: Record<string, unknown>; everyMs: number; jobId: string };

export const PROCESSORS: Record<QueueName, { process: Processor; repeatable: Repeatable[]; concurrency: number }> = {
  approvals: { process: (job: Job) => processApprovals(job), repeatable: repeatableApprovals, concurrency: 1 },
  scheduler: { process: (job: Job) => processScheduler(job), repeatable: repeatableScheduler, concurrency: 1 },
  "telegram-send": { process: (job: Job) => processTelegramSend(job), repeatable: repeatableTelegramSend, concurrency: 4 },
  "sync-linkaffi": { process: (job: Job) => processSyncLinkaffi(job), repeatable: repeatableSyncLinkaffi, concurrency: 1 },
  stats: { process: (job: Job) => processStats(job), repeatable: repeatableStats, concurrency: 1 },
  maintenance: { process: (job: Job) => processMaintenance(job), repeatable: repeatableMaintenance, concurrency: 1 },
  automations: { process: (job: Job) => processAutomations(job), repeatable: repeatableAutomations, concurrency: 2 },
  // Un seul appel externe à la fois : quotas des plateformes et un seul client MTProto.
  "sync-ads": { process: (job: Job) => processSyncAds(job), repeatable: repeatableSyncAds, concurrency: 1 },
  "sync-views": { process: (job: Job) => processSyncViews(job), repeatable: repeatableSyncViews, concurrency: 1 },
  // Emojis animés (phase 12) : un appel à la fois (MTProto sous withMtprotoLock, Bot API getFile).
  "custom-emoji": { process: (job: Job) => processCustomEmoji(job), repeatable: repeatableCustomEmoji, concurrency: 1 },
  // Événements Link Affi (phase 13) : envois HTTP signés, un à la fois (ordre des événements d'un membre gardé).
  "linkaffi-events": { process: (job: Job) => processLinkaffiEvents(job), repeatable: repeatableLinkaffiEvents, concurrency: 1 },
  // Pages d'atterrissage (phase 15) : écriture des visites, clics et ouvertures (une ligne par envoi, sans ordre à
  // garder) ; plusieurs à la fois pour suivre le trafic des pubs.
  "landing-events": { process: (job: Job) => processLandingEvents(job), repeatable: repeatableLandingEvents, concurrency: 8 },
  // Assistant de conversation (phase 17) : plusieurs conversations à la fois, une seule tâche à la fois par conversation
  // (déduplication BullMQ + verrou Redis + réclamation des messages en base).
  chat: { process: (job: Job) => processChat(job), repeatable: repeatableChat, concurrency: 8 },
  // Agents IA (phase 19) : le Grand Chef un passage à la fois ; 2 étapes à la fois par équipe (une mission n'a jamais
  // deux étapes en file : identifiant <missionId>:<index>).
  "agents-orchestrator": { process: (job: Job) => processAgentsOrchestrator(job), repeatable: repeatableAgentsOrchestrator, concurrency: 1 },
  "agents-dating": { process: (job: Job) => processAgentsDating(job), repeatable: repeatableAgentsDating, concurrency: 2 },
  "agents-casino": { process: (job: Job) => processAgentsCasino(job), repeatable: repeatableAgentsCasino, concurrency: 2 },
  "agents-sports": { process: (job: Job) => processAgentsSports(job), repeatable: repeatableAgentsSports, concurrency: 2 },
  "agents-algo": { process: (job: Job) => processAgentsAlgo(job), repeatable: repeatableAgentsAlgo, concurrency: 2 },
  "agents-ads": { process: (job: Job) => processAgentsAds(job), repeatable: repeatableAgentsAds, concurrency: 1 },
  // Lecture des bookmakers (phase 35) : plusieurs sites à la fois, un seul lecteur par site (verrou en base).
  "agents-bookmakers": { process: (job: Job) => processAgentsBookmakers(job), repeatable: repeatableAgentsBookmakers, concurrency: 2 },
  // Montage vidéo (phase 28) : une tâche à la fois (ffmpeg occupe le processeur ; 10 min au plus par short).
  "agents-montage": { process: (job: Job) => processAgentsMontage(job), repeatable: repeatableAgentsMontage, concurrency: 1 },
};
