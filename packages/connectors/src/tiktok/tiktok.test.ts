import { describe, expect, it } from "vitest";
import { ConnectorError } from "../errors";
import type { AppCredentials, FetchOptions, TokenSet } from "../types";
import { listAccountsByIds, tiktokProvider, TIKTOK_API_BASE, TIKTOK_SANDBOX_BASE } from "./index";
import { tiktokError } from "./errors";
import { hasNextPage, mapReportRow, statDay } from "./report";

const app: AppCredentials = { clientId: "7123456789012345678", secret: "s3cret" };
const tokens: TokenSet = { accessToken: "tok-123" };

type Call = { url: URL; init: RequestInit };
/** `fetch` simulé : une réponse par motif d'URL (ordre d'appel conservé), journal des appels. */
function fakeFetch(
  routes: { match: string | RegExp; reply: (call: Call, n: number) => unknown; status?: number }[],
) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const call = { url, init: init ?? {} };
    calls.push(call);
    const route = routes.find((r) =>
      typeof r.match === "string" ? url.pathname.includes(r.match) : r.match.test(url.href),
    );
    if (!route)
      return new Response(
        JSON.stringify({ code: 40000, message: `route inconnue ${url.pathname}` }),
        { status: 200 },
      );
    const key = String(route.match);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const body = route.reply(call, n);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const opts = (fetchImpl: typeof fetch, extra: Partial<FetchOptions> = {}): FetchOptions => ({
  fetchImpl,
  now: new Date("2026-10-10T10:00:00Z"),
  ...extra,
});

describe("tiktokProvider.authorizeUrl", () => {
  it("pointe vers le portail avec app_id, state et redirect_uri", () => {
    const url = new URL(
      tiktokProvider.authorizeUrl(
        app,
        "https://app.linkaffipro.com/api/connectors/tiktok/callback",
        "st.sig",
      ),
    );
    expect(url.origin + url.pathname).toBe("https://business-api.tiktok.com/portal/auth");
    expect(url.searchParams.get("app_id")).toBe(app.clientId);
    expect(url.searchParams.get("state")).toBe("st.sig");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.linkaffipro.com/api/connectors/tiktok/callback",
    );
  });
});

describe("tiktokProvider.exchangeCode", () => {
  it("échange le code (jeton longue durée, sans refresh_token)", async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        match: "/oauth2/access_token/",
        reply: () => ({
          code: 0,
          message: "OK",
          data: { access_token: "tok-long", advertiser_ids: [111, "222"], scope: [4, 15] },
        }),
      },
    ]);
    const t = await tiktokProvider.exchangeCode(
      app,
      "auth-code-1",
      "https://x/cb",
      opts(fetchImpl),
    );
    expect(t.accessToken).toBe("tok-long");
    expect(t.refreshToken).toBeNull();
    expect(t.expiresAt).toBeNull();
    expect(t.scopes).toBe("4,15");
    expect(t.raw).toEqual({ advertiser_ids: ["111", "222"] });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({
      app_id: app.clientId,
      secret: "s3cret",
      auth_code: "auth-code-1",
      grant_type: "authorization_code",
    });
    expect(calls[0]!.url.href).toBe(`${TIKTOK_API_BASE}/open_api/v1.3/oauth2/access_token/`);
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("renseigne expiresAt et refresh_token quand TikTok les fournit", async () => {
    const { fetchImpl } = fakeFetch([
      {
        match: "/oauth2/access_token/",
        reply: () => ({
          code: 0,
          data: { access_token: "a", refresh_token: "r", expires_in: "86400", advertiser_ids: [] },
        }),
      },
    ]);
    const t = await tiktokProvider.exchangeCode(app, "c", "https://x/cb", opts(fetchImpl));
    expect(t.refreshToken).toBe("r");
    expect(t.expiresAt?.toISOString()).toBe("2026-10-11T10:00:00.000Z");
  });

  it("lève une erreur auth quand le code est refusé", async () => {
    const { fetchImpl } = fakeFetch([
      {
        match: "/oauth2/access_token/",
        reply: () => ({
          code: 40105,
          message: "Auth code is incorrect or expired",
          request_id: "rq1",
        }),
      },
    ]);
    await expect(
      tiktokProvider.exchangeCode(app, "bad", "https://x/cb", opts(fetchImpl)),
    ).rejects.toMatchObject({ kind: "auth", platformCode: "40105" });
  });
});

