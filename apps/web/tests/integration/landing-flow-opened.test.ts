/**
 * Phase 15, « Telegram ouvert après le clic » sur la base réelle : la comparaison des façons d'ouvrir ne garde que le
 * PREMIER appui de chaque visite, le seul dont la façon est tirée au sort. Un nouvel appui (Telegram ne s'est pas
 * ouvert, la personne réappuie : la page essaie l'autre façon) n'y entre pas, ni son ouverture. Le nombre de clics
 * de la comparaison est donc celui de la colonne « Clics » du tableau (un clic par visite).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { resolvePeriod } from "@/lib/periods";
import { resetDb } from "./helpers";

const { loadLandingTables } = await import("@/lib/landing/stats");

const CHAT = -1001_960_000_077n;
/** Jour de Paris (heure d'hiver : UTC+1) : du 10 mars 2026 à 23 h UTC la veille au 10 mars à 23 h UTC. */
const DAY = resolvePeriod({ from: "2026-03-10", to: "2026-03-10" });
const at = (iso: string) => new Date(iso);

describe("rubrique Pages : Telegram ouvert, un appui par visite (base réelle)", () => {
  const ids = { channel: "", page: "" };
  let n = 0;

  /** Un envoi de la page (TikTok sur Android), écrit comme le ferait le worker. */
  const event = (
    visitId: string,
    type: "VIEW" | "CLICK" | "OPENED",
    createdAt: string,
    method: string | null = null,
  ) =>
    prisma.landingEvent.create({
      data: {
        id: `opened-test-${++n}`,
        landingPageId: ids.page,
        sourceKey: "story",
        type,
        visitId,
        os: "ANDROID",
        inApp: "TIKTOK",
        method,
        createdAt: at(createdAt),
      },
    });

  beforeAll(async () => {
    await prisma.landingSource.deleteMany();
    await prisma.landingPage.deleteMany();
    await resetDb();
    const channel = await prisma.channel.create({
      data: { telegramChatId: CHAT, title: "Casino VIP", vertical: "CASINO", isTest: true },
    });
    ids.channel = channel.id;
    const page = await prisma.landingPage.create({
      data: {
        slug: "appuis-test",
        name: "Appuis",
        channelId: channel.id,
        headline: "Les meilleurs bonus",
        sources: { create: [{ key: "" }, { key: "story" }] },
      },
    });
    ids.page = page.id;

    // V1 : appli directe tirée au sort, Telegram ne s'ouvre pas, nouvel appui 700 ms plus tard (lien classique,
    // imposé) qui ouvre Telegram : seul le premier appui compte, sans ouverture.
    await event("visit-v1-0000001", "VIEW", "2026-03-10T12:00:00.000Z");
    await event("visit-v1-0000001", "CLICK", "2026-03-10T12:00:05.000Z", "TG_SCHEME");
    await event("visit-v1-0000001", "CLICK", "2026-03-10T12:00:05.700Z", "HTTPS");
    await event("visit-v1-0000001", "OPENED", "2026-03-10T12:00:06.200Z", "HTTPS");
    // V2 : lien classique tiré au sort, Telegram ouvert.
    await event("visit-v2-0000001", "VIEW", "2026-03-10T12:01:00.000Z");
    await event("visit-v2-0000001", "CLICK", "2026-03-10T12:01:03.000Z", "HTTPS");
    await event("visit-v2-0000001", "OPENED", "2026-03-10T12:01:03.400Z", "HTTPS");
    // V3 : appli directe tirée au sort, Telegram ouvert (l'ouverture reçue 5 ms avant le clic compte quand même).
    await event("visit-v3-0000001", "VIEW", "2026-03-10T12:02:00.000Z");
    await event("visit-v3-0000001", "OPENED", "2026-03-10T12:02:01.995Z", "TG_SCHEME");
    await event("visit-v3-0000001", "CLICK", "2026-03-10T12:02:02.000Z", "TG_SCHEME");
    // V4 : appli directe, puis lien classique, puis de nouveau l'appli qui s'ouvre au 3e appui : la même façon que
    // le premier appui, mais l'ouverture suit un autre appui : elle ne compte pas pour le premier.
    await event("visit-v4-0000001", "VIEW", "2026-03-10T12:03:00.000Z");
    await event("visit-v4-0000001", "CLICK", "2026-03-10T12:03:02.000Z", "TG_SCHEME");
    await event("visit-v4-0000001", "CLICK", "2026-03-10T12:03:02.800Z", "HTTPS");
    await event("visit-v4-0000001", "CLICK", "2026-03-10T12:03:04.000Z", "TG_SCHEME");
    await event("visit-v4-0000001", "OPENED", "2026-03-10T12:03:04.300Z", "TG_SCHEME");
    // V5 : appui à 23 h 59 min 59 s (Paris), Telegram ouvert juste après minuit : l'ouverture compte pour ce jour.
    await event("visit-v5-0000001", "VIEW", "2026-03-10T22:59:50.000Z");
    await event("visit-v5-0000001", "CLICK", "2026-03-10T22:59:59.700Z", "TG_SCHEME");
    await event("visit-v5-0000001", "OPENED", "2026-03-10T23:00:00.300Z", "TG_SCHEME");
    // Le 12 mars : une visite, deux appuis (appli directe, puis lien classique imposé), Telegram jamais ouvert.
    await event("visit-v6-0000001", "VIEW", "2026-03-12T08:00:00.000Z");
    await event("visit-v6-0000001", "CLICK", "2026-03-12T08:00:02.000Z", "TG_SCHEME");
    await event("visit-v6-0000001", "CLICK", "2026-03-12T08:00:02.700Z", "HTTPS");
  });

  afterAll(async () => {
    await prisma.landingSource.deleteMany();
    await prisma.landingPage.deleteMany();
    await resetDb();
  });

  it("comparaison des façons d'ouvrir : le premier appui de chaque visite, rien d'autre", async () => {
    const t = (await loadLandingTables([ids.page], DAY)).get(ids.page)!;
    const story = t.sources.find((s) => s.key === "story")!;
    expect(story).toMatchObject({ visits: 5, clicks: 5 });
    expect(story.opened).toEqual([
      {
        os: "ANDROID",
        clicks: 5,
        opened: 3,
        rate: 3 / 5,
        browsers: [
          {
            key: "ANDROID:TIKTOK",
            os: "ANDROID",
            inApp: "TIKTOK",
            label: "TikTok sur Android",
            clicks: 5,
            opened: 3,
            rate: 3 / 5,
            methods: [
              { method: "TG_SCHEME", clicks: 4, opened: 2, rate: 2 / 4 },
              { method: "HTTPS", clicks: 1, opened: 1, rate: 1 },
            ],
            httpsInApp: true,
          },
        ],
      },
    ]);
    // Même nombre de clics que le tableau, pour la source comme pour toute la page.
    expect(t.totals.clicks).toBe(5);
    expect(t.totals.opened.map((o) => [o.os, o.clicks, o.opened])).toEqual([["ANDROID", 5, 3]]);
  });

  it("une visite, deux appuis : un seul clic dans la comparaison, celui du tirage", async () => {
    const day = resolvePeriod({ from: "2026-03-12", to: "2026-03-12" });
    const story = (await loadLandingTables([ids.page], day))
      .get(ids.page)!
      .sources.find((s) => s.key === "story")!;
    expect(story).toMatchObject({ visits: 1, clicks: 1 });
    expect(story.opened.map((o) => [o.os, o.clicks, o.opened])).toEqual([["ANDROID", 1, 0]]);
    expect(story.opened[0]!.browsers[0]!.methods).toEqual([
      { method: "TG_SCHEME", clicks: 1, opened: 0, rate: 0 },
    ]);
  });
});
