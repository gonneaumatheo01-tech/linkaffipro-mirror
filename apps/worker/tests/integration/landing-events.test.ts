/**
 * Phase 15 (pages d'atterrissage, worker) sur la base réelle : écriture des visites, clics et ouvertures envoyés par
 * les pages (file `landing-events`) — une ligne par envoi, jamais deux (reprise de la tâche), source reconnue ou
 * `rawSrc`, page retrouvée par identifiant ou adresse, page inconnue ignorée, jamais d'adresse IP. (La purge des
 * visites anciennes est celle de la nuit, `maintenance/purge.ts`.)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { landingEventData } from "@linkaffipro/queue";
import { resetLandingPageMemo, writeLandingEvent } from "../../src/landing/events";
import { processLandingEvents, repeatableLandingEvents } from "../../src/processors/landing-events";
import { PROCESSORS } from "../../src/processors/index";
import { createBotAndChannel, fakeJob, resetDb } from "./helpers";

async function setup() {
  const { channel } = await createBotAndChannel();
  const page = await prisma.landingPage.create({
    data: {
      slug: "promo-test",
      name: "Promo test",
      channelId: channel.id,
      headline: "Les meilleurs bonus",
      sources: { create: [{ key: "" }, { key: "tk01" }, { key: "tk03" }] },
    },
  });
  return { channel, page };
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

  it("robot connu : gardé, marqué (jamais compté par les chiffres)", async () => {
    const { page } = await setup();
    await writeLandingEvent(landingEventData({ ...BASE, landingPageId: page.id, isBot: true }));
    expect((await prisma.landingEvent.findFirstOrThrow()).isBot).toBe(true);
  });
});