describe("tiktokProvider.refresh", () => {
  it("renvoie null sans refresh_token", async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    expect(await tiktokProvider.refresh(app, tokens, opts(fetchImpl))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("appelle /oauth2/refresh_token/ et conserve l'ancien refresh_token si absent de la réponse", async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        match: "/oauth2/refresh_token/",
        reply: () => ({ code: 0, data: { access_token: "new", expires_in: 3600 } }),
      },
    ]);
    const t = await tiktokProvider.refresh(
      app,
      { ...tokens, refreshToken: "old-r", scopes: "4" },
      opts(fetchImpl),
    );
    expect(t?.accessToken).toBe("new");
    expect(t?.refreshToken).toBe("old-r");
    expect(t?.scopes).toBe("4");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      app_id: app.clientId,
      secret: "s3cret",
      refresh_token: "old-r",
      grant_type: "refresh_token",
    });
  });
});

describe("tiktokProvider.listAccounts", () => {
  it("liste les annonceurs puis complète devise, fuseau et statut", async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        match: "/oauth2/advertiser/get/",
        reply: () => ({
          code: 0,
          data: {
            list: [
              { advertiser_id: 111, advertiser_name: "Casino FR" },
              { advertiser_id: "222", advertiser_name: "Dating" },
            ],
          },
        }),
      },
      {
        match: "/advertiser/info/",
        reply: () => ({
          code: 0,
          data: {
            list: [
              {
                advertiser_id: "111",
                name: "Casino FR",
                currency: "eur",
                timezone: "Europe/Paris",
                status: "STATUS_ENABLE",
                company: "LinkAffi SAS",
              },
              {
                advertiser_id: "222",
                currency: "USD",
                timezone: "America/New_York",
                status: "STATUS_DISABLE",
              },
            ],
          },
        }),
      },
    ]);
    const accounts = await tiktokProvider.listAccounts(app, tokens, opts(fetchImpl));
    expect(accounts).toEqual([
      {
        externalId: "111",
        name: "Casino FR",
        currency: "EUR",
        timezone: "Europe/Paris",
        businessName: "LinkAffi SAS",
        statusLabel: "Actif",
        active: true,
      },
      {
        externalId: "222",
        name: "Dating",
        currency: "USD",
        timezone: "America/New_York",
        businessName: null,
        statusLabel: "Désactivé",
        active: false,
      },
    ]);
    const first = calls[0]!;
    expect(first.url.pathname).toBe("/open_api/v1.3/oauth2/advertiser/get/");
    expect(first.url.searchParams.get("app_id")).toBe(app.clientId);
    expect(first.url.searchParams.get("secret")).toBe("s3cret");
    expect((first.init.headers as Record<string, string>)["Access-Token"]).toBe("tok-123");
    const second = calls[1]!;
    expect(second.url.pathname).toBe("/open_api/v1.3/advertiser/info/");
    expect(JSON.parse(second.url.searchParams.get("advertiser_ids")!)).toEqual(["111", "222"]);
  });

  it("garde USD et « devise à vérifier » si advertiser/info échoue (hors jeton refusé)", async () => {
    const { fetchImpl } = fakeFetch([
      {
        match: "/oauth2/advertiser/get/",
        reply: () => ({ code: 0, data: { list: [{ advertiser_id: 111, advertiser_name: "A" }] } }),
      },
      { match: "/advertiser/info/", reply: () => ({ code: 40002, message: "no permission" }) },
    ]);
    const accounts = await tiktokProvider.listAccounts(app, tokens, opts(fetchImpl));
    expect(accounts).toEqual([
      {
        externalId: "111",
        name: "A",
        currency: "USD",
        timezone: null,
        businessName: null,
        statusLabel: "devise à vérifier",
        active: true,
      },
    ]);
  });

  it("remonte une erreur auth si le jeton est refusé", async () => {
    const { fetchImpl } = fakeFetch([
      {
        match: "/oauth2/advertiser/get/",
        reply: () => ({ code: 40105, message: "Access token is incorrect or has been revoked" }),
      },
    ]);
    await expect(tiktokProvider.listAccounts(app, tokens, opts(fetchImpl))).rejects.toBeInstanceOf(
      ConnectorError,
    );
    await expect(tiktokProvider.listAccounts(app, tokens, opts(fetchImpl))).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("listAccountsByIds (bac à sable) interroge advertiser/info sur le domaine sandbox", async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        match: "/advertiser/info/",
        reply: () => ({
          code: 0,
          data: {
            list: [
              {
                advertiser_id: "999",
                name: "Sandbox",
                currency: "USD",
                timezone: "UTC",
                status: "STATUS_ENABLE",
              },
            ],
          },
        }),
      },
    ]);
    const accounts = await listAccountsByIds(
      { ...app, extra: { sandbox: true } },
      tokens,
      [" 999 ", "999"],
      opts(fetchImpl),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      externalId: "999",
      name: "Sandbox",
      currency: "USD",
      active: true,
    });
    expect(calls[0]!.url.origin).toBe(TIKTOK_SANDBOX_BASE);
  });
});

