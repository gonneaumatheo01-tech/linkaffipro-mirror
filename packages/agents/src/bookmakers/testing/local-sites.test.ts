import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pageOddsFromHtml } from "../learn/page-odds";
import { startLocalSites, type LocalSites } from "./local-sites";
import { CELSIUS_TEST_TOKEN, FIXTURE_VARIANTS } from "./world";
import { existsSync } from "node:fs";
import { FIXTURES_DIR } from "./local-sites";

describe("sites locaux des bookmakers inventés (127.0.0.1 seulement)", () => {
  let s: LocalSites;
  beforeAll(async () => {
    s = await startLocalSites();
  });
  afterAll(async () => s.stop());

  it("écoutent sur 127.0.0.1 et journalisent les requêtes", async () => {
    for (const site of Object.values(s.sites)) {
      expect(site.host).toBe("127.0.0.1");
      expect((await fetch(site.baseUrl)).status).toBe(200);
    }
    expect(s.requests.length).toBeGreaterThanOrEqual(3);
  });

  it("Celsius : API JSON avec jeton « Bearer », pagination, refus sans jeton", async () => {
    const o = s.sites.celsius.origin;
    expect((await fetch(`${o}/api/v2/events?date=2026-10-25`)).status).toBe(401);
    const token = ((await (await fetch(`${o}/api/v2/auth/token`)).json()) as { token: string })
      .token;
    expect(token).toBe(CELSIUS_TEST_TOKEN);
    const h = { authorization: `Bearer ${token}` };
    const p1 = (await (
      await fetch(`${o}/api/v2/events?date=2026-10-25&page=1`, { headers: h })
    ).json()) as { data: { events: unknown[] }; meta: { hasMore: boolean } };
    const p2 = (await (
      await fetch(`${o}/api/v2/events?date=2026-10-25&page=2`, { headers: h })
    ).json()) as { data: { events: unknown[] }; meta: { hasMore: boolean } };
    expect(p1.data.events.length + p2.data.events.length).toBe(8);
    expect(p1.meta.hasMore).toBe(true);
    expect(p2.meta.hasMore).toBe(false);
    s.setVariant("celsius", "expired");
    expect((await fetch(`${o}/api/v2/auth/token`)).status).toBe(401);
    s.setVariant("celsius", "captcha");
    expect((await fetch(`${o}/api/v2/events`, { headers: h })).status).toBe(403);
    expect(await (await fetch(`${o}/`)).text()).toMatch(/humain/);
    s.setVariant("celsius", null);
  });

  it("Sportaza : pages rendues par le serveur ; cote qui bouge ; marché absent ; géo-blocage", async () => {
    const o = s.sites.sportaza.origin;
    const base = pageOddsFromHtml(await (await fetch(`${o}/fr/sports/match/m-4401`)).text());
    s.setVariant("sportaza", "odds-moved");
    const moved = pageOddsFromHtml(await (await fetch(`${o}/fr/sports/match/m-4401`)).text());
    expect(moved[0]!.odds).not.toBe(base[0]!.odds);
    expect(moved.slice(1)).toEqual(base.slice(1));
    s.setVariant("sportaza", "market-missing");
    const html = await (await fetch(`${o}/fr/sports/match/m-4401`)).text();
    expect(html).not.toMatch(/Corners - total/);
    s.setVariant("sportaza", "geo");
    const geo = await fetch(`${o}/fr/sports`);
    expect(geo.status).toBe(403);
    expect(await geo.text()).toMatch(/pas disponible dans votre pays/);
    s.setVariant("sportaza", null);
  });

  it("aucune caisse réelle : les adresses d'argent répondent une page factice (la garde ne doit jamais y aller)", async () => {
    const r = await fetch(`${s.sites.betportal.origin}/wallet`);
    expect(await r.text()).toMatch(/Caisse/);
  });

  it("chaque variante existe pour chaque site", () => {
    for (const site of ["celsius", "sportaza", "betportal"])
      for (const v of FIXTURE_VARIANTS)
        expect(existsSync(`${FIXTURES_DIR}${site}/${v}`), `${site}/${v}`).toBe(true);
  });
});
