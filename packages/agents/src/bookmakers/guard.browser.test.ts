/**
 * Phase 35 (règle 1), test DYNAMIQUE de la garde « jamais de mise » : le transport serveur (vrai Chromium) sur un site
 * local `127.0.0.1` (aucun réseau externe). On vérifie côté serveur local qu'AUCUNE requête n'atteint la page de dépôt
 * (`fixtures/bookmaker/deposit.html`), le bouton « Placer le pari » ou une cote, même par un lien ou une redirection.
 * Sans Chromium (`pnpm --filter web exec playwright install chromium`), ces tests se sautent.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memoryTransportEnv } from "./transport/env";
import { createServerTransport, type ServerTransport } from "./transport/server";

const DEPOSIT = readFileSync(fileURLToPath(new URL("../../fixtures/bookmaker/deposit.html", import.meta.url)), "utf8");
const FILLER = "<p>Paris sportifs : football, tennis, basket. Matchs du jour et des jours suivants.</p>";
const PAGES: Record<string, string> = {
  "/fr/sports": `<!doctype html><html><head><title>Sports</title></head><body>${FILLER}
    <nav><a id="foot" href="/fr/sports/football">Football</a> <a id="more" href="/fr/deposit">Voir plus</a> <a id="redir" href="/go">Ligue 1</a></nav>
    <div class="market"><span>PSG - OM</span>
      <button type="button" id="odd" onclick="fetch('/hit/odd')">1,85</button>
      <button type="button" id="bet" onclick="fetch('/hit/bet')">Placer le pari</button>
    </div></body></html>`,
  "/fr/sports/football": `<!doctype html><html><head><title>Football</title></head><body>${FILLER}<h1>Liste des matchs</h1><div id="list">PSG - OM 21:00</div></body></html>`,
  "/fr/deposit": DEPOSIT.replace("</h1>", `</h1>${FILLER}`),
};
const REDIRECTS: Record<string, string> = { "/go": "/fr/deposit", "/ok-redirect": "/fr/sports/football", "/sneaky": "/fr/sports?modal=cashier" };

let chromiumPath: string | null = null;
try {
  chromiumPath = chromium.executablePath();
} catch {
  chromiumPath = null;
}
const hasChromium = !!chromiumPath && existsSync(chromiumPath);

let server: Server;
let base = "";
const hits: string[] = [];

beforeAll(async () => {
  if (!hasChromium) return;
  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    hits.push(`${u.pathname}${u.search}`);
    if (REDIRECTS[u.pathname]) {
      res.writeHead(302, { location: REDIRECTS[u.pathname] }).end();
      return;
    }
    const html = PAGES[u.pathname];
    if (!html) {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...(u.pathname === "/fr/sports/football" ? { "set-cookie": "sid=abc; Path=/" } : {}) }).end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});
beforeEach(() => {
  hits.length = 0;
});

function transport(env = localEnv()): ServerTransport {
  return createServerTransport(null, {
    env,
    launch: ({ headless }) => chromium.launch({ headless: headless !== false }),
    pace: async () => undefined,
    login: null,
    stepTimeoutMs: 2_000,
    pageTimeoutMs: 30_000,
  });
}

function localEnv() {
  return memoryTransportEnv({ site: { key: "local", label: "Local", baseUrl: `${base}/fr/sports`, allowedHosts: ["127.0.0.1"] } });
}

const forbidden = (path: string) => hits.some((h) => h.startsWith(path));

describe.skipIf(!hasChromium)("garde « jamais de mise » dans un vrai navigateur (site local)", () => {
  it("lecture permise : onglet Football, redirection permise suivie, session rendue (cookies du site)", async () => {
    const env = localEnv();
    const t = transport(env);
    const r = await t.page("local", { url: `${base}/fr/sports`, steps: [{ click: { candidates: [{ css: "#nope" }, { text: "Football" }] } }] });
    expect(r).toMatchObject({ stepsUsed: [1] });
    expect((r as { text: string }).text).toContain("Liste des matchs");
    expect(env.savedSession()?.cookies.some((c) => c.name === "sid" && c.value === "abc")).toBe(true);
    const r2 = await t.page("local", { url: `${base}/ok-redirect` });
    expect((r2 as { url: string }).url).toBe(`${base}/fr/sports/football`);
  }, 60_000);

  it("page de dépôt : refusée avant d'ouvrir quoi que ce soit", async () => {
    const r = await transport().page("local", { url: `${base}/fr/deposit` });
    expect(r).toMatchObject({ obstacle: "forbidden_action" });
    expect(hits).toEqual([]);
  }, 60_000);

  it("bouton « Placer le pari » : clic refusé, rien n'est envoyé", async () => {
    const r = await transport().page("local", { url: `${base}/fr/sports`, steps: [{ click: { candidates: [{ text: "Placer le pari" }] } }] });
    expect(r).toMatchObject({ obstacle: "forbidden_action" });
    expect(forbidden("/hit/bet")).toBe(false);
  }, 60_000);

  it("une cote : jamais cliquée (on lit son texte)", async () => {
    const r = await transport().page("local", { url: `${base}/fr/sports`, steps: [{ click: { candidates: [{ css: "#odd" }] } }] });
    expect(r).toMatchObject({ obstacle: "forbidden_action" });
    expect(forbidden("/hit/odd")).toBe(false);
  }, 60_000);

  it("lien anodin vers le dépôt : refusé avant le clic", async () => {
    const r = await transport().page("local", { url: `${base}/fr/sports`, steps: [{ click: { candidates: [{ css: "#more" }] } }] });
    expect(r).toMatchObject({ obstacle: "forbidden_action" });
    expect(forbidden("/fr/deposit")).toBe(false);
  }, 60_000);

  it("redirection vers le dépôt (après un clic ou à l'ouverture) : coupée avant d'être suivie", async () => {
    const t = transport();
    await t.page("local", { url: `${base}/fr/sports`, steps: [{ click: { candidates: [{ css: "#redir" }] } }] });
    expect(forbidden("/go")).toBe(true);
    expect(forbidden("/fr/deposit")).toBe(false);
    const r = await t.page("local", { url: `${base}/go` });
    expect(r).toHaveProperty("obstacle");
    const r2 = await t.page("local", { url: `${base}/sneaky` });
    expect(r2).toHaveProperty("obstacle");
    expect(forbidden("/fr/deposit")).toBe(false);
    expect(hits.some((h) => /cashier/.test(h))).toBe(false);
  }, 60_000);
});