describe("tiktokProvider.fetchDailyInsights", () => {
  const row = (ad: string, day: string, spend: string) => ({
    dimensions: { ad_id: ad, stat_time_day: `${day} 00:00:00` },
    metrics: {
      spend,
      impressions: "1200",
      clicks: "35",
      reach: "1000",
      conversion: "2",
      campaign_id: "c1",
      campaign_name: "Camp 1",
      adgroup_id: "g1",
      adgroup_name: "Groupe 1",
      ad_name: `Pub ${ad}`,
      currency: "EUR",
    },
  });

  it("pagine et convertit les chaînes en nombres", async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        match: "/report/integrated/get/",
        reply: (call) => {
          const page = Number(call.url.searchParams.get("page"));
          return {
            code: 0,
            data: {
              list:
                page === 1
                  ? [row("a1", "2026-10-01", "12.34"), row("a2", "2026-10-01", "0")]
                  : [row("a1", "2026-10-02", "5.5")],
              page_info: { page, page_size: 1000, total_number: 3, total_page: 2 },
            },
          };
        },
      },
    ]);
    const rows = await tiktokProvider.fetchDailyInsights(
      app,
      tokens,
      { externalId: "111", currency: "EUR" },
      { from: "2026-10-01", to: "2026-10-02" },
      opts(fetchImpl),
    );
    expect(calls).toHaveLength(2);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      date: "2026-10-01",
      campaignExternalId: "c1",
      campaignName: "Camp 1",
      adSetExternalId: "g1",
      adSetName: "Groupe 1",
      adExternalId: "a1",
      adName: "Pub a1",
      spend: 12.34,
      currency: "EUR",
      impressions: 1200,
      clicks: 35,
      reach: 1000,
      results: 2,
    });
    expect(rows[2]!.date).toBe("2026-10-02");
    const q = calls[0]!.url.searchParams;
    expect(calls[0]!.url.pathname).toBe("/open_api/v1.3/report/integrated/get/");
    expect(q.get("advertiser_id")).toBe("111");
    expect(q.get("service_type")).toBe("AUCTION");
    expect(q.get("report_type")).toBe("BASIC");
    expect(q.get("data_level")).toBe("AUCTION_AD");
    expect(JSON.parse(q.get("dimensions")!)).toEqual(["ad_id", "stat_time_day"]);
    expect(JSON.parse(q.get("metrics")!)).toContain("spend");
    expect(q.get("start_date")).toBe("2026-10-01");
    expect(q.get("end_date")).toBe("2026-10-02");
    expect(q.get("page_size")).toBe("1000");
    expect(calls[1]!.url.searchParams.get("page")).toBe("2");
    expect((calls[0]!.init.headers as Record<string, string>)["Access-Token"]).toBe("tok-123");
  });

  it("utilise le domaine sandbox quand extra.sandbox est vrai", async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        match: "/report/integrated/get/",
        reply: () => ({ code: 0, data: { list: [], page_info: { page: 1, total_page: 1 } } }),
      },
    ]);
    await tiktokProvider.fetchDailyInsights(
      { ...app, extra: { sandbox: true } },
      tokens,
      { externalId: "1", currency: "USD" },
      { from: "2026-10-01", to: "2026-10-01" },
      opts(fetchImpl),
    );
    expect(calls[0]!.url.origin).toBe(TIKTOK_SANDBOX_BASE);
  });

  it("opts.sandbox prime sur extra.sandbox", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { match: "/report/integrated/get/", reply: () => ({ code: 0, data: { list: [] } }) },
    ]);
    await tiktokProvider.fetchDailyInsights(
      { ...app, extra: { sandbox: true } },
      tokens,
      { externalId: "1", currency: "USD" },
      { from: "2026-10-01", to: "2026-10-01" },
      opts(fetchImpl, { sandbox: false }),
    );
    expect(calls[0]!.url.origin).toBe(TIKTOK_API_BASE);
  });

  it("classe les limites de requêtes (code 40100 too many requests, 50002, HTTP 429)", async () => {
    const range = { from: "2026-10-01", to: "2026-10-01" };
    const acc = { externalId: "1", currency: "USD" };
    const a = fakeFetch([
      {
        match: "/report/",
        reply: () => ({
          code: 40100,
          message: "Too many requests. Please retry in a few seconds.",
        }),
      },
    ]);
    await expect(
      tiktokProvider.fetchDailyInsights(app, tokens, acc, range, opts(a.fetchImpl)),
    ).rejects.toMatchObject({ kind: "rate_limit", retryAfterSec: 60 });
    const b = fakeFetch([
      { match: "/report/", reply: () => ({ code: 50002, message: "Service busy" }) },
    ]);
    await expect(
      tiktokProvider.fetchDailyInsights(app, tokens, acc, range, opts(b.fetchImpl)),
    ).rejects.toMatchObject({ kind: "rate_limit" });
    const c = fakeFetch([{ match: "/report/", status: 429, reply: () => "slow down" }]);
    await expect(
      tiktokProvider.fetchDailyInsights(app, tokens, acc, range, opts(c.fetchImpl)),
    ).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("classe un réseau en panne en network et un message inattendu en other", async () => {
    const range = { from: "2026-10-01", to: "2026-10-01" };
    const acc = { externalId: "1", currency: "USD" };
    const down = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(
      tiktokProvider.fetchDailyInsights(app, tokens, acc, range, opts(down)),
    ).rejects.toMatchObject({ kind: "network" });
    const o = fakeFetch([
      { match: "/report/", reply: () => ({ code: 40000, message: "Param error: start_date" }) },
    ]);
    await expect(
      tiktokProvider.fetchDailyInsights(app, tokens, acc, range, opts(o.fetchImpl)),
    ).rejects.toMatchObject({ kind: "other", message: expect.stringContaining("start_date") });
  });
});

