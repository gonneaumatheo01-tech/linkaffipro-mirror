import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  trackingLink: { findUnique: vi.fn(), update: vi.fn() },
  click: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock("@linkaffipro/db", () => ({ prisma: db, recordEvent: vi.fn(async () => undefined) }));

import { buildRedirectEvent, recordAnonymousClick, redirectResponse, resolveTarget } from "./tracking";

const HUMAN_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

describe("redirections goolink", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://app.linkaffipro.com";
    process.env.IP_HASH_SALT = "sel-test";
    vi.clearAllMocks();
    db.trackingLink.findUnique.mockResolvedValue(null);
    db.click.findFirst.mockResolvedValue(null);
    db.click.create.mockResolvedValue({ id: "c1" });
    db.trackingLink.update.mockResolvedValue({});
  });

  it("envoie /test vers t.me/telegram sans requête", async () => {
    expect(await resolveTarget(["test"])).toMatchObject({ slug: "test", target: "https://t.me/telegram", known: true });
    expect(db.trackingLink.findUnique).not.toHaveBeenCalled();
  });
  it("résout un slug actif vers sa destination (une seule requête)", async () => {
    db.trackingLink.findUnique.mockResolvedValue({ id: "tl1", kind: "AD_ENTRY", isActive: true, destinationTemplate: "https://t.me/+AbCdEf" });
    const r = await resolveTarget(["abc12345"]);
    expect(r).toMatchObject({ target: "https://t.me/+AbCdEf", known: true, trackingLink: { id: "tl1", kind: "AD_ENTRY" } });
    expect(db.trackingLink.findUnique).toHaveBeenCalledTimes(1);
  });
  it("envoie un slug inconnu ou inactif vers le site", async () => {
    expect(await resolveTarget(["inconnu1"])).toMatchObject({ target: "https://app.linkaffipro.com", known: false });
    db.trackingLink.findUnique.mockResolvedValue({ id: "tl1", kind: "GENERIC", isActive: false, destinationTemplate: "https://x" });
    expect(await resolveTarget(["abc12345"])).toMatchObject({ known: false });
    expect(await resolveTarget([])).toMatchObject({ slug: "", known: false });
  });
  it("répond 302 sans HTML ni cache", async () => {
    const res = redirectResponse("https://t.me/telegram");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://t.me/telegram");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).toBe("");
  });
  it("construit l'événement avec IP hachée, robots et paramètres", async () => {
    const req = new Request("https://go.goolink.eu/test?ttclid=T1&utm_source=tiktok&autre=1", {
      headers: { "user-agent": "facebookexternalhit/1.1", "x-forwarded-for": "203.0.113.9, 10.0.0.1", referer: "https://tiktok.com/", host: "go.goolink.eu" },
    });
    const ev = buildRedirectEvent(req, await resolveTarget(["test"]));
    expect(ev.isBot).toBe(true);
    expect(ev.ipHash).toHaveLength(64);
    expect(ev.ipHash).not.toContain("203.0.113.9");
    expect(ev.clickIds).toEqual({ ttclid: "T1" });
    expect(ev.utm).toEqual({ utm_source: "tiktok" });
    expect(ev.referer).toBe("https://tiktok.com/");
    expect(ev.host).toBe("go.goolink.eu");
  });

  describe("enregistrement des clics anonymes", () => {
    const base = async (ua: string) => {
      db.trackingLink.findUnique.mockResolvedValue({ id: "tl1", kind: "AD_ENTRY", isActive: true, destinationTemplate: "https://t.me/+x" });
      const req = new Request("https://go.goolink.eu/abc12345?fbclid=F1&utm_campaign=c1", { headers: { "user-agent": ua, "x-forwarded-for": "198.51.100.7" } });
      return buildRedirectEvent(req, await resolveTarget(["abc12345"]));
    };
    it("compte un clic humain et incrémente les compteurs", async () => {
      expect(await recordAnonymousClick(await base(HUMAN_UA))).toBe("counted");
      expect(db.click.create).toHaveBeenCalledTimes(1);
      expect(db.click.create.mock.calls[0]![0].data).toMatchObject({ trackingLinkId: "tl1", isBot: false, fbclid: "F1", utm: { utm_campaign: "c1" } });
      expect(db.trackingLink.update).toHaveBeenCalledWith({ where: { id: "tl1" }, data: { clicks: { increment: 1 }, uniqueClicks: { increment: 1 } } });
    });
    it("n'incrémente pas uniqueClicks si l'empreinte a déjà cliqué", async () => {
      db.click.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "old" });
      await recordAnonymousClick(await base(HUMAN_UA));
      expect(db.trackingLink.update).toHaveBeenCalledWith({ where: { id: "tl1" }, data: { clicks: { increment: 1 }, uniqueClicks: undefined } });
    });
    it("dédoublonne dans les 10 secondes", async () => {
      db.click.findFirst.mockResolvedValueOnce({ id: "recent" });
      expect(await recordAnonymousClick(await base(HUMAN_UA))).toBe("skipped");
      expect(db.click.create).not.toHaveBeenCalled();
    });
    it("marque les robots sans les compter", async () => {
      expect(await recordAnonymousClick(await base("TelegramBot (like TwitterBot)"))).toBe("bot");
      expect(db.click.create.mock.calls[0]![0].data.isBot).toBe(true);
      expect(db.trackingLink.update).not.toHaveBeenCalled();
    });
    it("ignore un slug sans lien traqué", async () => {
      const req = new Request("https://go.goolink.eu/test", { headers: { "user-agent": HUMAN_UA } });
      expect(await recordAnonymousClick(buildRedirectEvent(req, await resolveTarget(["test"])))).toBe("skipped");
    });
  });
});
