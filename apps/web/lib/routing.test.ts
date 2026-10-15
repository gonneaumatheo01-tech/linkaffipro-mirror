import { describe, expect, it } from "vitest";
import {
  decideRoute,
  isLoopbackHost,
  isPublicPath,
  landingAllowedForRequest,
  landingAllowedOnHost,
} from "./routing";

describe("routage par hôte", () => {
  it("réécrit tout le trafic du domaine de tracking vers /r", () => {
    expect(decideRoute("go.goolink.eu", "/test", "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: "/r/test",
    });
    expect(
      decideRoute("www.go.goolink.eu", "/abc/def?x=1".split("?")[0]!, "go.goolink.eu"),
    ).toEqual({ kind: "tracking", rewriteTo: "/r/abc/def" });
    expect(decideRoute("go.goolink.eu:443", "/", "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: "/r/",
    });
    expect(decideRoute("go.goolink.eu", "/r/test", "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: "/r/test",
    });
  });
  it("sert les pages d'atterrissage /j/… du domaine de tracking telles quelles, sans passer par /r", () => {
    expect(decideRoute("go.goolink.eu", "/j/promo", "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: "/j/promo",
    });
    expect(decideRoute("www.go.goolink.eu", "/j/_e", "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: "/j/_e",
    });
    expect(decideRoute("go.goolink.eu", "/j/_p/ch1.jpg", "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: "/j/_p/ch1.jpg",
    });
    // Barre oblique finale : retirée par réécriture (jamais de redirection avant la page).
    expect(decideRoute("go.goolink.eu", "/j/promo/", "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: "/j/promo",
    });
    // Les liens goolink existants ne changent pas.
    expect(decideRoute("go.goolink.eu", "/jXYZ12", "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: "/r/jXYZ12",
    });
    expect(decideRoute("go.goolink.eu", "/j", "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: "/r/j",
    });
  });
  it("laisse les pages d'atterrissage publiques sur l'hôte du site (essais, aperçu)", () => {
    expect(decideRoute("app.linkaffipro.com", "/j/promo", "go.goolink.eu")).toEqual({
      kind: "public",
    });
    expect(isPublicPath("/j/_e")).toBe(true);
    expect(isPublicPath("/j/_p/ch1.jpg")).toBe(true);
    expect(isPublicPath("/j")).toBe(false);
    expect(isPublicPath("/jx/promo")).toBe(false);
  });
  it("en production, l'adresse du site ne sert jamais une page d'atterrissage (pixels avec la session de l'équipe)", () => {
    const prod = { landingOnSiteHost: false };
    for (const path of ["/j/promo", "/j/_e", "/j/_p/ch1.jpg"]) {
      expect(decideRoute("app.linkaffipro.com", path, "go.goolink.eu", prod)).toEqual({
        kind: "landing-elsewhere",
      });
      expect(
        decideRoute("web-production-361c4c.up.railway.app", path, "go.goolink.eu", prod),
      ).toEqual({ kind: "landing-elsewhere" });
    }
    // Sur l'hôte de tracking : servie telle quelle.
    expect(decideRoute("go.goolink.eu", "/j/promo", "go.goolink.eu", prod)).toEqual({
      kind: "tracking",
      rewriteTo: "/j/promo",
    });
    // La machine elle-même (essais, mesures depuis le conteneur) et le développement : servie.
    expect(decideRoute("localhost:3000", "/j/promo", "go.goolink.eu", prod)).toEqual({
      kind: "public",
    });
    expect(decideRoute("127.0.0.1:8080", "/j/promo", "go.goolink.eu", prod)).toEqual({
      kind: "public",
    });
    expect(
      decideRoute("app.linkaffipro.com", "/j/promo", "go.goolink.eu", { landingOnSiteHost: true }),
    ).toEqual({ kind: "public" });
    // Aucun hôte de tracking configuré : rien à comparer, servie.
    expect(decideRoute("app.linkaffipro.com", "/j/promo", undefined, prod)).toEqual({
      kind: "public",
    });
    // Le reste du site ne change pas.
    expect(decideRoute("app.linkaffipro.com", "/pages", "go.goolink.eu", prod)).toEqual({
      kind: "protected",
    });
    expect(decideRoute("app.linkaffipro.com", "/jx/promo", "go.goolink.eu", prod)).toEqual({
      kind: "protected",
    });
  });

  it("même règle dans les routes des pages (deuxième barrière)", () => {
    expect(landingAllowedOnHost("app.linkaffipro.com", "go.goolink.eu", true)).toBe(false);
    expect(landingAllowedOnHost("go.goolink.eu", "go.goolink.eu", true)).toBe(true);
    expect(landingAllowedOnHost("www.go.goolink.eu:443", "go.goolink.eu", true)).toBe(true);
    expect(landingAllowedOnHost("app.linkaffipro.com", "go.goolink.eu", false)).toBe(true);
    expect(landingAllowedOnHost("app.linkaffipro.com", undefined, true)).toBe(true);
    expect(landingAllowedOnHost(null, "go.goolink.eu", true)).toBe(false);
    const h = (host: string, forwarded?: string) =>
      new Headers({ host, ...(forwarded ? { "x-forwarded-host": forwarded } : {}) });
    const prod = { NODE_ENV: "production", TRACKING_HOST: "go.goolink.eu" };
    expect(landingAllowedForRequest(h("app.linkaffipro.com"), prod)).toBe(false);
    expect(landingAllowedForRequest(h("10.0.0.2:8080", "go.goolink.eu"), prod)).toBe(true);
    expect(landingAllowedForRequest(h("10.0.0.2:8080", "app.linkaffipro.com"), prod)).toBe(false);
    expect(landingAllowedForRequest(h("app.linkaffipro.com"), { ...prod, NODE_ENV: "test" })).toBe(
      true,
    );
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("[::1]:3000")).toBe(true);
    expect(isLoopbackHost("localhost.evil.example")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.nip.io")).toBe(false);
  });

  it("protège le site principal sauf les chemins publics", () => {
    expect(decideRoute("app.linkaffipro.com", "/", "go.goolink.eu")).toEqual({ kind: "protected" });
    expect(decideRoute("app.linkaffipro.com", "/settings/bots", "go.goolink.eu")).toEqual({
      kind: "protected",
    });
    expect(decideRoute("app.linkaffipro.com", "/login", "go.goolink.eu")).toEqual({
      kind: "public",
    });
    expect(decideRoute("app.linkaffipro.com", "/invite/abc", "go.goolink.eu")).toEqual({
      kind: "public",
    });
    expect(decideRoute("app.linkaffipro.com", "/api/health", "go.goolink.eu")).toEqual({
      kind: "public",
    });
    expect(decideRoute("app.linkaffipro.com", "/api/telegram/bot_1", "go.goolink.eu")).toEqual({
      kind: "public",
    });
    expect(
      decideRoute("app.linkaffipro.com", "/api/auth/callback/credentials", "go.goolink.eu"),
    ).toEqual({ kind: "public" });
    expect(decideRoute("app.linkaffipro.com", "/r/test", "go.goolink.eu")).toEqual({
      kind: "public",
    });
    expect(decideRoute("app.linkaffipro.com", "/privacy", "go.goolink.eu")).toEqual({
      kind: "public",
    });
    expect(decideRoute("app.linkaffipro.com", "/terms", "go.goolink.eu")).toEqual({
      kind: "public",
    });
    expect(
      decideRoute("app.linkaffipro.com", "/api/connectors/meta/start", "go.goolink.eu"),
    ).toEqual({ kind: "protected" });
  });
  it("laisse passer l'API d'intégration Link Affi sans session (la clé est vérifiée par la route)", () => {
    expect(
      decideRoute("app.linkaffipro.com", "/api/integrations/linkaffi/v1/channels", "go.goolink.eu"),
    ).toEqual({ kind: "public" });
    expect(isPublicPath("/api/integrations/linkaffi/v1/invite-links/abc")).toBe(true);
    expect(isPublicPath("/api/integrationsx")).toBe(false);
    expect(isPublicPath("/api/integrations")).toBe(false);
  });
  it("laisse les icônes du site lisibles sans session (onglet de connexion, écran d'accueil iPhone)", () => {
    expect(isPublicPath("/icon.png")).toBe(true);
    expect(isPublicPath("/apple-icon.png")).toBe(true);
  });

  it("ne confond pas les préfixes", () => {
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/healthcheck")).toBe(false);
    expect(isPublicPath("/rx")).toBe(false);
    expect(isPublicPath("/api/postbackx")).toBe(false);
    expect(isPublicPath("/privacyx")).toBe(false);
    expect(isPublicPath("/termsx")).toBe(false);
    expect(isPublicPath("/icon.pngx")).toBe(false);
  });
});