describe("tiktokProvider.verifyApp", () => {
  it("refuse un App ID non numérique sans appeler TikTok", async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    const r = await tiktokProvider.verifyApp({ clientId: "abc", secret: "x" }, opts(fetchImpl));
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("accepte quand TikTok réclame seulement un jeton", async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        match: "/oauth2/advertiser/get/",
        reply: () => ({ code: 40105, message: "Access token is incorrect or has been revoked" }),
      },
    ]);
    const r = await tiktokProvider.verifyApp(app, opts(fetchImpl));
    expect(r.ok).toBe(true);
    expect((calls[0]!.init.headers as Record<string, string>)["Access-Token"]).toBeUndefined();
    expect(calls[0]!.url.searchParams.get("app_id")).toBe(app.clientId);
  });

  it("refuse quand TikTok mentionne l'app dans son message", async () => {
    const { fetchImpl } = fakeFetch([
      {
        match: "/oauth2/advertiser/get/",
        reply: () => ({ code: 40001, message: "app_id is invalid" }),
      },
    ]);
    const r = await tiktokProvider.verifyApp(app, opts(fetchImpl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("app_id is invalid");
  });

  it("utilise le domaine sandbox en mode bac à sable", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { match: "/oauth2/advertiser/get/", reply: () => ({ code: 40105, message: "token" }) },
    ]);
    await tiktokProvider.verifyApp({ ...app, extra: { sandbox: true } }, opts(fetchImpl));
    expect(calls[0]!.url.origin).toBe(TIKTOK_SANDBOX_BASE);
  });
});

describe("tiktok errors / report helpers", () => {
  it("classe les codes", () => {
    expect(tiktokError(40105, "x").kind).toBe("auth");
    expect(tiktokError(40001, "x").kind).toBe("auth");
    expect(tiktokError(40199, "x").kind).toBe("auth");
    expect(tiktokError(40100, "Too many requests").kind).toBe("rate_limit");
    expect(tiktokError(40100, "Unauthenticated").kind).toBe("auth");
    expect(tiktokError(40002, "x").kind).toBe("permission");
    expect(tiktokError(40104, "x").kind).toBe("permission");
    expect(tiktokError(40112, "x").kind).toBe("permission");
    expect(tiktokError(50002, "x").kind).toBe("rate_limit");
    expect(tiktokError(40000, "x", "rq").message).toContain("rq");
  });

  it("statDay tronque la date", () => {
    expect(statDay("2026-10-01 00:00:00")).toBe("2026-10-01");
    expect(statDay("2026-10-01T00:00:00Z")).toBe("2026-10-01");
    expect(statDay("")).toBe("");
    expect(statDay(undefined)).toBe("");
  });

  it("mapReportRow ignore les lignes sans date ou sans pub et prend la devise du compte en repli", () => {
    expect(mapReportRow({ dimensions: { ad_id: "a" }, metrics: {} }, "EUR")).toBeNull();
    expect(
      mapReportRow({ dimensions: { stat_time_day: "2026-10-01 00:00:00" }, metrics: {} }, "EUR"),
    ).toBeNull();
    const r = mapReportRow(
      {
        dimensions: { ad_id: 5, stat_time_day: "2026-10-01 00:00:00" },
        metrics: { spend: "1,5", impressions: "x", campaign_id: "c" },
      },
      "eur",
    );
    expect(r).toMatchObject({
      adExternalId: "5",
      spend: 1.5,
      impressions: 0,
      currency: "EUR",
      reach: null,
      results: null,
      campaignExternalId: "c",
    });
  });

  it("hasNextPage", () => {
    expect(hasNextPage({ page_info: { total_page: 3 } }, 1)).toBe(true);
    expect(hasNextPage({ page_info: { total_page: 3 } }, 3)).toBe(false);
    expect(hasNextPage({ list: [] }, 1)).toBe(false);
    expect(hasNextPage(undefined, 1)).toBe(false);
  });
});
