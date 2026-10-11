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
const usage = vi.hoisted(() => vi.fn(async (..._texts: unknown[]) => 1));
vi.mock("@/lib/custom-emoji/usage", () => ({ markCustomEmojisUsed: usage }));
vi.mock("@linkaffipro/telegram", () => ({
  ensureDefaultSequences: vi.fn(async () => undefined),
  previewText: (t: string) => t,
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    sequence: {
      findFirst: vi.fn(async () => ({ id: "seq1", isActive: true, steps: [db.step] })),
      update: vi.fn(async () => ({})),
    },
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

import {
  saveSequenceTextAction,
  saveSequenceTranslationsAction,
  toggleSequenceAction,
} from "./actions";

beforeEach(() => {
  usage.mockClear();
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

/** Adresse de retour d'une action serveur (le `redirect` simulé lève une erreur portant l'adresse). */
async function redirectOf(run: () => Promise<unknown>): Promise<URLSearchParams> {
  try {
    await run();
  } catch (err) {
    const url = (err as { url?: string }).url ?? "";
    return new URLSearchParams(url.split("?")[1] ?? "");
  }
  throw new Error("pas de redirection");
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

describe("textes du bot : retour vers la bonne carte et la bonne langue", () => {
  it("après un enregistrement, la carte reste ouverte sur la langue modifiée", async () => {
    const q = await redirectOf(() =>
      saveSequenceTextAction(
        form({ channelId: "ch1", trigger: "APPROVED", lang: "en", text: "Hello {prenom}" }),
      ),
    );
    expect(q.get("tab")).toBe("sequences");
    expect(q.get("open")).toBe("APPROVED");
    expect(q.get("lang")).toBe("en");
    expect(q.get("ok")).toMatch(/EN enregistré/);
    expect(db.step.texts.en).toBe("Hello {prenom}");
  });

  it("le français n'ajoute pas de langue à l'adresse", async () => {
    const q = await redirectOf(() =>
      saveSequenceTextAction(
        form({ channelId: "ch1", trigger: "APPROVED", lang: "fr", text: "Salut" }),
      ),
    );
    expect(q.get("open")).toBe("APPROVED");
    expect(q.has("lang")).toBe(false);
  });

  it("depuis l'aperçu (mode=view), la carte reste en aperçu", async () => {
    const q = await redirectOf(() =>
      toggleSequenceAction(form({ channelId: "ch1", trigger: "APPROVED", mode: "view" })),
    );
    expect(q.has("open")).toBe(false);
    expect(q.get("ok")).toMatch(/désactivé/);
    expect(db.audits.at(-1)).toMatchObject({ action: "sequence.deactivated" });
  });
});

describe("emojis animés dans les messages du bot (phase 12)", () => {
  const EMOJI = '<tg-emoji emoji-id="5368324170671202286">🎉</tg-emoji>';

  it("texte enregistré avec sa balise, emoji noté comme utilisé", async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      channelId: "ch1",
      trigger: "APPROVED",
      lang: "fr",
      text: `Bienvenue {prenom} ${EMOJI}`,
    }))
      fd.append(k, v);
    await saveSequenceTextAction(fd).catch((e: { url?: string }) => {
      if (!e.url) throw e;
    });
    expect(db.step.texts.fr).toBe(`Bienvenue {prenom} ${EMOJI}`);
    expect(usage).toHaveBeenCalledWith(`Bienvenue {prenom} ${EMOJI}`);
  });

  it("traductions de l'assistant : balises gardées, emojis notés comme utilisés", async () => {
    const r = await saveSequenceTranslationsAction({
      channelId: "ch1",
      trigger: "APPROVED",
      texts: { en: `Welcome ${EMOJI}` },
    });
    expect(r).toEqual({ ok: true, saved: ["en"] });
    expect(db.step.texts.en).toBe(`Welcome ${EMOJI}`);
    expect(usage).toHaveBeenCalledWith([`Welcome ${EMOJI}`]);
  });
});
