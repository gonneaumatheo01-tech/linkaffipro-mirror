import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  step: { id: "st1", texts: { fr: "Bonjour {prenom}" } as Record<string, string> },
  audits: [] as Array<Record<string, unknown>>,
  updates: 0,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "u1",
    role: "MANAGER",
    telegramUserId: null,
    name: "Test",
  })),
}));
vi.mock("@linkaffipro/queue", () => ({ enqueueDm: vi.fn() }));
vi.mock("@linkaffipro/telegram", () => ({
  ensureDefaultSequences: vi.fn(async () => undefined),
  previewText: (t: string) => t,
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    sequence: { findFirst: vi.fn(async () => ({ id: "seq1", isActive: true, steps: [db.step] })) },
    sequenceStep: {
      create: vi.fn(),
      update: vi.fn(async ({ data }: { data: { texts: Record<string, string> } }) => {
        db.updates++;
        db.step.texts = { ...data.texts };
      }),
    },
  },
  audit: vi.fn(async (a: Record<string, unknown>) => {
    db.audits.push(a);
  }),
}));

import { saveSequenceTranslationsAction } from "./actions";

beforeEach(() => {
  db.step = { id: "st1", texts: { fr: "Bonjour {prenom}" } };
  db.audits = [];
  db.updates = 0;
});

describe("textes du bot : enregistrer les traductions de l'assistant IA", () => {
  it("ajoute ou remplace les langues reçues, sans toucher au français, et journalise", async () => {
    db.step.texts.en = "Old";
    const r = await saveSequenceTranslationsAction({
      channelId: "ch1",
      trigger: "APPROVED",
      texts: { en: "Hello <b>{prenom}</b>", es: "Hola {prenom}" },
    });
    expect(r).toEqual({ ok: true, saved: ["en", "es"] });
    expect(db.step.texts).toEqual({
      fr: "Bonjour {prenom}",
      en: "Hello <b>{prenom}</b>",
      es: "Hola {prenom}",
    });
    expect(db.audits[0]).toMatchObject({
      action: "sequence.translations_saved",
      entityId: "seq1",
      metadata: { trigger: "APPROVED", langs: ["en", "es"] },
    });
  });
  it("refuse une langue inconnue ou un HTML invalide, sans rien enregistrer", async () => {
    expect(
      (
        await saveSequenceTranslationsAction({
          channelId: "ch1",
          trigger: "APPROVED",
          texts: { xx: "?" },
        })
      ).ok,
    ).toBe(false);
    const bad = await saveSequenceTranslationsAction({
      channelId: "ch1",
      trigger: "APPROVED",
      texts: { en: "<div>non</div>" },
    });
    expect(bad.ok).toBe(false);
    expect(db.updates).toBe(0);
  });
  it("refuse un déclencheur inconnu, une liste vide et un français vide", async () => {
    expect(
      (
        await saveSequenceTranslationsAction({
          channelId: "ch1",
          trigger: "AUTRE" as never,
          texts: { en: "Hi" },
        })
      ).ok,
    ).toBe(false);
    expect(
      (await saveSequenceTranslationsAction({ channelId: "ch1", trigger: "APPROVED", texts: {} }))
        .ok,
    ).toBe(false);
    expect(
      (
        await saveSequenceTranslationsAction({
          channelId: "ch1",
          trigger: "APPROVED",
          texts: { fr: "  " },
        })
      ).ok,
    ).toBe(false);
    expect(db.updates).toBe(0);
  });
});
