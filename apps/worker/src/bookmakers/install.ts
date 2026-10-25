/**
 * Lecture des bookmakers dans le worker (phase 35, chantier A) : navigateur du worker pour le transport serveur, mise
 * en file immédiate des travaux « serveur » déposés, branchements des travaux complets (apprentissage, matchs, cotes,
 * double lecture) quand les chantiers B / C les exportent sous les noms du contrat. Appelé une fois (au chargement du
 * processeur `agents-bookmakers`).
 */
import * as agents from "@linkaffipro/agents";
import {
  readJobHandler,
  registerReadJobHandler,
  setBookmakerBrowserLauncher,
  setReadJobKick,
  type AgentsDeps,
  type ReadJobRow,
} from "@linkaffipro/agents";
import { getQueue, safeJobId } from "@linkaffipro/queue";
import { hasChromium, launchChromium } from "../capture/browser";
import { logger } from "../logger";

type AnyFn = (...a: unknown[]) => Promise<unknown>;
const exported = (name: string): AnyFn | null => {
  const f = (agents as unknown as Record<string, unknown>)[name];
  return typeof f === "function" ? (f as AnyFn) : null;
};

const dateOr = (v: unknown, fallback: Date): Date => {
  const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d : fallback;
};

/** Travaux complets par les fonctions du contrat (`BookmakersApi`), si un autre branchement ne les a pas déjà pris. */
export function registerContractHandlers(lookup: (name: string) => AnyFn | null = exported): string[] {
  const done: string[] = [];
  const add = (kind: string, name: string, call: (fn: AnyFn, deps: AgentsDeps, job: ReadJobRow, p: Record<string, unknown>) => Promise<unknown>) => {
    if (readJobHandler(kind)) return;
    const fn = lookup(name);
    if (!fn) return;
    registerReadJobHandler(kind, (deps, job) => call(fn, deps, job, (job.params ?? {}) as Record<string, unknown>));
    done.push(kind);
  };
  add("learn", "learnSite", (fn, d, j, p) => fn(d, j.siteKey, { reason: typeof p.reason === "string" ? p.reason : "manual" }));
  add("events", "readEvents", (fn, d, j, p) => {
    const now = d.now ? d.now() : new Date();
    return fn(d, j.siteKey, { from: dateOr(p.from, now), to: dateOr(p.to, new Date(now.getTime() + 2 * 86400_000)), ...(Array.isArray(p.leagues) ? { leagues: p.leagues } : {}) });
  });
  add("markets", "readMarkets", (fn, d, j, p) => fn(d, j.siteKey, String(p.siteEventId ?? ""), Array.isArray(p.marketKeys) ? p.marketKeys : []));
  add("verify", "readOddsTwice", (fn, d, j, p) =>
    fn(d, j.siteKey, { siteEventId: String(p.siteEventId ?? ""), marketKey: String(p.marketKey ?? ""), selectionKey: String(p.selectionKey ?? ""), line: typeof p.line === "number" ? p.line : null }),
  );
  return done;
}

let installed = false;

export function installBookmakers(): void {
  if (installed) return;
  installed = true;
  if (hasChromium()) setBookmakerBrowserLauncher(launchChromium);
  else logger.warn({}, "[bookmakers] Chromium absent : lecture depuis le serveur indisponible dans ce processus");
  setReadJobKick(async (job) => {
    const q = getQueue("agents-bookmakers");
    await q.add("agents-bookmakers:run", { type: "run", jobId: job.id }, { jobId: safeJobId(`run:${job.id}`)! });
  });
  const kinds = registerContractHandlers();
  if (kinds.length) logger.info({ kinds }, "[bookmakers] travaux complets branchés");
}
