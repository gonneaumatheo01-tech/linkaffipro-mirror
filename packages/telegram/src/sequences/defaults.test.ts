import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEQUENCE_TRIGGERS, defaultSequenceText, previewText } from "./defaults";
import { pickText, renderText } from "../join-flow/texts";

const VERTICALS = ["CASINO", "SPORTS", "DATING", null, "AUTRE"];

describe("textes par défaut des séquences", () => {
  it("existe pour chaque déclencheur et chaque univers, en français, sous 4096 caractères", () => {
    for (const v of VERTICALS) {
      for (const t of SEQUENCE_TRIGGERS) {
        const text = defaultSequenceText(v, t);
        expect(text.length).toBeGreaterThan(20);
        expect(text.length).toBeLessThan(4096);
        expect(text).toMatch(/\b(ta|tu|ton|rejoins|bienvenue|voici|c'est)\b/i);
      }
    }
  });
  it("porte les placeholders attendus", () => {
    for (const v of VERTICALS) {
      expect(defaultSequenceText(v, "JOIN_REQUEST")).toContain("{prenom}");
      expect(defaultSequenceText(v, "JOIN_REQUEST")).toContain("{canal}");
      expect(defaultSequenceText(v, "JOIN_REQUEST")).toContain("{delai}");
      expect(defaultSequenceText(v, "GATE_REMINDER")).toContain("{liste_canaux}");
      expect(defaultSequenceText(v, "GATE_SATISFIED")).toContain("{delai}");
      expect(defaultSequenceText(v, "APPROVED")).toContain("{canal}");
      expect(defaultSequenceText(v, "OFFER_REPLY")).toContain("{prenom}");
    }
  });
  it("ne promet pas de gains", () => {
    for (const v of VERTICALS)
      for (const t of SEQUENCE_TRIGGERS)
        expect(defaultSequenceText(v, t)).not.toMatch(
          /garanti[s]? de gagner|gains assurés|argent facile/i,
        );
  });
  it("se rend sans placeholder restant avec renderText et se lit avec pickText (membre > canal > fr)", () => {
    const texts = { fr: defaultSequenceText("CASINO", "APPROVED"), en: "Welcome {prenom}" };
    expect(pickText(texts, "en-US", "fr")).toBe("Welcome {prenom}");
    expect(pickText(texts, "es", "fr")).toBe(texts.fr);
    const rendered = renderText(pickText(texts, null, "fr")!, {
      prenom: "Léa",
      canal: "Casino VIP",
      delai: "dans 1 minute",
      liste_canaux: "",
      bot: "@bot",
    });
    expect(rendered).not.toMatch(/\{(prenom|canal|liste_canaux|delai|bot)\}/);
  });
  it("prévisualise avec des exemples", () => {
    const p = previewText("Salut {prenom}, {canal} {delai}");
    expect(p).toBe("Salut Léa, Casino VIP dans 10 minutes");
  });
});

const db = vi.hoisted(() => ({
  channels: new Map<string, { id: string; vertical: string | null }>(),
  sequences: [] as Array<{ id: string; channelId: string; trigger: string }>,
  steps: [] as Array<{ sequenceId: string }>,
}));
vi.mock("@linkaffipro/db", () => {
  const prisma = {
    channel: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => db.channels.get(where.id) ?? null,
      ),
      findMany: vi.fn(async () =>
        [...db.channels.values()].map((c) => ({ id: c.id, title: c.id })),
      ),
    },
    sequence: {
      findMany: vi.fn(async ({ where }: { where: { channelId: string } }) =>
        db.sequences.filter((s) => s.channelId === where.channelId),
      ),
      // Comme PostgreSQL avec l'unicité (channelId, trigger) et ON CONFLICT DO NOTHING : seules les lignes insérées reviennent.
      createManyAndReturn: vi.fn(
        async ({
          data,
          skipDuplicates,
        }: {
          data: Array<{ channelId: string; trigger: string }>;
          skipDuplicates?: boolean;
        }) => {
          const inserted: Array<{ id: string; trigger: string }> = [];
          for (const d of data) {
            if (db.sequences.some((s) => s.channelId === d.channelId && s.trigger === d.trigger)) {
              if (!skipDuplicates)
                throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
              continue;
            }
            const row = {
              id: `${d.channelId}:${d.trigger}`,
              channelId: d.channelId,
              trigger: d.trigger,
            };
            db.sequences.push(row);
            inserted.push({ id: row.id, trigger: row.trigger });
          }
          return inserted;
        },
      ),
    },
    sequenceStep: {
      createMany: vi.fn(async ({ data }: { data: Array<{ sequenceId: string }> }) => {
        db.steps.push(...data);
        return { count: data.length };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

describe("ensureDefaultSequences", () => {
  beforeEach(() => {
    db.channels.clear();
    db.sequences.length = 0;
    db.steps.length = 0;
    db.channels.set("c1", { id: "c1", vertical: "SPORTS" });
  });
  it("crée les 5 séquences manquantes puis plus rien (idempotent)", async () => {
    const { ensureDefaultSequences } = await import("./ensure");
    const first = await ensureDefaultSequences("c1");
    expect(first.created).toEqual([...SEQUENCE_TRIGGERS]);
    const second = await ensureDefaultSequences("c1");
    expect(second.created).toEqual([]);
    expect(db.sequences).toHaveLength(5);
    // Une étape par séquence créée.
    expect(db.steps).toHaveLength(5);
  });
  it("trois bots découvrent le canal au même instant : aucune séquence en double", async () => {
    const { ensureDefaultSequences } = await import("./ensure");
    const results = await Promise.all([
      ensureDefaultSequences("c1"),
      ensureDefaultSequences("c1"),
      ensureDefaultSequences("c1"),
    ]);
    expect(db.sequences).toHaveLength(5);
    expect(db.steps).toHaveLength(5);
    expect(results.flatMap((r) => r.created).sort()).toEqual([...SEQUENCE_TRIGGERS].sort());
  });
  it("ne recrée pas une séquence existante", async () => {
    db.sequences.push({ id: "old", channelId: "c1", trigger: "APPROVED" });
    const { ensureDefaultSequences } = await import("./ensure");
    const r = await ensureDefaultSequences("c1");
    expect(r.created).not.toContain("APPROVED");
    expect(r.created).toHaveLength(4);
  });
  it("ignore un canal inconnu", async () => {
    const { ensureDefaultSequences } = await import("./ensure");
    expect((await ensureDefaultSequences("zzz")).created).toEqual([]);
  });
});
