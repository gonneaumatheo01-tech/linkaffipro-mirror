/**
 * Phase 15 (pages d'atterrissage, worker) sur la base réelle : écriture des visites, clics et ouvertures envoyés par
 * les pages (file `landing-events`) — une ligne par envoi, jamais deux (reprise de la tâche), source reconnue ou
 * `rawSrc`, page retrouvée par identifiant ou adresse, page inconnue ignorée, jamais d'adresse IP. (La purge des
 * visites anciennes est celle de la nuit, `maintenance/purge.ts`.)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { landingVisitsByLink, prisma } from "@linkaffipro/db";
import { landingEventData, type LandingEventData } from "@linkaffipro/queue";
import { resetLandingPageMemo, writeLandingEvent } from "../../src/landing/events";
import { processLandingEvents, repeatableLandingEvents } from "../../src/processors/landing-events";
import { PROCESSORS } from "../../src/processors/index";
import { createBotAndChannel, fakeJob, resetDb } from "./helpers";

async function setup() {
  const { bot, channel } = await createBotAndChannel();
  const page = await prisma.landingPage.create({
    data: {
      slug: "promo-test",
      name: "Promo test",
      channelId: channel.id,
      headline: "Les meilleurs bonus",
      sources: { create: [{ key: "" }, { key: "tk01" }, { key: "tk03" }] },
    },
  });
  return { bot, channel, page };
}

/** Envoi reçu par le site il y a une minute. */
const SENT_AT = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000).toISOString();

const BASE = {
  type: "VIEW" as const,
  visitId: "visit0000000001",
  sourceKey: "tk01",
  isBot: false,
};

