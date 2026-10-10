import { describe, expect, it } from "vitest";
import { ConnectorError } from "../errors";
import { META_GRAPH_URL, mapAccount, metaProvider } from "./index";
import { metaErrorFromResponse, retryAfterFromHeaders, scrub } from "./errors";
import { mapInsightRow, sumResults } from "./insights";

const app = { clientId: "123456", secret: "s3cret" };
const redirect = "https://app.linkaffipro.com/api/connectors/meta/callback";
const now = new Date("2026-10-10T10:00:00Z");

type Call = { url: URL; init?: RequestInit };

/** Faux `fetch` : une réponse par appel (dans l'ordre), mémorise les appels. */
function fakeFetch(
  responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> } | Error>,
) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      ),
      init,
    });
    const next = responses.shift();
    if (!next) throw new Error("réponse simulée manquante");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json", ...(next.headers ?? {}) },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("Meta : URL de connexion", () => {
  it("demande les permissions ads_read et business_management", () => {
    const url = new URL(metaProvider.authorizeUrl(app, redirect, "etat-signe"));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("123456");
    expect(url.searchParams.get("redirect_uri")).toBe(redirect);
    expect(url.searchParams.get("state")).toBe("etat-signe");
    expect(url.searchParams.get("scope")).toBe("ads_read,business_management");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.has("config_id")).toBe(false);
  });
  it("passe config_id à la place de scope quand l'app est en « Facebook Login for Business »", () => {
    const url = new URL(
      metaProvider.authorizeUrl({ ...app, extra: { configId: " 987 " } }, redirect, "x"),
    );
    expect(url.searchParams.get("config_id")).toBe("987");
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("Meta : vérification de l'app", () => {
  it("accepte quand Meta renvoie un jeton d'application", async () => {
    const f = fakeFetch([{ body: { access_token: "123456|abc", token_type: "bearer" } }]);
    const r = await metaProvider.verifyApp(app, { fetchImpl: f.impl });
    expect(r.ok).toBe(true);
    const u = f.calls[0]!.url;
    expect(u.toString().startsWith(`${META_GRAPH_URL}/oauth/access_token`)).toBe(true);
    expect(u.searchParams.get("grant_type")).toBe("client_credentials");
    expect(u.searchParams.get("client_secret")).toBe("s3cret");
  });
  it("refuse avec un message lisible sur un code 101", async () => {
    const f = fakeFetch([
      {
        status: 400,
        body: {
          error: {
            message:
              "Error validating application. Cannot get application info due to a system error.",
            type: "OAuthException",
            code: 101,
          },
        },
      },
    ]);
    const r = await metaProvider.verifyApp(app, { fetchImpl: f.impl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/refusés par Meta/);
  });
  it("signale une plateforme injoignable sans lever", async () => {
    const f = fakeFetch([new Error("ECONNRESET")]);
    const r = await metaProvider.verifyApp(app, { fetchImpl: f.impl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/injoignable/);
  });
});

describe("Meta : échange du code et jeton longue durée", () => {
  it("échange le code puis obtient un jeton de 60 jours", async () => {
    const f = fakeFetch([
      { body: { access_token: "EAAshort", token_type: "bearer", expires_in: 5000 } },
      { body: { access_token: "EAAlong", token_type: "bearer", expires_in: 5184000 } },
    ]);
    const t = await metaProvider.exchangeCode(app, "le-code", redirect, { fetchImpl: f.impl, now });
    expect(t.accessToken).toBe("EAAlong");
    expect(t.refreshToken).toBeNull();
    expect(t.expiresAt?.toISOString()).toBe("2026-12-09T10:00:00.000Z");
    expect(t.scopes).toBe("ads_read,business_management");
    const first = f.calls[0]!.url;
    expect(first.searchParams.get("code")).toBe("le-code");
    expect(first.searchParams.get("redirect_uri")).toBe(redirect);
    const second = f.calls[1]!.url;
    expect(second.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(second.searchParams.get("fb_exchange_token")).toBe("EAAshort");
  });
  it("lève une erreur `auth` si le code est refusé (190)", async () => {
    const f = fakeFetch([
      { status: 400, body: { error: { message: "Invalid verification code format.", code: 100 } } },
    ]);
    await expect(
      metaProvider.exchangeCode(app, "bad", redirect, { fetchImpl: f.impl }),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
  it("renouvelle un jeton encore valide et renvoie null s'il est expiré ou refusé", async () => {
    const valid = { accessToken: "EAAlong", expiresAt: new Date("2026-10-20T00:00:00Z") };
    const f = fakeFetch([{ body: { access_token: "EAAlong2", expires_in: 5184000 } }]);
    const r = await metaProvider.refresh(app, valid, { fetchImpl: f.impl, now });
    expect(r?.accessToken).toBe("EAAlong2");
    expect(r?.expiresAt?.toISOString()).toBe("2026-12-09T10:00:00.000Z");
    expect(f.calls[0]!.url.searchParams.get("fb_exchange_token")).toBe("EAAlong");

    const expired = { accessToken: "EAAold", expiresAt: new Date("2026-10-01T00:00:00Z") };
    const g = fakeFetch([]);
    expect(await metaProvider.refresh(app, expired, { fetchImpl: g.impl, now })).toBeNull();
    expect(g.calls).toHaveLength(0);

    const h = fakeFetch([
      {
        status: 400,
        body: {
          error: {
            message: "Error validating access token: Session has expired",
            code: 190,
            error_subcode: 463,
          },
        },
      },
    ]);
    expect(await metaProvider.refresh(app, valid, { fetchImpl: h.impl, now })).toBeNull();
  });
});

describe("Meta : comptes publicitaires", () => {
  it("pagine, lit le statut, le Business Manager et préfixe act_", async () => {
    const f = fakeFetch([
      {
        body: {
          data: [
            {
              id: "act_111",
              account_id: "111",
              name: "Casino FR",
              currency: "EUR",
              timezone_name: "Europe/Paris",
              account_status: 1,
              business: { id: "b1", name: "BM Principal" },
            },
            {
              id: "act_222",
              account_id: "222",
              name: "Ancien",
              currency: "USD",
              timezone_name: "America/New_York",
              account_status: 101,
            },
          ],
          paging: { next: `${META_GRAPH_URL}/me/adaccounts?after=abc&access_token=EAAlong` },
        },
      },
      {
        body: {
          data: [
            {
              id: "act_333",
              account_id: "333",
              name: "Dating",
              currency: "EUR",
              account_status: 2,
            },
          ],
        },
      },
    ]);
    const accounts = await metaProvider.listAccounts(
      app,
      { accessToken: "EAAlong" },
      { fetchImpl: f.impl },
    );
    expect(accounts.map((a) => a.externalId)).toEqual(["act_111", "act_222", "act_333"]);
    expect(accounts[0]).toMatchObject({
      name: "Casino FR",
      currency: "EUR",
      timezone: "Europe/Paris",
      businessName: "BM Principal",
      statusLabel: "Actif",
      active: true,
    });
    expect(accounts.find((a) => a.externalId === "act_222")).toMatchObject({
      statusLabel: "Fermé",
      active: false,
      businessName: null,
    });
    expect(accounts.find((a) => a.externalId === "act_333")).toMatchObject({
      statusLabel: "Désactivé",
      active: false,
    });
    // Le jeton part dans l'en-tête Authorization, pas dans l'URL construite par nous.
    const first = f.calls[0]!;
    expect(first.url.searchParams.has("access_token")).toBe(false);
    expect((first.init?.headers as Record<string, string>).Authorization).toBe("Bearer EAAlong");
    expect(first.url.searchParams.get("fields")).toContain("business{id,name}");
    expect(f.calls[1]!.url.searchParams.get("after")).toBe("abc");
  });
  it("tolère un compte sans account_id explicite", () => {
    expect(mapAccount({ id: "act_42", name: "X", currency: "eur" })).toMatchObject({
      externalId: "act_42",
      currency: "EUR",
      statusLabel: null,
      active: false,
    });
    expect(mapAccount({ name: "sans id" })).toBeNull();
  });
});

describe("Meta : rapport journalier", () => {
  it("demande le niveau pub par jour, pagine et normalise les lignes", async () => {
    const f = fakeFetch([
      {
        body: {
          data: [
            {
              campaign_id: "c1",
              campaign_name: "Casino - Pub A",
              adset_id: "s1",
              adset_name: "Groupe 1",
              ad_id: "a1",
              ad_name: "Pub A",
              spend: "12.34",
              impressions: "1000",
              clicks: "50",
              reach: "800",
              actions: [
                { action_type: "link_click", value: "40" },
                { action_type: "lead", value: "3" },
                { action_type: "purchase", value: "1" },
              ],
              account_currency: "EUR",
              date_start: "2026-10-01",
              date_stop: "2026-10-01",
            },
          ],
          paging: { next: `${META_GRAPH_URL}/act_111/insights?after=xyz` },
        },
      },
      {
        body: {
          data: [
            {
              campaign_id: "c1",
              campaign_name: "Casino - Pub A",
              ad_id: "a1",
              ad_name: "Pub A",
              spend: "0",
              impressions: "10",
              clicks: "0",
              date_start: "2026-10-02",
              date_stop: "2026-10-02",
            },
            { date_start: "2026-10-02" },
          ],
        },
      },
    ]);
    const rows = await metaProvider.fetchDailyInsights(
      app,
      { accessToken: "EAAlong" },
      { externalId: "act_111", currency: "USD" },
      { from: "2026-10-01", to: "2026-10-02" },
      { fetchImpl: f.impl },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      date: "2026-10-01",
      campaignExternalId: "c1",
      campaignName: "Casino - Pub A",
      adSetExternalId: "s1",
      adSetName: "Groupe 1",
      adExternalId: "a1",
      adName: "Pub A",
      spend: 12.34,
      currency: "EUR",
      impressions: 1000,
      clicks: 50,
      reach: 800,
      results: 4,
    });
    expect(rows[1]).toMatchObject({
      date: "2026-10-02",
      currency: "USD",
      adSetExternalId: null,
      reach: null,
      results: null,
    });
    const u = f.calls[0]!.url;
    expect(u.pathname).toBe("/v25.0/act_111/insights");
    expect(u.searchParams.get("level")).toBe("ad");
    expect(u.searchParams.get("time_increment")).toBe("1");
    expect(u.searchParams.get("limit")).toBe("500");
    expect(JSON.parse(u.searchParams.get("time_range")!)).toEqual({
      since: "2026-10-01",
      until: "2026-10-02",
    });
    expect(u.searchParams.get("fields")).toContain("date_start");
  });
  it("accepte un identifiant de compte sans préfixe", async () => {
    const f = fakeFetch([{ body: { data: [] } }]);
    await metaProvider.fetchDailyInsights(
      app,
      { accessToken: "t" },
      { externalId: "999", currency: "EUR" },
      { from: "2026-10-01", to: "2026-10-01" },
      { fetchImpl: f.impl },
    );
    expect(f.calls[0]!.url.pathname).toBe("/v25.0/act_999/insights");
  });
  it("compte les résultats seulement si une action de conversion est présente", () => {
    expect(sumResults(undefined)).toBeNull();
    expect(sumResults([{ action_type: "link_click", value: "5" }])).toBeNull();
    expect(
      sumResults([
        { action_type: "complete_registration", value: "2" },
        { action_type: "omni_purchase", value: 3 },
      ]),
    ).toBe(5);
    expect(
      mapInsightRow({ campaign_id: "c", date_start: "2026-01-01T00:00" }, "eur"),
    ).toMatchObject({ date: "2026-01-01", campaignName: "Campagne c", currency: "EUR", spend: 0 });
  });
});

describe("Meta : classification des erreurs", () => {
  it("190 → auth, 10 / 2xx → permission, 4 → rate_limit avec l'en-tête d'usage", () => {
    const auth = metaErrorFromResponse(400, {
      error: { message: "Error validating access token", code: 190, error_subcode: 460 },
    });
    expect(auth.kind).toBe("auth");
    expect(auth.platformCode).toBe("190");
    expect(
      metaErrorFromResponse(403, { error: { message: "Permission denied", code: 10 } }).kind,
    ).toBe("permission");
    expect(
      metaErrorFromResponse(400, { error: { message: "Requires ads_read", code: 200 } }).kind,
    ).toBe("permission");
    const headers = new Headers({
      "x-business-use-case-usage": JSON.stringify({
        "123": [
          {
            type: "ads_insights",
            call_count: 100,
            total_cputime: 100,
            total_time: 100,
            estimated_time_to_regain_access: 12,
          },
        ],
      }),
    });
    const rl = metaErrorFromResponse(
      400,
      { error: { message: "Application request limit reached", code: 4 } },
      headers,
    );
    expect(rl.kind).toBe("rate_limit");
    expect(rl.retryAfterSec).toBe(12 * 60);
    expect(
      metaErrorFromResponse(400, { error: { message: "User request limit reached", code: 17 } })
        .retryAfterSec,
    ).toBe(15 * 60);
    expect(
      metaErrorFromResponse(400, { error: { message: "Ad account limit", code: 80004 } }).kind,
    ).toBe("rate_limit");
  });
  it("lit aussi X-Ad-Account-Usage et Retry-After, et classe HTTP 429 / 5xx", () => {
    expect(
      retryAfterFromHeaders(
        new Headers({
          "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 100, reset_time_duration: 300 }),
        }),
      ),
    ).toBe(300);
    expect(retryAfterFromHeaders(new Headers({ "retry-after": "42" }))).toBe(42);
    expect(
      retryAfterFromHeaders(new Headers({ "x-business-use-case-usage": "pas du json" })),
    ).toBeNull();
    expect(metaErrorFromResponse(429, null).kind).toBe("rate_limit");
    expect(metaErrorFromResponse(503, null).kind).toBe("network");
    expect(
      metaErrorFromResponse(400, { error: { message: "Unsupported get request", code: 100 } }).kind,
    ).toBe("other");
  });
  it("ne laisse jamais passer un jeton dans les messages", () => {
    expect(
      scrub("fetch failed for https://x/?access_token=EAAabcdefghijklmnopqrstuvwxyz0123&x=1"),
    ).toBe("fetch failed for https://x/?access_token=***&x=1");
    expect(scrub("token EAAabcdefghijklmnopqrstuvwxyz0123456 refusé")).toBe("token *** refusé");
  });
  it("propage une erreur réseau pendant un rapport comme `network`", async () => {
    const f = fakeFetch([new Error("getaddrinfo ENOTFOUND graph.facebook.com")]);
    await expect(
      metaProvider.listAccounts(app, { accessToken: "t" }, { fetchImpl: f.impl }),
    ).rejects.toMatchObject({ kind: "network" });
  });
});
