import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { GET } from "@/app/r/[[...slug]]/route";
import { ctx, flushAfter, resetDb } from "./helpers";

describe("redirection go.goolink.eu (base réelle)", () => {
  beforeAll(async () => {
    await resetDb();
    await prisma.trackingLink.create({ data: { slug: "INTEG001", kind: "GENERIC", destinationTemplate: "https://example.org/landing", label: "Test intégration" } });
  });

  it("répond 302 vers la destination et enregistre un clic humain", async () => {
    const res = await GET(new Request("https://go.goolink.eu/INTEG001?ttclid=T1&utm_source=tiktok", { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "x-forwarded-for": "203.0.113.9", host: "go.goolink.eu" } }), ctx({ slug: ["INTEG001"] }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.org/landing");
    expect(res.headers.get("cache-control")).toContain("no-store");
    await flushAfter();
    const clicks = await prisma.click.findMany({ where: { trackingLink: { slug: "INTEG001" } } });
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.isBot).toBe(false);
    expect(clicks[0]?.ttclid).toBe("T1");
    expect(clicks[0]?.ipHash).toHaveLength(64);
    const link = await prisma.trackingLink.findUnique({ where: { slug: "INTEG001" } });
    expect(link?.clicks).toBe(1);
  });

  it("marque un robot sans le compter", async () => {
    const res = await GET(new Request("https://go.goolink.eu/INTEG001", { headers: { "user-agent": "facebookexternalhit/1.1", "x-forwarded-for": "198.51.100.1" } }), ctx({ slug: ["INTEG001"] }));
    expect(res.status).toBe(302);
    await flushAfter();
    const link = await prisma.trackingLink.findUnique({ where: { slug: "INTEG001" } });
    expect(link?.clicks).toBe(1);
    const bots = await prisma.click.count({ where: { isBot: true } });
    expect(bots).toBe(1);
  });

  it("envoie un slug inconnu vers le site", async () => {
    const res = await GET(new Request("https://go.goolink.eu/inconnu"), ctx({ slug: ["inconnu"] }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000");
  });
});
