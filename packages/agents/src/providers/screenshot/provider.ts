/**
 * Fournisseur de captures par navigateur (Playwright Chromium), commun au worker, au `capture-runner` du Mac et aux
 * tests : le lancement du navigateur, le verrou (un seul navigateur à la fois) et l'accès aux secrets sont injectés.
 * Une session = un contexte neuf alimenté par la session chiffrée (en mémoire), réexportée et rechiffrée à la fin ;
 * le navigateur est toujours fermé (son dossier temporaire est supprimé par Playwright).
 */
import type { Browser, BrowserContext } from "playwright-core";
import type { Db as PrismaClient } from "@linkaffipro/db";
import type { Logger } from "../../types";
import type { CaptureRequest, CaptureResult, ScreenshotProvider } from "../screenshot";
import { createSelectorAdapter, type BookmakerAdapter, type BookmakerConfig, type BookmakerCredentials } from "./adapter";
import { adapterFor } from "./adapters";
import { CaptureError, classifyCaptureError } from "./errors";
import { GuardedPage, installPageHelpers } from "./guard";
import { loadCaptureSettings } from "./settings";
import {
  readBookmakerCredentials,
  readBookmakerSession,
  readScreenshotProxy,
  saveBookmakerSession,
  type BrowserStorageState,
  type ProxyConfig,
} from "./session";

export type BrowserLauncher = (o: { proxy: ProxyConfig | null }) => Promise<Browser>;

/** Accès aux secrets et réglages (base dans le worker, API du site pour le Mac, valeurs fixes en test). */
export type CaptureEnv = {
  credentials(bookmaker: string): Promise<BookmakerCredentials | null>;
  loadSession(bookmaker: string): Promise<BrowserStorageState | null>;
  saveSession(bookmaker: string, state: BrowserStorageState): Promise<void>;
  proxy(): Promise<ProxyConfig | null>;
  /** Corrections des adaptateurs (`settings.sports.bookmakerSites`). */
  sites(): Promise<Record<string, unknown> | null>;
};

export function dbCaptureEnv(prisma: PrismaClient): CaptureEnv {
  return {
    credentials: (b) => readBookmakerCredentials(prisma, b),
    loadSession: (b) => readBookmakerSession(prisma, b),
    saveSession: (b, s) => saveBookmakerSession(prisma, b, s),
    proxy: () => readScreenshotProxy(prisma),
    sites: async () => (await loadCaptureSettings(prisma)).bookmakerSites,
  };
}

export type CaptureLock = <T>(fn: () => Promise<T>) => Promise<T>;

export type BrowserProviderOptions = {
  env: CaptureEnv;
  launch: BrowserLauncher;
  /** Verrou Redis `capture:lock` dans le worker ; aucun ailleurs. */
  lock?: CaptureLock;
  /** Adaptateur imposé (tests : page locale). */
  adapter?: (bookmaker: string, sites: Record<string, unknown> | null) => BookmakerAdapter | null;
  /** Durée maximale d'une session complète. */
  totalTimeoutMs?: number;
  logger?: Logger;
  name?: string;
};

/** Fournisseur réel + rendu d'un gabarit HTML (image de repli). */
export type BrowserScreenshotProvider = ScreenshotProvider & {
  renderTemplate(html: string, size?: { width: number; height: number }): Promise<Uint8Array>;
};

export const CAPTURE_TOTAL_TIMEOUT_MS = 150_000;
const VIEWPORT = { width: 1280, height: 900 };

