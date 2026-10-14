import { describe, expect, it } from "vitest";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import {
  isTutorialDismissed,
  showTutorial,
  TUTORIAL_STEPS,
  TUTORIAL_TITLE,
  tutorialKey,
} from "./tutorial";

describe("mini-tutoriel « Affiliés sur vos canaux »", () => {
  it("cinq points, en mots simples, sans terme technique", () => {
    expect(TUTORIAL_STEPS).toHaveLength(5);
    for (const s of [TUTORIAL_TITLE, ...TUTORIAL_STEPS.flatMap((x) => [x.title, x.text])]) {
      expect(jargonIn(s), s).toEqual([]);
      expect(s).not.toMatch(/\b(API|HMAC|webhook|token|secret de webhook)\b/i);
    }
    expect(TUTORIAL_STEPS[4]!.title).toMatch(/Premier affilié gagne/);
  });

  it("mémorisé par utilisateur ; affiché au premier passage ou sur demande", () => {
    expect(tutorialKey("u1")).toBe("affiliates.tutorial.u1");
    expect(isTutorialDismissed({ dismissedAt: "2026-10-14T10:00:00.000Z" })).toBe(true);
    for (const v of [null, {}, { dismissedAt: "x" }, "oui"])
      expect(isTutorialDismissed(v)).toBe(false);
    expect(showTutorial(false, undefined)).toBe(true);
    expect(showTutorial(true, undefined)).toBe(false);
    expect(showTutorial(true, "1")).toBe(true);
    expect(showTutorial(true, ["1"])).toBe(true);
  });
});
