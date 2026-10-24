import { describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { bossUnmetLines, listBossUnmet, normalizeUnmetKey, recordBossUnmet } from "./unmet";

describe("Kevin : besoins non couverts", () => {
  it("normalisation : minuscules, sans accents, sans ponctuation, espaces réduits", () => {
    expect(normalizeUnmetKey("  Fais-moi un EXPORT  des dépôts !! ")).toBe("fais moi un export des depots");
    expect(normalizeUnmetKey("Ça va, Kévin ?")).toBe("ca va kevin");
    expect(normalizeUnmetKey("?!…")).toBe("");
    expect(normalizeUnmetKey("a".repeat(500))).toHaveLength(300);
  });

  it("un même besoin compte une fois, avec le nombre de fois et la dernière date", async () => {
    const kit = createTestKit();
    expect(await recordBossUnmet(kit.deps, "Fais-moi un export !")).toEqual({ recorded: true, count: 1 });
    kit.advance(3600_000);
    expect(await recordBossUnmet(kit.deps, "fais moi un export")).toEqual({ recorded: true, count: 2 });
    await recordBossUnmet(kit.deps, "envoie un mail");
    const rows = await listBossUnmet(kit.deps, 10);
    expect(rows.map((r) => [r.key, r.count])).toEqual([
      ["fais moi un export", 2],
      ["envoie un mail", 1],
    ]);
    expect(rows[0]!.lastAt.getTime()).toBeGreaterThan(rows[0]!.firstAt.getTime());
    expect(bossUnmetLines(rows)[0]).toMatch(/^ {3}2 × fais moi un export \(dernière fois le /);
    expect(bossUnmetLines([])).toEqual(["Aucun besoin non couvert pour l'instant."]);
  });

  it("texte tronqué à 300 caractères ; vide ignoré", async () => {
    const kit = createTestKit();
    await recordBossUnmet(kit.deps, `fais ${"x".repeat(400)}`);
    expect((kit.tables("bossUnmet")[0]!.text as string).length).toBe(300);
    expect(await recordBossUnmet(kit.deps, "   ")).toEqual({ recorded: false, count: 0 });
  });

  it("un texte qui ressemble à un secret n'est JAMAIS enregistré", async () => {
    const kit = createTestKit();
    for (const t of ["clé fal sk-abcdef1234567890", "bookmaker sportaza moi@x.fr motdepasse"])
      expect((await recordBossUnmet(kit.deps, t)).recorded).toBe(false);
    expect((await recordBossUnmet(kit.deps, "sk-live-1234567890abcdefghij", { pending: { key: "providers.fal.apiKey" } })).recorded).toBe(false);
    expect(kit.tables("bossUnmet")).toHaveLength(0);
  });
});
