import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../testing/fake-prisma";
import type { ReferencePostInput } from "./contract";
import { copiedSequence } from "./copy-check";
import { purgeReferenceTexts, storeReferencePosts } from "./store";

const now = new Date("2026-10-24T12:00:00Z");
const p = (id: number, text: string | null, views: number | null = 100): ReferencePostInput => ({
  externalId: id,
  postedAt: new Date(now.getTime() - id * 3_600_000),
  text,
  mediaKind: "text",
  views,
  hasButton: false,
  linkCount: 0,
});

function kit() {
  const prisma = createFakePrisma({ referenceChannel: [{ id: "ref1", universe: "sports", via: "WEB", status: "READING", postCount: 0 }] });
  return { prisma, deps: { prisma, now: () => now }, posts: () => prisma._tables.referencePost ?? [], ref: () => prisma._tables.referenceChannel![0]! };
}

describe("rangement des posts de référence", () => {
  it("upsert par (référence, numéro) : pas de doublon, vues mises à jour, référence READY", async () => {
    const k = kit();
    const first = await storeReferencePosts(k.deps, "ref1", [p(1, "Cote 1,85 ce soir sur Lyon"), p(2, "✅ Cote passée"), p(2, "doublon dans le lot")], "WEB", { title: "Paris (exemple)" });
    expect(first).toEqual({ created: 2, updated: 0, postCount: 2 });
    const again = await storeReferencePosts(k.deps, "ref1", [p(1, "Cote 1,85 ce soir sur Lyon", 900), p(3, "nouveau")], "WEB");
    expect(again).toEqual({ created: 1, updated: 1, postCount: 3 });
    expect(k.posts()).toHaveLength(3);
    const one = k.posts().find((r) => r.externalId === 1)!;
    expect(one).toMatchObject({ views: 900, hasOdds: true, via: "WEB", mediaKind: "text" });
    expect((one.features as { odds: number[] }).odds).toEqual([1.85]);
    expect(k.posts().find((r) => r.externalId === 2)!.features).toMatchObject({ betResult: "won" });
    expect(k.ref()).toMatchObject({ status: "READY", postCount: 3, lastReadAt: now, title: "Paris (exemple)", unavailableReason: null });
    // Aucun média gardé : seules des colonnes de caractéristiques.
    expect(Object.keys(one).some((key) => /media(Url|Bytes|File)|fileId/i.test(key))).toBe(false);
  });

  it("purge à 30 jours : texte effacé, empreintes gardées (contrôle de copie encore possible), jamais réécrit", async () => {
    const k = kit();
    const text = "Analyse du soir : cote boostée sur le match de Lyon à domicile";
    await storeReferencePosts(k.deps, "ref1", [p(1, text), p(2, "récent")], "WEB");
    const rows = k.posts();
    rows[0]!.createdAt = new Date(now.getTime() - 31 * 86_400_000);
    rows[1]!.createdAt = new Date(now.getTime() - 29 * 86_400_000);
    expect(await purgeReferenceTexts(k.deps, now)).toEqual({ purged: 1 });
    expect(rows[0]).toMatchObject({ text: null, textPurgedAt: now });
    expect(rows[0]!.textHash).toBeTruthy();
    expect(copiedSequence(`Voici : ${text}`, rows[0]!.shingles as string[])).toBeTruthy();
    expect(rows[1]!.text).toBe("récent");
    expect(rows[1]!.textPurgedAt ?? null).toBeNull();
    expect(await purgeReferenceTexts(k.deps, now)).toEqual({ purged: 0 });
    // Relu plus tard : le texte effacé ne revient pas.
    await storeReferencePosts(k.deps, "ref1", [p(1, text, 5000)], "WEB");
    expect(rows[0]).toMatchObject({ text: null, views: 5000 });
  });
});