function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new CaptureError("timeout", `capture interrompue après ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

export function createBrowserScreenshotProvider(opts: BrowserProviderOptions): BrowserScreenshotProvider {
  const lock: CaptureLock = opts.lock ?? ((fn) => fn());
  const total = opts.totalTimeoutMs ?? CAPTURE_TOTAL_TIMEOUT_MS;
  const pickAdapter = opts.adapter ?? ((b: string, sites: Record<string, unknown> | null) => adapterFor(b, sites));

  /** Ouvre un navigateur, joue `work` avec la page gardée, ferme tout ; erreurs classées. */
  async function session(
    bookmaker: string,
    work: (adapter: BookmakerAdapter, page: GuardedPage, creds: BookmakerCredentials | null) => Promise<CaptureResult>,
    config?: BookmakerConfig | null,
  ): Promise<CaptureResult> {
    const sites = config ? null : await opts.env.sites().catch(() => null);
    // Phase 35 : recette apprise du site (sélecteurs et domaines validés) avant l'adaptateur figé de la phase 23.
    const adapter = config ? createSelectorAdapter(config) : pickAdapter(bookmaker, sites);
    if (!adapter) return { ok: false, kind: "not_found", message: `bookmaker « ${bookmaker} » sans adaptateur de capture` };
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    const run = async (): Promise<CaptureResult> => {
      const [creds, state, proxy] = await Promise.all([opts.env.credentials(bookmaker), opts.env.loadSession(bookmaker), opts.env.proxy()]);
      browser = await opts.launch({ proxy });
      context = await browser.newContext({
        viewport: VIEWPORT,
        locale: "fr-FR",
        timezoneId: "Europe/Paris",
        ...(state ? { storageState: state as never } : {}),
      });
      await installPageHelpers(context);
      const page = await context.newPage();
      // Aucune fenêtre surgissante : un clic imprévu n'ouvre rien d'autre.
      context.on("page", (p) => {
        if (p !== page) void p.close().catch(() => undefined);
      });
      const guarded = new GuardedPage(page, adapter.config.allowedHosts, (action, detail) =>
        opts.logger?.info({ bookmaker: adapter.key, action, detail }, "[capture] action"),
      );
      const result = await work(adapter, guarded, creds);
      // Session réexportée et rechiffrée après chaque passage réussi (connexion gardée pour la prochaine fois).
      if (result.ok || result.kind === "not_found" || result.kind === "market_missing") {
        const next = (await context.storageState()) as unknown as BrowserStorageState;
        await opts.env.saveSession(bookmaker, next).catch((err) => opts.logger?.warn({ err: (err as Error).message }, "[capture] session non rangée"));
      }
      return result;
    };
    try {
      return await lock(() =>
        withDeadline(run(), total, () => {
          void (browser as Browser | null)?.close().catch(() => undefined);
        }).catch((err) => classifyCaptureError(err)),
      );
    } catch (err) {
      // Verrou pris ou Redis muet : on réessaiera au passage suivant.
      if (err instanceof CaptureError) return classifyCaptureError(err);
      return { ok: false, kind: "timeout", message: `une autre capture est en cours (${(err as Error).message.slice(0, 120)})` };
    } finally {
      await (context as BrowserContext | null)?.close().catch(() => undefined);
      await (browser as Browser | null)?.close().catch(() => undefined);
    }
  }

  const provider: BrowserScreenshotProvider = {
    name: opts.name ?? "playwright",

    capture(req: CaptureRequest) {
      return session(req.bookmaker, async (adapter, page, creds) => {
        const s = { page, credentials: creds };
        try {
          await adapter.openHome(s);
          await adapter.login(s);
          await adapter.findEvent(s, req);
          const handle = await adapter.findMarket(s, req);
          const readOdds = await adapter.readOdds(s, handle);
          const png = await adapter.highlightAndCapture(s, handle);
          return { ok: true, png, readOdds, pageUrl: page.url() };
        } catch (err) {
          return classifyCaptureError(err);
        }
      }, req.config ?? null);
    },

    testConnection(bookmaker: string) {
      return session(bookmaker, async (adapter, page, creds) => {
        if (!creds) return { ok: false, kind: "login_failed", message: "identifiant ou mot de passe pas encore enregistrés" };
        const s = { page, credentials: creds };
        try {
          await adapter.openHome(s);
          const outcome = await adapter.login(s);
          if (outcome === "logged_in") await adapter.openHome(s);
          const png = await page.capture();
          return { ok: true, png, readOdds: 0, pageUrl: page.url() };
        } catch (err) {
          return classifyCaptureError(err);
        }
      });
    },

    async renderTemplate(html, size = { width: 1080, height: 1080 }) {
      return lock(async () => {
        const browser = await opts.launch({ proxy: null });
        try {
          const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, javaScriptEnabled: false });
          // Gabarit autonome : aucune requête réseau permise.
          await context.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
          const page = await context.newPage();
          await page.setContent(html, { waitUntil: "load" });
          return new Uint8Array(await page.screenshot({ type: "png", fullPage: false }));
        } finally {
          await browser.close().catch(() => undefined);
        }
      });
    },
  };
  return provider;
}
