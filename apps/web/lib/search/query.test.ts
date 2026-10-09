import { describe, expect, it } from "vitest";
import { parseSearchQuery, snippet } from "./query";

describe("parseSearchQuery", () => {
  it("nettoie les espaces et met en minuscules", () => {
    const q = parseSearchQuery("  Bonus   Week-End ");
    expect(q.raw).toBe("Bonus Week-End");
    expect(q.terms).toEqual(["bonus", "week-end"]);
    expect(q.empty).toBe(false);
  });
  it("reconnaît un pseudo Telegram", () => {
    const q = parseSearchQuery("@Jean_Dupont");
    expect(q.username).toBe("jean_dupont");
    expect(q.terms).toEqual(["jean_dupont"]);
  });
  it("reconnaît un identifiant Telegram", () => {
    const q = parseSearchQuery("123456789");
    expect(q.telegramUserId).toBe(123456789n);
    expect(parseSearchQuery("1234").telegramUserId).toBeNull();
  });
  it("considère vide une requête trop courte ou absente", () => {
    expect(parseSearchQuery("").empty).toBe(true);
    expect(parseSearchQuery("a").empty).toBe(true);
    expect(parseSearchQuery(undefined).empty).toBe(true);
    expect(parseSearchQuery("   ").empty).toBe(true);
  });
  it("limite la longueur et le nombre de mots", () => {
    const q = parseSearchQuery("a".repeat(200));
    expect(q.raw.length).toBe(80);
    expect(parseSearchQuery("un deux trois quatre cinq six sept huit").terms).toHaveLength(6);
  });
  it("retire les caractères de contrôle", () => {
    expect(parseSearchQuery("bon\u0000jour").raw).toBe("bon jour");
  });
});

describe("snippet", () => {
  it("retire le HTML et centre sur le premier mot trouvé", () => {
    const s = snippet("<b>Bienvenue</b> à tous. Le bonus du week-end est arrivé, profitez-en vite.", ["bonus"], 30);
    expect(s).not.toContain("<b>");
    expect(s).toContain("bonus");
  });
  it("tronque au début quand rien n'est trouvé", () => {
    expect(snippet("un texte court", ["zzz"])).toBe("un texte court");
    expect(snippet("x".repeat(100), ["zzz"], 10)).toBe("xxxxxxxxxx…");
  });
});
