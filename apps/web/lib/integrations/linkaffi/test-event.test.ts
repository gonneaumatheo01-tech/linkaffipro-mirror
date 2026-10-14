import { describe, expect, it, vi } from "vitest";
import { verifyLinkaffiSignature } from "@linkaffipro/core";
import {
  buildLinkaffiTestEvent,
  describeLinkaffiTestResponse,
  linkaffiEventHeaders,
  responseSnippet,
  sendLinkaffiTestEvent,
} from "./test-event";

/** « Envoyer un événement de test » : corps, en-têtes signés, résultat lisible. */
describe("événement de test", () => {
  const now = new Date("2026-10-14T10:00:00.000Z");

  it("a la forme du contrat avec type « test » et aucun vrai membre", () => {
    const body = buildLinkaffiTestEvent(now, "abcd1234");
    expect(body).toEqual({
      eventId: `lap_test_${now.getTime()}_abcd1234`,
      type: "test",
      occurredAt: "2026-10-14T10:00:00.000Z",
      campaignKey: "test",
      channel: { id: "test", title: "Test LinkAffi Pro" },
      member: { telegramUserId: "0", username: null, firstName: "Test", languageCode: "fr" },
      data: { test: true, message: expect.stringMatching(/test/) },
    });
    expect(Object.keys(body)).toEqual([
      "eventId",
      "type",
      "occurredAt",
      "campaignKey",
      "channel",
      "member",
      "data",
    ]);
    expect(buildLinkaffiTestEvent(now).eventId).not.toBe(buildLinkaffiTestEvent(now).eventId);
  });

  it("en-têtes : clé anon en apikey et Bearer, identifiant, signature du corps brut", () => {
    const raw = JSON.stringify(buildLinkaffiTestEvent(now, "x"));
    const h = linkaffiEventHeaders(raw, "lap_test_1", "lap_whsec_secret", "anon-jwt");
    expect(h).toMatchObject({
      "Content-Type": "application/json",
      apikey: "anon-jwt",
      Authorization: "Bearer anon-jwt",
      "X-Event-Id": "lap_test_1",
    });
    expect(verifyLinkaffiSignature(raw, "lap_whsec_secret", h["X-Signature"])).toBe(true);
    expect(verifyLinkaffiSignature(raw, "autre", h["X-Signature"])).toBe(false);
  });

  it("résultat lisible : reçu / signature refusée / refusé / injoignable", () => {
    expect(describeLinkaffiTestResponse({ status: 200, durationMs: 80 })).toMatchObject({
      outcome: "received",
      message: expect.stringMatching(/^Link Affi a accepté l'événement de test .*200 en 80 ms/),
    });
    for (const status of [401, 403])
      expect(describeLinkaffiTestResponse({ status, durationMs: 1 })).toMatchObject({
        outcome: "signature_refused",
        message: expect.stringMatching(/LINKAFFIPRO_WEBHOOK_SECRET/),
      });
    expect(
      describeLinkaffiTestResponse({ status: 400, durationMs: 1, snippet: "type inconnu" }),
    ).toMatchObject({ outcome: "rejected", message: expect.stringMatching(/« type inconnu »/) });
    for (const status of [404, 500, 502, 503])
      expect(describeLinkaffiTestResponse({ status, durationMs: 1 }).outcome).toBe("unreachable");
    expect(
      describeLinkaffiTestResponse({ status: null, durationMs: 1, error: "ECONNREFUSED" }),
    ).toMatchObject({ outcome: "unreachable", message: expect.stringMatching(/ECONNREFUSED/) });
  });

  it("réponse de Link Affi coupée à une ligne de 160 caractères", () => {
    expect(responseSnippet("  a\n  b ")).toBe("a b");
    expect(responseSnippet("x".repeat(500))).toHaveLength(160);
  });

  it("envoie un POST signé à l'adresse, ne lève jamais (réseau en panne, délai dépassé)", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init!.headers as Record<string, string>;
      const ok = verifyLinkaffiSignature(String(init!.body), "s3cret", headers["X-Signature"]);
      return new Response(ok ? '{"ok":true}' : "bad", { status: ok ? 200 : 401 });
    });
    const r = await sendLinkaffiTestEvent({
      url: "https://linkaffi.example/functions/v1/telegram-events",
      secret: "s3cret",
      anonKey: "anon",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
    expect(r).toMatchObject({ outcome: "received", status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://linkaffi.example/functions/v1/telegram-events");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body)).eventId).toBe(r.eventId);

    const down = await sendLinkaffiTestEvent({
      url: "https://x.example",
      secret: "s",
      anonKey: "a",
      fetchImpl: (async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
      }) as unknown as typeof fetch,
    });
    expect(down).toMatchObject({ outcome: "unreachable", status: null });
    expect(down.message).toMatch(/ENOTFOUND/);

    const slow = await sendLinkaffiTestEvent({
      url: "https://x.example",
      secret: "s",
      anonKey: "a",
      timeoutMs: 20,
      fetchImpl: ((_u: unknown, init?: RequestInit) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
          ),
        )) as unknown as typeof fetch,
    });
    expect(slow).toMatchObject({ outcome: "unreachable" });
    expect(slow.message).toMatch(/pas de réponse en 0 secondes|pas de réponse en/);
  });
});
