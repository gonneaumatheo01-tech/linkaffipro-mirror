/**
 * Fonctions retirées le 28 octobre 2026 (canal d'inspiration, lecture des sites des bookmakers) et le 29 octobre 2026
 * (Montage, vidéos IA) : au démarrage du worker, leurs planifications BullMQ restées dans Redis sont effacées (sinon
 * elles rempliraient des files que plus rien ne lit), les files `agents-bookmakers` et `agents-montage` sont vidées, et
 * leurs alertes encore ouvertes sont closes, comme les questions au client devenues sans objet (vidéos sources, plafond
 * vidéo et banc d'essai de l'équipe Rencontres). Sans effet la deuxième fois. Ne lève jamais.
 */
import type { Queue } from "bullmq";
import type { Db, Prisma } from "@linkaffipro/db";
import { logger } from "../logger";

/** Planifications retirées : file → identifiants (`upsertJobScheduler`). */
export const RETIRED_SCHEDULERS: ReadonlyArray<readonly [queue: string, jobId: string]> = [
  ["agents-algo", "agents-algo-inspiration-reread"],
  ["agents-bookmakers", "agents-bookmakers-tick"],
  ["agents-bookmakers", "agents-bookmakers-health"],
  ["agents-montage", "agents-montage-sweep"],
  ["agents-montage", "agents-montage-cleanup"],
];
/** Files retirées : vidées (plus aucun processeur). */
export const RETIRED_QUEUES: readonly string[] = ["agents-bookmakers", "agents-montage"];
/** Alertes des fonctions retirées, closes si elles sont encore ouvertes. */
export const RETIRED_ALERT_KINDS: readonly string[] = ["bookmaker_blocked", "bookmaker_degraded"];

/** Questions au client devenues sans objet (vidéos IA retirées) : passées en SKIPPED si elles attendent encore. */
export const RETIRED_REQUEST_WHERE: Prisma.HumanRequestWhereInput = {
  status: { in: ["QUEUED", "PENDING"] },
  OR: [
    { key: { startsWith: "media.dating.source." } },
    { key: { startsWith: "persona.", endsWith: ".sourceVideos" } },
    { key: { startsWith: "persona.", endsWith: ".bench" } },
    { key: "agents.team.dating.videoBudget" },
  ],
};

type RetiredQueue = Pick<Queue, "removeJobScheduler" | "obliterate" | "close">;

export async function cleanupRetired(deps: {
  /** File par nom : celle du worker si elle tourne encore, sinon une file ouverte pour l'occasion (`owned`). */
  queueFor: (name: string) => { queue: RetiredQueue; owned: boolean };
  db: Pick<Db, "alert" | "humanRequest">;
  now?: Date;
}): Promise<{ schedulers: number; queues: number; alerts: number; requests: number }> {
  const out = { schedulers: 0, queues: 0, alerts: 0, requests: 0 };
  const opened = new Map<string, { queue: RetiredQueue; owned: boolean }>();
  const get = (name: string) => {
    let q = opened.get(name);
    if (!q) opened.set(name, (q = deps.queueFor(name)));
    return q;
  };
  try {
    for (const [name, id] of RETIRED_SCHEDULERS) if (await get(name).queue.removeJobScheduler(id).catch(() => false)) out.schedulers++;
    for (const name of RETIRED_QUEUES) {
      await get(name).queue.obliterate({ force: true });
      out.queues++;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[retrait] planifications des fonctions retirées non effacées");
  } finally {
    for (const q of opened.values()) if (q.owned) await q.queue.close().catch(() => undefined);
  }
  try {
    out.alerts = (await deps.db.alert.updateMany({ where: { kind: { in: [...RETIRED_ALERT_KINDS] }, resolvedAt: null }, data: { resolvedAt: deps.now ?? new Date() } })).count;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[retrait] alertes des fonctions retirées non closes");
  }
  try {
    out.requests = (
      await deps.db.humanRequest.updateMany({ where: RETIRED_REQUEST_WHERE, data: { status: "SKIPPED", answerSummary: "fonction retirée" } })
    ).count;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[retrait] questions des fonctions retirées non closes");
  }
  if (out.schedulers || out.alerts || out.requests) logger.info(out, "[retrait] restes des fonctions retirées effacés");
  return out;
}
