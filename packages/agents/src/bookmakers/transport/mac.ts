/**
 * Phase 35, chantier A : transport « Mac » des bookmakers. Même interface que le transport serveur, mais chaque appel
 * devient un travail `BookmakerReadJob` (target `mac`, sorte `fetch-api` / `page` / `record` / `visible`) que le runner du
 * Mac du client prend par l'API du site, exécute avec son navigateur (même garde « jamais de mise ») et rend.
 * - jamais de secret dans `params` (la session et les identifiants partent avec la réponse de l'API au runner) ;
 * - Mac muet depuis 2 min → `{ obstacle: "mac_absent" }` tout de suite, sans rien déposer ;
 * - attente au plus 3 min pour un appel ou une page, 6 min pour un enregistrement, 11 min pour le navigateur visible ;
 *   dépassée → le travail est clos (`FAILED`, il ne sera plus fait) et l'appel rend `timeout` (ou `mac_absent` si le
 *   Mac ne l'a même pas pris) ;
 * - le résultat lu, la ligne ne garde qu'un résumé (pas de page complète en base).
 */
import type { AgentsPrisma, Logger } from "../../types";
import type { BookmakerTransport, DomStep, SiteRecording } from "../contract";
import { enqueueReadJob, finishReadJob, macAlive, readReadJob, waitReadJob, type ReadJobRow, type TransportJobKind } from "../jobs";

export const MAC_PAGE_TIMEOUT_MS = 3 * 60_000;
export const MAC_RECORD_TIMEOUT_MS = 6 * 60_000;
export const MAC_VISIBLE_TIMEOUT_MS = 11 * 60_000;

export type MacTransportDeps = { prisma: AgentsPrisma; now?: () => Date; logger?: Logger };

export type MacTransportOptions = {
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  pageTimeoutMs?: number;
  recordTimeoutMs?: number;
  visibleTimeoutMs?: number;
};

type Obstacle = { obstacle: string; message?: string };

export type MacTransport = BookmakerTransport & {
  visible(siteKey: string, req: { url?: string; maxWaitMs?: number }): Promise<{ ok: true; url: string } | Obstacle>;
};

/** Pur : résumé gardé en base une fois le résultat rendu (jamais une page entière ni un enregistrement complet). */
export function resultSummary(kind: string, value: unknown): Record<string, unknown> {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v.obstacle === "string") return { obstacle: v.obstacle, ...(typeof v.message === "string" ? { message: v.message.slice(0, 200) } : {}) };
  if (v.authExpired === true) return { authExpired: true };
  if (kind === "fetch-api") return { status: v.status, bytes: typeof v.body === "string" ? v.body.length : 0 };
  if (kind === "page") return { url: v.url, htmlBytes: typeof v.html === "string" ? v.html.length : 0, image: !!v.image, stepsUsed: v.stepsUsed };
  if (kind === "record") return { responses: Array.isArray(v.responses) ? v.responses.length : 0, pages: Array.isArray(v.pages) ? v.pages.length : 0, providerHint: v.providerHint };
  return { ok: v.ok === true, url: v.url };
}

export function createMacTransport(deps: MacTransportDeps, opts: MacTransportOptions = {}): MacTransport {
  async function run<T>(siteKey: string, kind: TransportJobKind | "visible", params: Record<string, unknown>, timeoutMs: number): Promise<T | Obstacle> {
    if (!(await macAlive(deps))) return { obstacle: "mac_absent", message: "le Mac ne répond pas (dernier signe il y a plus de 2 minutes)" };
    let job: ReadJobRow;
    try {
      job = await enqueueReadJob(deps, { siteKey, kind, target: "mac", params });
    } catch (err) {
      return { obstacle: "forbidden_action", message: (err as Error).message.slice(0, 200) };
    }
    const done = await waitReadJob(deps, job.id, { timeoutMs, pollMs: opts.pollMs ?? 1_000, ...(opts.sleep ? { sleep: opts.sleep } : {}) });
    if (!done) {
      const cur = await readReadJob(deps, job.id);
      const never = cur?.status === "PENDING";
      await finishReadJob(deps, job.id, "FAILED", { obstacle: never ? "mac_absent" : "timeout", message: "délai dépassé" }, { fromStatuses: ["PENDING", "CLAIMED"] });
      return never ? { obstacle: "mac_absent", message: "le Mac n'a pas pris la lecture à temps" } : { obstacle: "timeout", message: "le Mac n'a pas fini à temps" };
    }
    const result = (done.result ?? {}) as { value?: unknown; obstacle?: string; message?: string };
    if (done.status !== "DONE" || result.value === undefined) {
      return { obstacle: typeof result.obstacle === "string" ? result.obstacle : "runner_error", ...(typeof result.message === "string" ? { message: result.message } : {}) };
    }
    // Résultat lu : la ligne ne garde qu'un résumé.
    await deps.prisma.bookmakerReadJob
      .update({ where: { id: job.id }, data: { result: { ...result, value: undefined, summary: resultSummary(kind, result.value) } as never } })
      .catch(() => undefined);
    return result.value as T;
  }

  return {
    target: "mac",
    fetchApi(siteKey, req) {
      return run(siteKey, "fetch-api", { req: { method: req.method, url: req.url, headers: req.headers ?? [], body: req.body ?? null } }, opts.pageTimeoutMs ?? MAC_PAGE_TIMEOUT_MS);
    },
    page(siteKey, req: { url: string; steps?: Array<{ click?: DomStep; waitFor?: DomStep }>; captureOf?: DomStep | null }) {
      return run(siteKey, "page", { req: { url: req.url, steps: req.steps ?? [], captureOf: req.captureOf ?? null } }, opts.pageTimeoutMs ?? MAC_PAGE_TIMEOUT_MS);
    },
    record(siteKey, baseUrl) {
      return run<SiteRecording>(siteKey, "record", { baseUrl }, opts.recordTimeoutMs ?? MAC_RECORD_TIMEOUT_MS);
    },
    visible(siteKey, req) {
      return run(siteKey, "visible", { url: req.url ?? null, maxWaitMs: req.maxWaitMs ?? null }, opts.visibleTimeoutMs ?? MAC_VISIBLE_TIMEOUT_MS);
    },
  };
}
