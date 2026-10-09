import { describe, expect, it } from "vitest";
import { decideRoute, isPublicPath } from "./routing";

describe("routage par hôte", () => {
  it("réécrit tout le trafic du domaine de tracking vers /r", () => {
    expect(decideRoute("goolink.eu", "/test", "goolink.eu")).toEqual({ kind: "tracking", rewriteTo: "/r/test" });
    expect(decideRoute("www.goolink.eu", "/abc/def?x=1".split("?")[0]!, "goolink.eu")).toEqual({ kind: "tracking", rewriteTo: "/r/abc/def" });
    expect(decideRoute("goolink.eu:443", "/", "goolink.eu")).toEqual({ kind: "tracking", rewriteTo: "/r/" });
    expect(decideRoute("goolink.eu", "/r/test", "goolink.eu")).toEqual({ kind: "tracking", rewriteTo: "/r/test" });
  });
  it("protège le site principal sauf les chemins publics", () => {
    expect(decideRoute("linkaffipro.com", "/", "goolink.eu")).toEqual({ kind: "protected" });
    expect(decideRoute("linkaffipro.com", "/bots", "goolink.eu")).toEqual({ kind: "protected" });
    expect(decideRoute("linkaffipro.com", "/login", "goolink.eu")).toEqual({ kind: "public" });
    expect(decideRoute("linkaffipro.com", "/invite/abc", "goolink.eu")).toEqual({ kind: "public" });
    expect(decideRoute("linkaffipro.com", "/api/health", "goolink.eu")).toEqual({ kind: "public" });
    expect(decideRoute("linkaffipro.com", "/api/telegram/bot_1", "goolink.eu")).toEqual({ kind: "public" });
    expect(decideRoute("linkaffipro.com", "/api/auth/callback/credentials", "goolink.eu")).toEqual({ kind: "public" });
    expect(decideRoute("linkaffipro.com", "/r/test", "goolink.eu")).toEqual({ kind: "public" });
  });
  it("ne confond pas les préfixes", () => {
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/healthcheck")).toBe(false);
    expect(isPublicPath("/rx")).toBe(false);
  });
});
