/**
 * Phase 35, chantier A : choix du transport d'un site selon `BookmakerSite.readTarget`.
 * - `server` : le navigateur du serveur seulement ;
 * - `mac` : le Mac du client ; si c'est une bascule AUTOMATIQUE, un nouvel essai serveur par semaine (réussi → `auto`) ;
 * - `auto` : serveur d'abord ; page de géo-blocage, refus (pare-feu) ou vérification anti-robot vue depuis le serveur →
 *   bascule sur le Mac pour ce site (`readTarget = "mac"`, `statusReason`), et l'appel est refait aussitôt par le Mac.
 * Règle 8 : aucun contournement par usurpation ; si le serveur est refusé, c'est le Mac du client qui lit, c'est tout.
 * Nuit (1 h - 7 h Paris) : aucune lecture sauf `force` (ordre) → `{ obstacle: "night" }`.
 * Exporte aussi le verrou par site et le rythme (`lock.ts`, `pace.ts`) et les branchements du lecteur (chantier C).
 */
import type { AgentsDeps, AgentsPrisma, Logger } from "../../types";
import type { BookmakerTransport, DomStep } from "../contract";
import { createMacTransport, type MacTransportOptions } from "./mac";
import { SWITCH_TO_MAC_OBSTACLES } from "./obstacles";
import { paceSite, readAllowedAt } from "./pace";
import { withSiteLock } from "./lock";
import { createServerTransport, type ServerTransportOptions } from "./server";

export { withSiteLock, SiteLockBusy, siteLocked, SITE_LOCK_TTL_MS } from "./lock";
export { paceSite, isParisNight, readAllowedAt } from "./pace";

export const TARGET_STATE_PREFIX = "bookmakers.target.";
/** Après une bascule automatique sur le Mac, nouvel essai depuis le serveur une fois par semaine. */
export const SERVER_RETRY_MS = 7 * 86400_000;

export type SiteRef = { key: string; readTarget?: string | null; statusReason?: string | null };
export type TargetState = { auto: boolean; switchedAt: string; lastServerTryAt: string; reason: string };

type Deps = { prisma: AgentsPrisma; now?: () => Date; logger?: Logger };
const nowOf = (d: { now?: () => Date }) => (d.now ? d.now() : new Date());

export async function readTargetState(deps: Deps, siteKey: string): Promise<TargetState | null> {
  const row = await deps.prisma.setting.findUnique({ where: { key: `${TARGET_STATE_PREFIX}${siteKey}` } });
  const v = row?.value as TargetState | undefined;
  return v && typeof v.switchedAt === "string" ? v : null;
}

async function writeTargetState(deps: Deps, siteKey: string, v: TargetState | null): Promise<void> {
  const key = `${TARGET_STATE_PREFIX}${siteKey}`;
  if (!v) {
    await deps.prisma.setting.deleteMany({ where: { key } });
    return;
  }
  await deps.prisma.setting.upsert({ where: { key }, create: { key, value: v as never }, update: { value: v as never } });
}

/** Libellé lisible de la raison d'une bascule (affiché au client). */
export function switchReasonText(obstacle: string): string {
  if (obstacle === "geo_blocked") return "site indisponible depuis le pays du serveur : lecture par le Mac";
  if (obstacle === "captcha") return "le site demande au serveur de prouver qu'il n'est pas un robot : lecture par le Mac";
  return "le site refuse le serveur : lecture par le Mac";
}

/** Bascule un site sur le Mac (automatique : nouvel essai serveur chaque semaine). */
export async function switchSiteToMac(deps: Deps, siteKey: string, obstacle: string, o: { auto?: boolean } = {}): Promise<void> {
  const now = nowOf(deps).toISOString();
  const reason = switchReasonText(obstacle);
  await deps.prisma.bookmakerSite.updateMany({ where: { key: siteKey }, data: { readTarget: "mac", statusReason: reason } });
  await writeTargetState(deps, siteKey, { auto: o.auto ?? true, switchedAt: now, lastServerTryAt: now, reason: obstacle });
  deps.logger?.info({ siteKey, obstacle }, "[bookmakers] lecture basculée sur le Mac");
}

/** Pur : quel transport essayer d'abord ? (`serverRetry` : essai hebdomadaire après une bascule automatique.) */
export function firstTarget(readTarget: string | null | undefined, state: TargetState | null, now: Date): { first: "server" | "mac"; fallback: boolean; serverRetry: boolean } {
  if (readTarget === "server") return { first: "server", fallback: false, serverRetry: false };
  if (readTarget === "mac") {
    const due = !!state?.auto && now.getTime() - new Date(state.lastServerTryAt).getTime() >= SERVER_RETRY_MS;
    return due ? { first: "server", fallback: true, serverRetry: true } : { first: "mac", fallback: false, serverRetry: false };
  }
  return { first: "server", fallback: true, serverRetry: false };
}

