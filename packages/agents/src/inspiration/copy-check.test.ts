import { describe, expect, it } from "vitest";
import { copiedSequence, shingleHashes, shortQuote, textHash } from "./copy-check";

describe("jamais de copie (8 mots consécutifs)", () => {
  const ref = "🔥 Cote boostée ce soir sur le PSG, écris-moi en DM pour le VIP, places limitées !";
  const hashes = shingleHashes(ref);
  it("8 mots consécutifs repris (casse, accents et ponctuation ignorés) → copie", () => {
    expect(copiedSequence("Ce soir : cote boostée ce soir sur le psg ecris moi en dm pour gagner", hashes)).toBeTruthy();
  });
  it("7 mots repris → pas une copie ; texte écrit à neuf → pas une copie", () => {
    expect(copiedSequence("cote boostée ce soir sur le PSG, on en parle demain", hashes)).toBeNull();
    expect(copiedSequence("Match du soir : notre analyse et la cote du jour en bas.", hashes)).toBeNull();
  });
  it("empreinte stable, citation coupée à 10 mots", () => {
    expect(textHash("Bonjour, le MONDE !")).toBe(textHash("bonjour le monde"));
    expect(shortQuote("un deux trois quatre cinq six sept huit neuf dix onze douze")).toBe("un deux trois quatre cinq six sept huit neuf dix …");
  });
});
