import { describe, expect, it } from "vitest";
import { AI_LABELS } from "@linkaffipro/ai/types";
import { toAiLanguage } from "@/components/ai/improve-logic";
import { SEQUENCE_LANGS } from "./langs";

describe("textes du bot : langues de l'assistant IA", () => {
  it("chaque langue proposée pour les textes du bot est gérée par l'assistant (jamais de repli en français)", () => {
    // Sinon, sous le champ russe, l'IA écrirait en français et « Utiliser » mettrait ce français dans le champ russe.
    for (const lang of SEQUENCE_LANGS) {
      expect(toAiLanguage(lang)).toBe(lang);
      expect(AI_LABELS.language[toAiLanguage(lang)]).toBeTruthy();
    }
  });
});