export type PickOptions = {
  server?: BookmakerTransport;
  mac?: BookmakerTransport;
  serverOptions?: ServerTransportOptions;
  macOptions?: MacTransportOptions;
  /** Ordre de l'admin : lecture permise la nuit. */
  force?: boolean;
};

type Res = { obstacle?: unknown };
const obstacleOf = (r: unknown): string | null => (r && typeof r === "object" && typeof (r as Res).obstacle === "string" ? ((r as Res).obstacle as string) : null);

export type RoutedTransport = BookmakerTransport & {
  /** Cible réellement utilisée pour le dernier appel. */
  readonly lastTarget: "server" | "mac" | null;
};

/** Transport d'un site : choix de la cible, bascule automatique, nuit. */
export async function pickTransport(deps: Deps, site: SiteRef | string, opts: PickOptions = {}): Promise<RoutedTransport> {
  const ref: SiteRef =
    typeof site === "string"
      ? (((await deps.prisma.bookmakerSite.findUnique({ where: { key: site } })) as SiteRef | null) ?? { key: site, readTarget: "auto" })
      : site;
  const server = opts.server ?? createServerTransport(deps, opts.serverOptions);
  const mac = opts.mac ?? createMacTransport(deps, opts.macOptions);
  let readTarget = ref.readTarget ?? "auto";
  let lastTarget: "server" | "mac" | null = null;

  async function call<T>(f: (t: BookmakerTransport) => Promise<T>): Promise<T | { obstacle: string }> {
    if (!readAllowedAt(nowOf(deps), opts.force)) return { obstacle: "night" };
    const state = await readTargetState(deps, ref.key);
    const plan = firstTarget(readTarget, state, nowOf(deps));
    if (plan.first === "mac") {
      lastTarget = "mac";
      return f(mac);
    }
    lastTarget = "server";
    const r = await f(server);
    const obstacle = obstacleOf(r);
    if (!plan.fallback || !obstacle || !SWITCH_TO_MAC_OBSTACLES.has(obstacle)) {
      // Essai hebdomadaire réussi : le site revient en automatique (serveur d'abord).
      if (plan.serverRetry && !obstacle) {
        await deps.prisma.bookmakerSite.updateMany({ where: { key: ref.key }, data: { readTarget: "auto", statusReason: null } });
        await writeTargetState(deps, ref.key, null);
        readTarget = "auto";
      }
      return r;
    }
    if (plan.serverRetry && state) await writeTargetState(deps, ref.key, { ...state, lastServerTryAt: nowOf(deps).toISOString() });
    else await switchSiteToMac(deps, ref.key, obstacle);
    readTarget = "mac";
    lastTarget = "mac";
    return f(mac);
  }

  return {
    get target() {
      return lastTarget ?? (firstTarget(readTarget, null, nowOf(deps)).first as "server" | "mac");
    },
    get lastTarget() {
      return lastTarget;
    },
    fetchApi: (siteKey, req) => call((t) => t.fetchApi(siteKey, req)),
    page: (siteKey, req: { url: string; steps?: Array<{ click?: DomStep; waitFor?: DomStep }>; captureOf?: DomStep | null }) => call((t) => t.page(siteKey, req)),
    record: (siteKey, baseUrl) => call((t) => t.record(siteKey, baseUrl)),
  };
}

/**
 * Branchements du lecteur du chantier C (`deps.bookmakers`) : transport choisi par site, verrou par site en base,
 * rythme en base, bascule sur le Mac. Le worker les pose une fois (`apps/worker/src/bookmakers`).
 */
export function bookmakerTransportHooks(deps: Deps, opts: PickOptions = {}) {
  return {
    pickTransport: (_d: AgentsDeps, site: SiteRef) => pickTransport(deps, site, opts),
    withSiteLock: <T>(siteKey: string, fn: () => Promise<T>) => withSiteLock(deps, siteKey, fn),
    paceSite: async (siteKey: string, kind: "api" | "page") => {
      await paceSite(deps, siteKey, { kind: kind === "api" ? "request" : "page" });
    },
    switchToMac: (siteKey: string, reason: string) => switchSiteToMac(deps, siteKey, /geo/i.test(reason) ? "geo_blocked" : /captcha|robot/i.test(reason) ? "captcha" : "server_refused"),
  };
}
