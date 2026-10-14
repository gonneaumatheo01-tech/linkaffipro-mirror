/**
 * Phase 13 : appel signé de la fonction Link Affi `telegram-events` (en-têtes du contrat, signature vérifiable, réponse
 * lisible, jamais de clé ni de secret dans l'erreur enregistrée) et lecture des réglages (secret chiffré, clé anon).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: { integrationKey: { findUnique: vi.fn() } },
  recordEvent: vi.fn(),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("@linkaffipro/db", () => db);

import { encrypt, LINKAFFI_EVENTS_URL_DEFAULT, verifyLinkaffiSignature } from "@linkaffipro/core";
import {
  loadLinkaffiDeliveryConfig,
  NOT_CONFIGURED_MESSAGES,
  postLinkaffiEvent,
  type FetchLike,
} from "./delivery";

process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const CONFIG = {
  url: "https://example.test/functions/v1/telegram-events",
  secret: "lap_whsec_secret",
  anonKey: "anon-jwt",
};
const RAW = '{"eventId":"lap_joined_ms1","type":"joined"}';

function fakeFetch(status: number, text = "") {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { f, calls };
}

describe("appel de la fonction telegram-events", () => {
  it("POST du corps brut avec les en-têtes du contrat et une signature vérifiable", async () => {
    const { f, calls } = fakeFetch(200);
    expect(await postLinkaffiEvent(CONFIG, RAW, "lap_joined_ms1", f)).toEqual({
      ok: true,
      status: 200,
      error: null,
    });
    const { url, init } = calls[0]!;
    expect(url).toBe(CONFIG.url);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(RAW);
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      apikey: "anon-jwt",
      Authorization: "Bearer anon-jwt",
      "X-Event-Id": "lap_joined_ms1",
    });
    expect(verifyLinkaffiSignature(RAW, CONFIG.secret, init.headers["X-Signature"])).toBe(true);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("refus de Link Affi : statut et début de la réponse, sans clé ni secret", async () => {
    const { f } = fakeFetch(401, `{"error":"signature invalide"}`);
    const r = await postLinkaffiEvent(CONFIG, RAW, "lap_joined_ms1", f);
    expect(r).toEqual({
      ok: false,
      status: 401,
      error: 'Réponse 401 de Link Affi : {"error":"signature invalide"}',
    });
    expect(r.error).not.toContain(CONFIG.secret);
    expect(r.error).not.toContain(CONFIG.anonKey);
  });

  it("Link Affi injoignable ou trop lent : statut inconnu, raison lisible", async () => {
    const down: FetchLike = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    };
    expect(await postLinkaffiEvent(CONFIG, RAW, "e", down)).toEqual({
      ok: false,
      status: null,
      error: "Link Affi injoignable : ECONNREFUSED",
    });
    const slow: FetchLike = async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    expect((await postLinkaffiEvent(CONFIG, RAW, "e", slow)).error).toBe(
      "Link Affi injoignable : pas de réponse en 10 s",
    );
  });

  it("réponse très longue : coupée", async () => {
    const { f } = fakeFetch(500, "x".repeat(5000));
    const r = await postLinkaffiEvent(CONFIG, RAW, "e", f);
    expect(r.error!.length).toBeLessThanOrEqual(201);
  });
});

describe("réglages d'envoi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("secret déchiffré, adresse par défaut, clé anon du service", async () => {
    db.prisma.integrationKey.findUnique.mockResolvedValue({
      webhookSecretEncrypted: encrypt("lap_whsec_abc"),
      eventsUrl: null,
    });
    expect(await loadLinkaffiDeliveryConfig({ LINKAFFI_ANON_KEY: " anon " })).toEqual({
      ok: true,
      config: { url: LINKAFFI_EVENTS_URL_DEFAULT, secret: "lap_whsec_abc", anonKey: "anon" },
    });
  });

  it("adresse modifiée dans la plateforme : celle-ci", async () => {
    db.prisma.integrationKey.findUnique.mockResolvedValue({
      webhookSecretEncrypted: encrypt("s"),
      eventsUrl: "https://autre.test/telegram-events",
    });
    const r = await loadLinkaffiDeliveryConfig({ LINKAFFI_ANON_KEY: "a" });
    expect(r.ok && r.config.url).toBe("https://autre.test/telegram-events");
  });

  it("sans secret, sans clé anon, ou secret illisible : rien n'est envoyé, raison lisible", async () => {
    db.prisma.integrationKey.findUnique.mockResolvedValue(null);
    expect(await loadLinkaffiDeliveryConfig({ LINKAFFI_ANON_KEY: "a" })).toEqual({
      ok: false,
      reason: "no_secret",
      message: NOT_CONFIGURED_MESSAGES.no_secret,
    });
    db.prisma.integrationKey.findUnique.mockResolvedValue({
      webhookSecretEncrypted: encrypt("s"),
      eventsUrl: null,
    });
    expect(await loadLinkaffiDeliveryConfig({})).toMatchObject({
      ok: false,
      reason: "no_anon_key",
    });
    db.prisma.integrationKey.findUnique.mockResolvedValue({
      webhookSecretEncrypted: "abîmé",
      eventsUrl: null,
    });
    expect(await loadLinkaffiDeliveryConfig({ LINKAFFI_ANON_KEY: "a" })).toMatchObject({
      ok: false,
      reason: "secret_unreadable",
    });
  });
});
