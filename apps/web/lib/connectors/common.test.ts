import { beforeAll, describe, expect, it } from "vitest";
import { createOAuthState, redirectUriFor, verifyOAuthState } from "./common";

beforeAll(() => {
  process.env.AUTH_SECRET = "secret-de-test";
  process.env.APP_BASE_URL = "https://app.example.test";
});

describe("état OAuth signé", () => {
  it("se vérifie et porte la plateforme et l'utilisateur", () => {
    const s = createOAuthState("META", "u1");
    expect(verifyOAuthState(s)).toEqual({ platform: "META", userId: "u1" });
  });
  it("refuse une signature altérée, un état vide ou expiré", () => {
    const s = createOAuthState("TIKTOK", "u1", Date.now() - 11 * 60_000);
    expect(verifyOAuthState(s)).toBeNull();
    const ok = createOAuthState("TIKTOK", "u1");
    expect(verifyOAuthState(ok.slice(0, -2) + "zz")).toBeNull();
    expect(verifyOAuthState(null)).toBeNull();
    expect(verifyOAuthState("abc")).toBeNull();
  });
  it("construit l'adresse de retour exacte", () => {
    expect(redirectUriFor("META")).toBe("https://app.example.test/api/connectors/meta/callback");
    expect(redirectUriFor("TIKTOK")).toBe("https://app.example.test/api/connectors/tiktok/callback");
  });
});
