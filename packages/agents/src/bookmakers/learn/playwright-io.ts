/**
 * Phase 35 (chantier B) — `RecordIo` autonome au-dessus d'une page Playwright (tests sur les sites locaux, script des
 * enregistrements de référence). En production, c'est le transport du chantier A qui fournit le `RecordIo` (session,
 * proxy, rythme partagé). La page brute ne sort jamais d'ici : le parcours ne reçoit que la page GARDÉE (garde de base
 * + garde de lecture).
 */
import type { Page } from "playwright-core";
import { GuardedPage } from "../../providers/screenshot/guard";
import type { BookmakerCredentials } from "../../providers/screenshot/adapter";
import { BOOKMAKER_LIMITS } from "../contract";
import { READ_GUARD_CHECKS } from "../guard";
import type { ObservedFrame, ObservedResponse, RecordIo } from "../transport/hooks";

export type PlaywrightIoOptions = {
  siteKey: string;
  baseUrl: string;
  allowedHosts: string[];
  credentials?: BookmakerCredentials | null;
  /** Attente entre deux pages (défaut : 2 à 5 s, rythme humain). */
  pace?: () => Promise<void>;
  /** Journal des actions de la garde (tests : aucune cote, aucun bouton de mise). */
  guardLog?: (action: string, detail: string) => void;
};

/** Attente humaine entre deux pages (pur : `random` dans [0, 1[). */
export function humanDelayMs(random: number): number {
  const { minPageDelayMs: lo, maxPageDelayMs: hi } = BOOKMAKER_LIMITS;
  return Math.round(lo + Math.min(Math.max(random, 0), 0.999999) * (hi - lo));
}

export function createPlaywrightRecordIo(
  page: Page,
  o: PlaywrightIoOptions,
): RecordIo & { guarded: GuardedPage } {
  const gp = new GuardedPage(
    page,
    o.allowedHosts,
    o.guardLog ?? (() => undefined),
    READ_GUARD_CHECKS,
  );
  const responseCbs: Array<(r: ObservedResponse) => void> = [];
  const frameCbs: Array<(f: ObservedFrame) => void> = [];
  page.on("response", (res) => {
    const rq = res.request();
    const observed: ObservedResponse = {
      url: res.url(),
      method: rq.method(),
      status: res.status(),
      resourceType: rq.resourceType(),
      contentType: res.headers()["content-type"] ?? null,
      requestHeaders: rq.headers(),
      requestBody: rq.postData(),
      body: () => res.text(),
    };
    for (const cb of responseCbs) cb(observed);
  });
  page.on("websocket", (ws) => {
    const emit = (direction: ObservedFrame["direction"]) => (f: { payload: string | Buffer }) => {
      const payload = typeof f.payload === "string" ? f.payload : f.payload.toString("utf8");
      for (const cb of frameCbs) cb({ url: ws.url(), direction, payload });
    };
    ws.on("framesent", emit("sent"));
    ws.on("framereceived", emit("received"));
  });
  const creds = o.credentials ?? null;
  return {
    guarded: gp,
    siteKey: o.siteKey,
    baseUrl: o.baseUrl,
    page: gp,
    credentials: creds,
    secrets: creds ? [creds.login, creds.password] : [],
    pace: o.pace ?? (() => gp.pause(humanDelayMs(Math.random()))),
    onResponse: (cb) => void responseCbs.push(cb),
    onWebSocketFrame: (cb) => void frameCbs.push(cb),
    frameUrls: () => page.frames().map((f) => f.url()),
    screenshot: async () => Buffer.from(await gp.capture()).toString("base64"),
    async login() {
      if (!creds) return "skipped";
      const user = gp.find(
        "input[type=email], input[autocomplete=username], input[name=email], input[name=login], input[name=username]",
      );
      const pw = gp.find("input[type=password]");
      if ((await pw.count()) === 0) return "already";
      if ((await user.count()) > 0) await gp.fill(user, creds.login, "login");
      await gp.fill(pw, creds.password, "password");
      await gp.pressEnter(pw, "password");
      await gp.settle(8_000);
      return "logged_in";
    },
  };
}
