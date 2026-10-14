import { describe, expect, it, vi } from "vitest";
import { LINKAFFI_EVENTS_URL_DEFAULT } from "@linkaffipro/core";

const db = vi.hoisted(() => ({
  updateMany: null as null | ((args: unknown) => Promise<{ count: number }>),
  enqueued: [] as unknown[],
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: { linkaffiEvent: { updateMany: (args: unknown) => db.updateMany!(args) } },
  audit: vi.fn(),
}));
vi.mock("@linkaffipro/queue", () => ({
  enqueue: async (_queue: string, data: unknown) => {
    db.enqueued.push(data);
  },
}));
const { parseEventsUrl, releaseWaitingLinkaffiEvents, releasedSentence } =
  await import("./settings");

/** Adresse de la fonction Link Affi `telegram-events` saisie dans Réglages → Connexions. */
describe("adresse des événements", () => {
  it("vide ou adresse d'origine : null (adresse d'origine)", () => {
    expect(parseEventsUrl("")).toEqual({ url: null });
    expect(parseEventsUrl("   ")).toEqual({ url: null });
    expect(parseEventsUrl(undefined)).toEqual({ url: null });
    expect(parseEventsUrl(LINKAFFI_EVENTS_URL_DEFAULT)).toEqual({ url: null });
  });
  it("https obligatoire ; http seulement vers cette machine hors production", () => {
    expect(parseEventsUrl(" https://abc.supabase.co/functions/v1/telegram-events ")).toEqual({
      url: "https://abc.supabase.co/functions/v1/telegram-events",
    });
    expect(parseEventsUrl("http://abc.supabase.co/x")).toEqual({
      error: "L'adresse doit commencer par https:// (connexion chiffrée).",
    });
    expect(parseEventsUrl("http://127.0.0.1:4010/hook")).toEqual({
      url: "http://127.0.0.1:4010/hook",
    });
    expect(parseEventsUrl("http://localhost:4010/hook", { production: true })).toMatchObject({
      error: expect.stringMatching(/https/),
    });
  });
  it("refuse une adresse illisible, trop longue ou avec identifiants", () => {
    expect(parseEventsUrl("pas une adresse")).toMatchObject({
      error: expect.stringMatching(/illisible/),
    });
    expect(parseEventsUrl(`https://a.co/${"x".repeat(600)}`)).toMatchObject({
      error: expect.stringMatching(/trop longue/),
    });
    expect(parseEventsUrl("https://user:pw@a.co/x")).toMatchObject({
      error: expect.stringMatching(/identifiant/),
    });
    expect(parseEventsUrl("ftp://a.co/x")).toMatchObject({ error: expect.stringMatching(/https/) });
  });
});

/** Réglage corrigé : les événements en attente de leur prochain essai repartent, jamais ceux en cours d'envoi. */
describe("reprise des événements en attente", () => {
  it("avance les seuls essais prévus au-delà de 3 minutes (une réservation d'envoi dure 2 minutes), puis demande un passage", async () => {
    const now = new Date("2026-10-14T12:00:00Z");
    let args: unknown = null;
    db.updateMany = async (a) => {
      args = a;
      return { count: 2 };
    };
    db.enqueued.length = 0;
    expect(await releaseWaitingLinkaffiEvents(now)).toBe(2);
    expect(args).toEqual({
      where: { status: "PENDING", nextAttemptAt: { gt: new Date("2026-10-14T12:03:00Z") } },
      data: { nextAttemptAt: now },
    });
    expect(db.enqueued).toEqual([{ type: "tick" }]);
  });
  it("ne lève jamais : base en panne → 0", async () => {
    db.updateMany = async () => {
      throw new Error("base en panne");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await releaseWaitingLinkaffiEvents()).toBe(0);
    warn.mockRestore();
  });
  it("phrase affichée après un test reçu", () => {
    expect(releasedSentence(1)).toBe("1 événement en attente repart maintenant.");
    expect(releasedSentence(3)).toBe("3 événements en attente repartent maintenant.");
  });
});
