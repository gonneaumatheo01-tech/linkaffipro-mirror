/**
 * Cœur du runner du Mac (phase 35, chantier A ; phase 23 pour les captures) : sans réseau propre, sans base, sans disque.
 * Le script `scripts/bookmaker-runner.ts` lui donne `call` (API du site, jeton) et `launch` (Chromium local).
 * Un passage : demande au site un travail (capture de la phase 23, ou lecture d'un bookmaker parmi les sortes
 * annoncées), l'exécute avec le MÊME code que le serveur (transport serveur local + garde « jamais de mise »), rend le
 * résultat et la session. Identifiants et session arrivent dans la réponse du site, restent en mémoire et repartent.
 */
import {
  createBrowserScreenshotProvider,
  createMemoryPaceStore,
  createServerTransport,
  memoryTransportEnv,
  paceSite,
  portableReadHandler,
  portableReadKinds,
  runTransportKind,
  toCaptureRequest,
  type BookmakerBrowserLauncher,
  type BookmakerRunnerJob,
  type BrowserStorageState,
  type CaptureEnv,
  type CaptureResult,
  type RunnerJob,
  type ServerTransport,
} from "@linkaffipro/agents";

export const RUNNER_VERSION = "35.1";
/** Sortes faites par ce Mac : primitives du navigateur, test, et travaux complets portables s'il y en a. */
export function runnerKinds(): string[] {
  return ["fetch-api", "page", "record", "visible", "test", ...portableReadKinds()];
}

export type RunnerCall = <T>(method: "GET" | "POST", query: string, body?: unknown) => Promise<T>;

export type RunnerIo = {
  call: RunnerCall;
  launch: BookmakerBrowserLauncher;
  log: (msg: string) => void;
  /** `--visible` : navigateur affiché pour tous les travaux. */
  visible?: boolean;
  /** Transport imposé (tests). */
  transportFor?: (job: BookmakerRunnerJob, env: ReturnType<typeof memoryTransportEnv>) => ServerTransport;
};

// Rythme humain du Mac : en mémoire (le Mac ne lit qu'un site à la fois, le serveur tient le verrou du site).
const paceStore = createMemoryPaceStore();

export type ReadJobResult = { readJobId: string; ok: boolean; value?: unknown; message?: string; session: BrowserStorageState | null; durationMs: number };

/** Exécute un travail de lecture reçu du site ; ne lève jamais. */
export async function handleReadJob(job: BookmakerRunnerJob, io: RunnerIo): Promise<ReadJobResult> {
  const started = Date.now();
  const env = memoryTransportEnv({ site: job.site, credentials: job.credentials, session: job.session });
  const transport =
    io.transportFor?.(job, env) ??
    createServerTransport(null, {
      env,
      launch: (o) => io.launch({ ...o, headless: o.headless === false ? false : !io.visible }),
      pace: async (siteKey, kind) => {
        await paceSite({ prisma: null }, siteKey, { kind, store: paceStore });
      },
      headless: !io.visible,
      target: "mac",
    });
  try {
    let value: unknown;
    const portable = portableReadHandler(job.kind);
    if (portable) value = await portable(transport, { siteKey: job.siteKey, kind: job.kind, params: job.params });
    else value = await runTransportKind(transport, job.siteKey, job.kind, job.params, job.site.baseUrl);
    return { readJobId: job.id, ok: true, value, session: env.savedSession(), durationMs: Date.now() - started };
  } catch (err) {
    return { readJobId: job.id, ok: false, message: String((err as Error)?.message ?? err).slice(0, 300), session: env.savedSession(), durationMs: Date.now() - started };
  }
}

/** Capture de la phase 23 (inchangée). */
export async function handleCaptureJob(job: RunnerJob, io: RunnerIo): Promise<Record<string, unknown>> {
  let saved: BrowserStorageState | null = null;
  const env: CaptureEnv = {
    credentials: async () => job.credentials,
    loadSession: async () => job.session,
    saveSession: async (_b, s) => {
      saved = s;
    },
    proxy: async () => null,
    sites: async () => job.sites,
  };
  const provider = createBrowserScreenshotProvider({ env, launch: () => io.launch({ proxy: null, headless: !io.visible }), name: "mac" });
  const r = job.request;
  let result: CaptureResult;
  if (r.kind === "test") result = await provider.testConnection(r.bookmaker);
  else {
    const req = toCaptureRequest(r);
    result = req ? await provider.capture(req) : { ok: false, kind: "unknown", message: "demande vide" };
  }
  io.log(result.ok ? "Capture terminée ✅" : `Capture en échec : ${result.kind}`);
  return {
    id: r.id,
    ok: result.ok,
    ...(result.ok ? { pngBase64: Buffer.from(result.png).toString("base64"), readOdds: result.readOdds, pageUrl: result.pageUrl } : { kind: result.kind, message: result.message }),
    session: saved,
  };
}

/** Pur : adresse de la demande au site (sortes annoncées, attente longue, version). */
export function nextQuery(o: { kinds: string[]; waitSec: number; visible: boolean }): string {
  return `?read=1&kinds=${encodeURIComponent(o.kinds.join(","))}&wait=${o.waitSec}&v=${RUNNER_VERSION}${o.visible ? "&visible=1" : ""}`;
}

/** Un passage : `idle` (rien à faire), `capture` ou `read` (travail fait et rendu). */
export async function runnerPass(io: RunnerIo, o: { waitSec?: number } = {}): Promise<"idle" | "capture" | "read"> {
  const res = await io.call<{ job: RunnerJob | null; readJob?: BookmakerRunnerJob | null }>("GET", nextQuery({ kinds: runnerKinds(), waitSec: o.waitSec ?? 20, visible: !!io.visible }));
  if (res.job) {
    const r = res.job.request;
    io.log(`${r.kind === "test" ? "Test de connexion" : "Capture"} ${r.bookmaker}`);
    await io.call("POST", "", await handleCaptureJob(res.job, io));
    return "capture";
  }
  if (res.readJob) {
    const j = res.readJob;
    io.log(`Lecture ${j.kind} sur ${j.site.label}`);
    const out = await handleReadJob(j, io);
    await io.call("POST", "", out);
    const obstacle = (out.value as { obstacle?: unknown } | undefined)?.obstacle;
    io.log(out.ok ? (typeof obstacle === "string" ? `Terminé avec un obstacle : ${obstacle}` : "Terminé ✅") : `Échec : ${out.message ?? "erreur"}`);
    return "read";
  }
  return "idle";
}
