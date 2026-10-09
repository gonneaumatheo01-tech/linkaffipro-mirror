import { beforeEach, describe, expect, it } from "vitest";
import { buildRedirectEvent, redirectResponse, resolveTarget } from "./tracking";

describe("redirections goolink", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://linkaffipro.com";
    process.env.IP_HASH_SALT = "sel-test";
  });

  it("envoie /test vers t.me/telegram", () => {
    expect(resolveTarget(["test"])).toEqual({ slug: "test", target: "https://t.me/telegram", known: true });
  });
  it("envoie un slug inconnu vers le site", () => {
    expect(resolveTarget(["inconnu"])).toMatchObject({ target: "https://linkaffipro.com", known: false });
    expect(resolveTarget([])).toMatchObject({ slug: "", target: "https://linkaffipro.com" });
  });
  it("répond 302 sans HTML ni cache", async () => {
    const res = redirectResponse("https://t.me/telegram");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://t.me/telegram");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).toBe("");
  });
  it("construit l'événement avec IP hachée, robots et paramètres", () => {
    const req = new Request("https://goolink.eu/test?ttclid=T1&utm_source=tiktok&autre=1", {
      headers: { "user-agent": "facebookexternalhit/1.1", "x-forwarded-for": "203.0.113.9, 10.0.0.1", referer: "https://tiktok.com/", host: "goolink.eu" },
    });
    const ev = buildRedirectEvent(req, resolveTarget(["test"]));
    expect(ev.isBot).toBe(true);
    expect(ev.ipHash).toHaveLength(64);
    expect(ev.ipHash).not.toContain("203.0.113.9");
    expect(ev.clickIds).toEqual({ ttclid: "T1" });
    expect(ev.utm).toEqual({ utm_source: "tiktok" });
    expect(ev.referer).toBe("https://tiktok.com/");
    expect(ev.host).toBe("goolink.eu");
  });
  it("marque un navigateur comme humain", () => {
    const req = new Request("https://goolink.eu/test", { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1" } });
    expect(buildRedirectEvent(req, resolveTarget(["test"])).isBot).toBe(false);
  });
});
