import { describe, expect, it } from "vitest";
import { decideRoute, isPublicPath } from "./routing";

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
  it("protège le site principal sauf les chemins publics", () => {
    expect(decideRoute("app.linkaffipro.com", "/", "go.goolink.eu")).toEqual({ kind: "protected" });
    expect(decideRoute("app.linkaffipro.com", "/bots", "go.goolink.eu")).toEqual({
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
  it("ne confond pas les préfixes", () => {
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/healthcheck")).toBe(false);
    expect(isPublicPath("/rx")).toBe(false);
    expect(isPublicPath("/api/postbackx")).toBe(false);
    expect(isPublicPath("/privacyx")).toBe(false);
    expect(isPublicPath("/termsx")).toBe(false);
  });
});
