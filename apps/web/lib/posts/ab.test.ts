import { describe, expect, it } from "vitest";
import { clampAbDelay, planVariants, variantScheduledAt, type AbFormPart } from "./ab";

const a = { channelId: "c1", text: "A", mediaAssetIds: [], buttons: [] };
const off: AbFormPart = {
  abEnabled: false,
  abMode: "same-channel",
  abDelayMinutes: 30,
  textB: "",
  mediaAssetIdsB: [],
  buttonsB: [],
};

describe("découpage A/B du formulaire de message", () => {
  it("sans test : une seule variante A sans décalage", () => {
    expect(planVariants(a, off)).toEqual([{ variant: "A", ...a, offsetMinutes: 0 }]);
  });
  it("même canal : B 30 minutes après A, par défaut", () => {
    const plan = planVariants(a, {
      ...off,
      abEnabled: true,
      textB: "B",
      buttonsB: [[{ text: "x", type: "URL", url: "https://e.x" }]],
    });
    expect(plan).toHaveLength(2);
    expect(plan[1]).toMatchObject({ variant: "B", channelId: "c1", text: "B", offsetMinutes: 30 });
    expect(plan[1]!.buttons[0]![0]!.text).toBe("x");
  });
  it("autre canal : même heure, canal choisi", () => {
    const plan = planVariants(a, {
      ...off,
      abEnabled: true,
      abMode: "other-channel",
      abChannelId: "c2",
      textB: "B",
    });
    expect(plan[1]).toMatchObject({ variant: "B", channelId: "c2", offsetMinutes: 0 });
  });
  it("refuse une version B vide, un autre canal manquant ou identique", () => {
    expect(() => planVariants(a, { ...off, abEnabled: true })).toThrow(/version B/);
    expect(() =>
      planVariants(a, { ...off, abEnabled: true, abMode: "other-channel", textB: "B" }),
    ).toThrow(/choisissez le canal/);
    expect(() =>
      planVariants(a, {
        ...off,
        abEnabled: true,
        abMode: "other-channel",
        abChannelId: "c1",
        textB: "B",
      }),
    ).toThrow(/différent/);
  });
  it("accepte une version B avec média seul", () => {
    const plan = planVariants(a, { ...off, abEnabled: true, mediaAssetIdsB: ["m1"] });
    expect(plan[1]).toMatchObject({ variant: "B", mediaAssetIds: ["m1"], text: "" });
  });
  it("borne le délai et décale la date", () => {
    expect(clampAbDelay(2)).toBe(5);
    expect(clampAbDelay(5000)).toBe(1440);
    expect(clampAbDelay(Number.NaN)).toBe(30);
    expect(
      planVariants(a, { ...off, abEnabled: true, textB: "B", abDelayMinutes: 90 })[1]!
        .offsetMinutes,
    ).toBe(90);
    expect(variantScheduledAt(new Date("2026-10-09T10:00:00Z"), 30)!.toISOString()).toBe(
      "2026-10-09T10:30:00.000Z",
    );
    expect(variantScheduledAt(null, 30)).toBeNull();
  });
});
