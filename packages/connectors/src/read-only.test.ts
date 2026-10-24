/**
 * Règle de la phase 24 (Agent Ads) : les connecteurs Meta / TikTok sont en LECTURE. Aucune fonction ne change un
 * budget, n'arrête, ne crée ni ne modifie une pub ; le seul POST est l'échange de jeton OAuth de TikTok.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as connectors from "./index";

const READ_METHODS = ["platform", "verifyApp", "authorizeUrl", "exchangeCode", "refresh", "listAccounts", "fetchDailyInsights"].sort();

describe("connecteurs publicitaires en lecture seule", () => {
  it("les fournisseurs n'exposent que des lectures (et la connexion OAuth)", () => {
    for (const p of [connectors.metaProvider, connectors.tiktokProvider]) expect(Object.keys(p).sort()).toEqual(READ_METHODS);
  });

  it("aucun export ne ressemble à une écriture", () => {
    const names = Object.keys(connectors);
    expect(names.filter((n) => /update|create|delete|pause|stop|budget|set[A-Z]|write|edit|publish|launch/i.test(n))).toEqual([]);
  });

  it("seuls des GET partent vers les plateformes, sauf l'échange de jeton TikTok", () => {
    const meta = readFileSync(join(__dirname, "meta/index.ts"), "utf8") + readFileSync(join(__dirname, "meta/insights.ts"), "utf8");
    expect(meta).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    const tiktok = readFileSync(join(__dirname, "tiktok/index.ts"), "utf8") + readFileSync(join(__dirname, "tiktok/report.ts"), "utf8");
    expect(tiktok).not.toMatch(/method:\s*"(PUT|PATCH|DELETE)"/);
    const posts = [...tiktok.matchAll(/post<\w+>\(\s*[^,]+,\s*`([^`]+)`/g)].map((m) => m[1]);
    expect(posts.length).toBeGreaterThan(0);
    for (const path of posts) expect(path).toMatch(/\/oauth2\/(access_token|refresh_token)\/$/);
  });
});