describe("file landing-events : écriture des visites (base réelle)", () => {
  beforeEach(async () => {
    await resetDb();
    resetLandingPageMemo();
  });

  it("est branchée sur le vrai processeur (aucune tâche périodique)", () => {
    expect(PROCESSORS["landing-events"].repeatable).toBe(repeatableLandingEvents);
    expect(repeatableLandingEvents).toEqual([]);
    expect(PROCESSORS["landing-events"].concurrency).toBeGreaterThan(1);
  });

  it("écrit une visite et un clic tels que reçus, sans adresse IP", async () => {
    const { page } = await setup();
    const view = landingEventData(
      {
        ...BASE,
        landingPageId: page.id,
        os: "IOS",
        inApp: "TIKTOK",
        country: "FR",
        ipHash: "a".repeat(64),
        ttclid: "TT-1",
        userAgent: "Mozilla/5.0 (iPhone) musical_ly_35.6.0",
        createdAt: SENT_AT,
      },
      new Date(),
    );
    const click = landingEventData({
      ...BASE,
      landingPageId: page.id,
      type: "CLICK",
      method: "TG_SCHEME",
    });
    const r1 = await processLandingEvents(fakeJob({ type: "event" as const, event: view }));
    expect(r1).toEqual({ ok: true, written: true, landingPageId: page.id, sourceKey: "tk01" });
    await writeLandingEvent(click);
    const rows = await prisma.landingEvent.findMany({ orderBy: { type: "asc" } });
    expect(rows.map((r) => r.type).sort()).toEqual(["CLICK", "VIEW"]);
    const v = rows.find((r) => r.type === "VIEW")!;
    expect(v).toMatchObject({
      id: view.id,
      landingPageId: page.id,
      sourceKey: "tk01",
      rawSrc: null,
      visitId: "visit0000000001",
      os: "IOS",
      inApp: "TIKTOK",
      country: "FR",
      ipHash: "a".repeat(64),
      isBot: false,
      ttclid: "TT-1",
    });
    // Heure de réception par le site (pas celle de l'écriture, même si la file a du retard).
    expect(v.createdAt.toISOString()).toBe(SENT_AT);
    expect(rows.find((r) => r.type === "CLICK")?.method).toBe("TG_SCHEME");
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'LandingEvent'`;
    expect(columns.map((c) => c.column_name)).not.toContain("ip");
  });

  it("heure illisible ou dans le futur (horloge du site déréglée) : heure d'écriture", async () => {
    const { page } = await setup();
    const now = new Date();
    const future = landingEventData({ ...BASE, landingPageId: page.id });
    future.createdAt = new Date(now.getTime() + 3_600_000).toISOString();
    await writeLandingEvent(future, now);
    expect((await prisma.landingEvent.findFirstOrThrow()).createdAt.toISOString()).toBe(
      now.toISOString(),
    );
  });

  it("une reprise de la tâche n'écrit jamais deux fois le même envoi", async () => {
    const { page } = await setup();
    const ev = landingEventData({ ...BASE, landingPageId: page.id });
    expect(await writeLandingEvent(ev)).toMatchObject({ ok: true, written: true });
    expect(await writeLandingEvent(ev)).toMatchObject({ ok: true, written: false });
    expect(await prisma.landingEvent.count()).toBe(1);
  });

  it("source inconnue de la page : source par défaut, valeur reçue gardée ; source ajoutée à l'instant reconnue", async () => {
    const { page } = await setup();
    await writeLandingEvent(
      landingEventData({ ...BASE, landingPageId: page.id, sourceKey: "exo9" }),
    );
    await writeLandingEvent(
      landingEventData({ ...BASE, landingPageId: page.id, sourceKey: "", rawSrc: "inconnue" }),
    );
    const rows = await prisma.landingEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.sourceKey, r.rawSrc])).toEqual([
      ["", "exo9"],
      ["", "inconnue"],
    ]);
    // Source créée après la mise en mémoire de la page : relue, puis reconnue.
    await prisma.landingSource.create({ data: { landingPageId: page.id, key: "exo1" } });
    await new Promise((r) => setTimeout(r, 5100));
    const res = await writeLandingEvent(
      landingEventData({ ...BASE, landingPageId: page.id, sourceKey: "exo1" }),
    );
    expect(res).toMatchObject({ ok: true, sourceKey: "exo1" });
  });

  it("page retrouvée par son adresse ; page inconnue ignorée sans erreur (la tâche se termine)", async () => {
    const { page } = await setup();
    const bySlug = await writeLandingEvent(
      landingEventData({ ...BASE, landingPageId: "promo-test" }),
    );
    expect(bySlug).toMatchObject({ ok: true, landingPageId: page.id });
    expect(
      await writeLandingEvent(landingEventData({ ...BASE, landingPageId: "cm_inconnue_000" })),
    ).toEqual({ ok: false, reason: "unknown-page" });
    expect(await processLandingEvents(fakeJob({ type: "autre" } as never))).toEqual({
      ok: false,
      reason: "type de tâche inconnu",
    });
    expect(await prisma.landingEvent.count()).toBe(1);
  });

  it("page supprimée alors que des visiteurs l'ont encore à l'écran : envoi ignoré, la tâche se termine sans échec", async () => {
    const { page } = await setup();
    expect(
      await writeLandingEvent(landingEventData({ ...BASE, landingPageId: page.id })),
    ).toMatchObject({ ok: true, written: true });
    // Suppression par un ADMIN : la page est encore dans la mémoire du worker (60 s).
    await prisma.landingPage.delete({ where: { id: page.id } });
    const click = landingEventData({ ...BASE, landingPageId: page.id, type: "CLICK" });
    expect(await processLandingEvents(fakeJob({ type: "event" as const, event: click }))).toEqual({
      ok: false,
      reason: "unknown-page",
    });
    // Mémoire de la page oubliée : l'envoi suivant ne retente pas l'écriture.
    const opened = landingEventData({ ...BASE, landingPageId: page.id, type: "OPENED" });
    expect(await writeLandingEvent(opened)).toEqual({ ok: false, reason: "unknown-page" });
    expect(await prisma.landingEvent.count()).toBe(0);
  });

  it("phase 16 : aide affichée, sortie de l'appli (même visite) et ouverture automatique, écrites avec leur méthode", async () => {
    const { page } = await setup();
    // Le type de la file suit `LandingEventKind` (core) : les trois nouveaux types de l'enum Prisma.
    const kind = (t: string) => t as LandingEventData["type"];
    const visitId = "visit_tiktok_0001";
    const inApp = { landingPageId: page.id, visitId, sourceKey: "tk01", isBot: false };
    const events = [
      landingEventData({ ...inApp, type: "VIEW", os: "IOS", inApp: "TIKTOK" }),
      landingEventData({ ...inApp, type: "CLICK", method: "TG_FRAME", os: "IOS", inApp: "TIKTOK" }),
      landingEventData({
        ...inApp,
        type: kind("HELP"),
        method: "TIKTOK",
        os: "IOS",
        inApp: "TIKTOK",
      }),
      // Page rouverte dans Safari : même visite, navigateur ordinaire.
      landingEventData({ ...inApp, type: kind("ESCAPED"), method: "TGO", os: "IOS", inApp: null }),
      landingEventData({ ...inApp, type: kind("AUTO_OPEN"), method: "AUTO_TG", os: "IOS" }),
      landingEventData({ ...inApp, type: "OPENED", method: "AUTO_TG", os: "IOS" }),
    ];
    for (const ev of events)
      expect(
        await processLandingEvents(fakeJob({ type: "event" as const, event: ev })),
      ).toMatchObject({ ok: true, written: true });
    // Reprise d'une tâche : jamais deux fois.
    expect(await writeLandingEvent(events[3]!)).toMatchObject({ ok: true, written: false });
    const rows = await prisma.landingEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => `${r.type}:${r.method ?? ""}:${r.inApp ?? ""}`).sort()).toEqual(
      [
        "AUTO_OPEN:AUTO_TG:",
        "CLICK:TG_FRAME:TIKTOK",
        "ESCAPED:TGO:",
        "HELP:TIKTOK:TIKTOK",
        "OPENED:AUTO_TG:",
        "VIEW::TIKTOK",
      ].sort(),
    );
    // Une seule visite : la sortie de l'appli ne crée pas de deuxième visite.
    expect(new Set(rows.map((r) => r.visitId))).toEqual(new Set([visitId]));
    const visits = await prisma.landingEvent.groupBy({
      by: ["type"],
      where: { landingPageId: page.id, isBot: false },
      _count: { visitId: true },
    });
    expect(Object.fromEntries(visits.map((v) => [v.type, v._count.visitId]))).toMatchObject({
      VIEW: 1,
      HELP: 1,
      ESCAPED: 1,
    });
    // Type inconnu : ignoré sans écriture.
    expect(await writeLandingEvent(landingEventData({ ...inApp, type: kind("PURCHASE") }))).toEqual(
      { ok: false, reason: "invalid" },
    );
  });

  it("phase 16 : sortie reconnue seulement par ttclid / fbclid : rattachée à la visite de l'appli (1 visite, 1 clic)", async () => {
    const { page, channel, bot } = await setup();
    const link = await prisma.inviteLink.create({
      data: {
        channelId: channel.id,
        botId: bot.id,
        telegramInviteLink: "https://t.me/+LandingTk01",
        name: "promo-tk01",
        kind: "LANDING",
        landingPageId: page.id,
        landingSource: "tk01",
        createdAt: new Date(Date.now() - 3_600_000),
      },
    });
    const kind = (t: string) => t as LandingEventData["type"];
    const t0 = Date.now() - 40 * 60_000;
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const write = async (e: Parameters<typeof landingEventData>[0]) =>
      processLandingEvents(fakeJob({ type: "event" as const, event: landingEventData(e) }));
    // Dans TikTok : visite avec ttclid, appui, aide.
    const app = {
      landingPageId: page.id,
      sourceKey: "tk01",
      isBot: false,
      visitId: "visit_tiktok_0100",
      os: "IOS",
      inApp: "TIKTOK",
      ttclid: "E.C.P.TT1",
    };
    await write({ ...app, type: "VIEW", createdAt: at(0) });
    await write({ ...app, type: "CLICK", method: "TG_FRAME", createdAt: at(5) });
    await write({ ...app, type: kind("HELP"), method: "TIKTOK", createdAt: at(5) });
    // TikTok rouvre l'adresse d'origine dans Safari (sans vid) : nouvelle visite côté page, rattachée ici.
    const safari = { ...app, visitId: "visit_safari_0100", inApp: null };
    expect(await write({ ...safari, type: "VIEW", createdAt: at(12) })).toEqual({
      ok: true,
      written: false,
      landingPageId: page.id,
      sourceKey: "tk01",
      linkedVisitId: app.visitId,
    });
    for (const [type, method, s] of [
      ["ESCAPED", "TTCLID", 12],
      ["AUTO_OPEN", "AUTO_TG", 12],
      ["CLICK", "HTTPS", 20],
      ["OPENED", "HTTPS", 21],
    ] as const)
      expect(await write({ ...safari, type: kind(type), method, createdAt: at(s) })).toMatchObject({
        ok: true,
        written: true,
        linkedVisitId: app.visitId,
      });
    const rows = await prisma.landingEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => `${r.type}:${r.method ?? ""}:${r.inApp ?? "-"}:${r.visitId}`)).toEqual([
      `VIEW::TIKTOK:${app.visitId}`,
      `CLICK:TG_FRAME:TIKTOK:${app.visitId}`,
      `HELP:TIKTOK:TIKTOK:${app.visitId}`,
      `ESCAPED:TTCLID:-:${app.visitId}`,
      `AUTO_OPEN:AUTO_TG:-:${app.visitId}`,
      `CLICK:HTTPS:-:${app.visitId}`,
      `OPENED:HTTPS:-:${app.visitId}`,
    ]);
    // UNE visite, UN clic (visites distinctes), et un seul « clic pub » dans les statistiques journalières.
    const distinct = async (type: string) =>
      new Set(
        (
          await prisma.landingEvent.findMany({
            where: { type: kind(type) },
            select: { visitId: true },
          })
        ).map((r) => r.visitId),
      ).size;
    expect(await distinct("VIEW")).toBe(1);
    expect(await distinct("CLICK")).toBe(1);
    expect(await distinct("ESCAPED")).toBe(1);
    const byLink = await landingVisitsByLink({
      since: new Date(t0 - 60_000),
      inviteLinkIds: [link.id],
    });
    expect(byLink.reduce((n, r) => n + r.visits, 0)).toBe(1);

    // Autres cas : jamais rattachés.
    await write({
      ...safari,
      visitId: "visit_other_0101",
      ttclid: "E.C.P.TT2",
      type: "VIEW",
      createdAt: at(30),
    });
    // Même identifiant, mais plus de 30 min après l'appli.
    await write({
      ...safari,
      visitId: "visit_late_0102",
      type: "VIEW",
      createdAt: new Date(t0 + 31 * 60_000).toISOString(),
    });
    // Navigateur intégré au même identifiant (l'appli rouvre sa page) : sa propre visite.
    await write({ ...app, visitId: "visit_tiktok_0103", type: "VIEW", createdAt: at(40) });
    // Sortie déjà reprise par le repère vid (TGO) : reste sous sa visite, même si une autre visite de l'appli porte le
    // même identifiant après elle.
    await write({
      ...safari,
      visitId: app.visitId,
      type: kind("ESCAPED"),
      method: "TGO",
      createdAt: at(45),
    });
    // Ordinateur (même identifiant) : jamais une sortie de l'appli.
    await write({
      ...safari,
      visitId: "visit_desk_0104",
      os: "OTHER",
      type: "VIEW",
      createdAt: at(50),
    });
    const views = await prisma.landingEvent.findMany({
      where: { type: "VIEW" },
      orderBy: { createdAt: "asc" },
      select: { visitId: true },
    });
    expect(views.map((v) => v.visitId)).toEqual([
      app.visitId,
      "visit_other_0101",
      "visit_tiktok_0103",
      "visit_desk_0104",
      "visit_late_0102",
    ]);
    expect((await prisma.landingEvent.findFirstOrThrow({ where: { method: "TGO" } })).visitId).toBe(
      app.visitId,
    );
    // Meta : fbclid de la même façon.
    const ig = {
      ...app,
      visitId: "visit_insta_0105",
      os: "ANDROID",
      inApp: "INSTAGRAM",
      ttclid: null,
      fbclid: "FB.1",
    };
    await write({ ...ig, type: "VIEW", createdAt: at(60) });
    expect(
      await write({
        ...ig,
        visitId: "visit_chrome_0105",
        inApp: null,
        type: kind("ESCAPED"),
        method: "FBCLID",
        createdAt: at(70),
      }),
    ).toMatchObject({ ok: true, written: true, linkedVisitId: ig.visitId });
  });

  it("phase 16 : même ttclid / fbclid sur deux systèmes (lien copié dans l'appli, ouvert par un ami sur un autre téléphone) : jamais rattaché", async () => {
    const { page } = await setup();
    const kind = (t: string) => t as LandingEventData["type"];
    const t0 = Date.now() - 20 * 60_000;
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const write = async (e: Parameters<typeof landingEventData>[0]) =>
      processLandingEvents(fakeJob({ type: "event" as const, event: landingEventData(e) }));
    // Dans TikTok sur Android : visite et appui ; la personne choisit « Copier le lien » (ttclid gardé) et l'envoie.
    const app = {
      landingPageId: page.id,
      sourceKey: "tk01",
      isBot: false,
      visitId: "visit_tiktok_and_0200",
      os: "ANDROID",
      inApp: "TIKTOK",
      ttclid: "E.C.P.SHARED",
    };
    await write({ ...app, type: "VIEW", createdAt: at(0) });
    await write({ ...app, type: "CLICK", method: "TG_FRAME", createdAt: at(4) });
    // L'ami l'ouvre dans Safari sur son iPhone 2 minutes plus tard : SA visite, jamais celle de l'expéditeur.
    const friend = { ...app, visitId: "visit_safari_ios_0200", os: "IOS", inApp: null };
    expect(await write({ ...friend, type: "VIEW", createdAt: at(120) })).toEqual({
      ok: true,
      written: true,
      landingPageId: page.id,
      sourceKey: "tk01",
    });
    for (const [type, method, s] of [
      ["ESCAPED", "TTCLID", 120],
      ["AUTO_OPEN", "AUTO_TG", 120],
      ["CLICK", "HTTPS", 130],
    ] as const) {
      const r = await write({ ...friend, type: kind(type), method, createdAt: at(s) });
      expect(r, type).toMatchObject({ ok: true, written: true });
      expect(r, type).not.toHaveProperty("linkedVisitId");
    }
    // Dans l'autre sens (appli Meta sur iPhone, Chrome sur Android, même fbclid) : rien non plus.
    const ig = {
      ...app,
      visitId: "visit_insta_ios_0201",
      os: "IOS",
      inApp: "INSTAGRAM",
      ttclid: null,
      fbclid: "FB.SHARED",
    };
    await write({ ...ig, type: "VIEW", createdAt: at(200) });
    const chrome = { ...ig, visitId: "visit_chrome_and_0201", os: "ANDROID", inApp: null };
    expect(
      await write({ ...chrome, type: kind("ESCAPED"), method: "FBCLID", createdAt: at(210) }),
    ).not.toHaveProperty("linkedVisitId");
    // Témoin : la vraie sortie, sur le même téléphone (Chrome sur Android après TikTok sur Android), reste rattachée.
    const same = { ...app, visitId: "visit_chrome_and_0202", inApp: null };
    expect(await write({ ...same, type: "VIEW", createdAt: at(300) })).toMatchObject({
      ok: true,
      written: false,
      linkedVisitId: app.visitId,
    });
    const rows = await prisma.landingEvent.findMany({
      orderBy: [{ createdAt: "asc" }, { type: "asc" }],
      select: { type: true, visitId: true, os: true },
    });
    expect(rows.map((r) => `${r.type}:${r.os}:${r.visitId}`)).toEqual([
      `VIEW:ANDROID:${app.visitId}`,
      `CLICK:ANDROID:${app.visitId}`,
      `VIEW:IOS:${friend.visitId}`,
      `ESCAPED:IOS:${friend.visitId}`,
      `AUTO_OPEN:IOS:${friend.visitId}`,
      `CLICK:IOS:${friend.visitId}`,
      `VIEW:IOS:${ig.visitId}`,
      `ESCAPED:ANDROID:${chrome.visitId}`,
    ]);
  });

  it("robot connu : gardé, marqué (jamais compté par les chiffres)", async () => {
    const { page } = await setup();
    await writeLandingEvent(landingEventData({ ...BASE, landingPageId: page.id, isBot: true }));
    expect((await prisma.landingEvent.findFirstOrThrow()).isBot).toBe(true);
  });
});
