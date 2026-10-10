import { describe, expect, it } from "vitest";
import { evaluateSubIdHealth } from "@linkaffipro/linkaffi";
import { subIdHealthView } from "./sub-id-view";

const JARGON = /postback|sub-id|lovable/i;

describe("santé de l'identifiant de suivi en français simple", () => {
  it("suit l'état calculé par Link Affi, sans jargon", () => {
    const cases = [
      {
        counts: { postback: 4, timeMatch: 0, missingWithClicks: 0, offerClicks: 20 },
        tone: "success",
      },
      {
        counts: { postback: 0, timeMatch: 9, missingWithClicks: 0, offerClicks: 20 },
        tone: "danger",
      },
      {
        counts: { postback: 0, timeMatch: 2, missingWithClicks: 0, offerClicks: 20 },
        tone: "warning",
      },
      {
        counts: { postback: 1, timeMatch: 0, missingWithClicks: 5, offerClicks: 20 },
        tone: "warning",
      },
      {
        counts: { postback: 0, timeMatch: 0, missingWithClicks: 0, offerClicks: 0 },
        tone: "muted",
      },
    ] as const;
    for (const c of cases) {
      const v = subIdHealthView(evaluateSubIdHealth(c.counts));
      expect(v.tone).toBe(c.tone);
      expect(v.sentence).not.toMatch(JARGON);
      expect(v.title).not.toMatch(JARGON);
    }
  });

  it("distingue les deux cas « à surveiller »", () => {
    const none = subIdHealthView(
      evaluateSubIdHealth({ postback: 0, timeMatch: 2, missingWithClicks: 0, offerClicks: 9 }),
    );
    const many = subIdHealthView(
      evaluateSubIdHealth({ postback: 1, timeMatch: 0, missingWithClicks: 5, offerClicks: 9 }),
    );
    expect(none.sentence).toMatch(/Aucun joueur/);
    expect(many.sentence).toMatch(/Beaucoup de joueurs/);
    expect(many.alert).toBe("warning");
  });
});
