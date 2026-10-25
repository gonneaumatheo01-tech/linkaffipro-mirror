/**
 * Phase 35, chantier A : exécution d'un travail `BookmakerReadJob`.
 * - `runTransportKind` : primitives (`fetch-api`, `page`, `record`, `visible`) et `test` (ouverture de la section paris
 *   avec la session, connexion si besoin) avec un transport local ; commun au worker et au runner du Mac ;
 * - `executeReadJob` (worker) : nuit (sauf `params.force`), UN lecteur par site (`withSiteLock`, sans attendre : site
 *   occupé → travail rendu), travail complet par le branchement du chantier concerné (`registerReadJobHandler`) ou
 *   primitive par le transport serveur ; résultat rangé (jamais de secret).
 */
import type { AgentsDeps } from "../../types";
import { finishReadJob, releaseReadJob, type ReadJobRow } from "../jobs";
import { readJobHandler } from "./hooks";
import { SiteLockBusy, withSiteLock } from "./lock";
import { HUMAN_OBSTACLES } from "./obstacles";
import { readAllowedAt } from "./pace";
import type { ServerTransport } from "./server";

export type JobParams = Record<string, unknown>;

/** Primitive ou test avec un transport local ; rend la valeur à ranger (obstacles compris). */
export async function runTransportKind(t: ServerTransport, siteKey: string, kind: string, params: JobParams, baseUrl: string): Promise<unknown> {
  const req = (params.req ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "fetch-api":
      return t.fetchApi(siteKey, {
        method: typeof req.method === "string" ? req.method : "GET",
        url: String(req.url ?? ""),
        headers: Array.isArray(req.headers) ? req.headers.filter((h): h is string => typeof h === "string") : [],
        body: typeof req.body === "string" ? req.body : null,
      });
    case "page":
      return t.page(siteKey, { url: String(req.url ?? ""), steps: Array.isArray(req.steps) ? (req.steps as never) : [], captureOf: (req.captureOf as never) ?? null });
    case "record":
      return t.record(siteKey, typeof params.baseUrl === "string" ? params.baseUrl : baseUrl);
    case "visible":
      return t.visible(siteKey, { url: typeof params.url === "string" ? params.url : baseUrl, ...(typeof params.maxWaitMs === "number" ? { maxWaitMs: params.maxWaitMs } : {}) });
    case "test": {
      const r = await t.page(siteKey, { url: typeof params.url === "string" ? params.url : baseUrl });
      if ("obstacle" in r) {
        const message = (r as { message?: string }).message;
        return { ok: false, obstacle: r.obstacle, ...(message ? { message } : {}) };
      }
      return { ok: true, url: r.url, textBytes: r.text.length };
    }
    default:
      return { obstacle: "not_available", message: `travail « ${kind} » non pris en charge ici` };
  }
}

/** Pur : statut final d'après la valeur rendue. */
export function statusOfValue(value: unknown): "DONE" | "NEEDS_HUMAN" {
  const o = (value as { obstacle?: unknown } | null)?.obstacle;
  return typeof o === "string" && HUMAN_OBSTACLES.has(o) ? "NEEDS_HUMAN" : "DONE";
}

export type ExecuteOptions = {
  /** Transport serveur (navigateur du worker). */
  server: ServerTransport;
  baseUrlOf?: (siteKey: string) => Promise<string | null>;
};

export type ExecuteOutcome = "done" | "failed" | "busy" | "night";

/** Exécute un travail pris (CLAIMED) par le worker. */
export async function executeReadJob(deps: AgentsDeps, job: ReadJobRow, o: ExecuteOptions): Promise<ExecuteOutcome> {
  const params = (job.params ?? {}) as JobParams;
  const now = deps.now ? deps.now() : new Date();
  // Les gestes demandés par l'admin (test, navigateur visible) passent la nuit ; les lectures attendent 7 h.
  const forced = params.force === true || job.kind === "test" || job.kind === "visible";
  if (!readAllowedAt(now, forced)) {
    await releaseReadJob(deps, job.id);
    return "night";
  }
  const started = Date.now();
  try {
    return await withSiteLock(
      deps,
      job.siteKey,
      async () => {
        let value: unknown;
        const handler = readJobHandler(job.kind);
        if (handler) value = await handler(deps, job);
        else if (job.kind === "visible") value = { obstacle: "mac_only", message: "le navigateur visible ne s'ouvre que sur le Mac" };
        else if (["fetch-api", "page", "record", "test"].includes(job.kind)) {
          const site = await o.baseUrlOf?.(job.siteKey);
          value = await runTransportKind(o.server, job.siteKey, job.kind, params, site ?? "");
        } else value = { obstacle: "not_available", message: `lecture « ${job.kind} » pas encore branchée` };
        await finishReadJob(deps, job.id, statusOfValue(value), { value, durationMs: Date.now() - started, target: "server" });
        return "done" as const;
      },
      { waitMs: 0, owner: `worker:${job.kind}` },
    );
  } catch (err) {
    if (err instanceof SiteLockBusy) {
      await releaseReadJob(deps, job.id);
      return "busy";
    }
    await finishReadJob(deps, job.id, "FAILED", { obstacle: "error", message: String((err as Error)?.message ?? err).slice(0, 200), durationMs: Date.now() - started });
    deps.logger?.warn({ jobId: job.id, kind: job.kind, err: String((err as Error)?.message ?? err).slice(0, 200) }, "[bookmakers] travail en échec");
    return "failed";
  }
}
