import { describe, expect, it, vi } from "vitest";
import { generateIntegrationApiKey, hashIntegrationApiKey } from "@linkaffipro/core";
import { authenticateLinkaffi, bearerToken, unauthorizedMessage } from "./auth";

/** Authentification de Link Affi par l'empreinte de la clé (jamais la clé elle-même en base). */
describe("clé de connexion de Link Affi", () => {
  const key = generateIntegrationApiKey();
  const stored = { provider: "linkaffi", apiKeyHash: hashIntegrationApiKey(key) };

  it("lit « Authorization: Bearer <clé> » (casse de Bearer indifférente, espaces tolérés)", () => {
    expect(bearerToken(`Bearer ${key}`)).toBe(key);
    expect(bearerToken(`bearer   ${key}  `)).toBe(key);
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken(key)).toBeNull();
    expect(bearerToken(`Basic ${key}`)).toBeNull();
    expect(bearerToken(`Bearer ${"x".repeat(300)}`)).toBeNull();
  });

  it("accepte la bonne clé en cherchant son empreinte, jamais la clé", async () => {
    const lookup = vi.fn(async (hash: string) => (hash === stored.apiKeyHash ? stored : null));
    expect(await authenticateLinkaffi(`Bearer ${key}`, lookup)).toEqual({
      ok: true,
      keyHash: stored.apiKeyHash,
    });
    expect(lookup).toHaveBeenCalledWith(stored.apiKeyHash);
    expect(lookup.mock.calls.flat()).not.toContain(key);
  });

  it("refuse une clé absente, fausse, ancienne (régénérée) ou d'un autre fournisseur", async () => {
    const lookup = async (hash: string) => (hash === stored.apiKeyHash ? stored : null);
    expect(await authenticateLinkaffi(null, lookup)).toEqual({ ok: false, reason: "missing" });
    expect(await authenticateLinkaffi("  ", lookup)).toEqual({ ok: false, reason: "missing" });
    expect(await authenticateLinkaffi("Bearer", lookup)).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticateLinkaffi(`Bearer ${key}x`, lookup)).toEqual({
      ok: false,
      reason: "invalid",
    });
    const old = generateIntegrationApiKey();
    expect(await authenticateLinkaffi(`Bearer ${old}`, lookup)).toEqual({
      ok: false,
      reason: "invalid",
    });
    const other = async () => ({ provider: "autre", apiKeyHash: stored.apiKeyHash });
    expect(await authenticateLinkaffi(`Bearer ${key}`, other)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("explique le refus en français", () => {
    expect(unauthorizedMessage("missing")).toMatch(/Clé de connexion absente/);
    expect(unauthorizedMessage("invalid")).toMatch(/régénérée.*LINKAFFIPRO_API_KEY/);
  });
});
