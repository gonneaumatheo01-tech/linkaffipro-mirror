import { describe, expect, it } from "vitest";
import { actionsFromForm, conditionsFromForm } from "./form";

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("formulaire d'automatisation", () => {
  it("lit les conditions", () => {
    const c = conditionsFromForm(fd([["channelIds", "c1"], ["channelIds", "c2"], ["languages", "fr, en"], ["inactiveDays", "7"], ["spendLevels", "VIP"]]));
    expect(c).toEqual({ channelIds: ["c1", "c2"], languages: ["fr", "en"], inactiveDays: 7, spendLevels: ["VIP"] });
  });
  it("lit les actions dans l'ordre et ignore les lignes vides", () => {
    const a = actionsFromForm(fd([["a0_type", "send_message"], ["a0_text", "Salut"], ["a0_buttons", "Voir | https://x.y\n"], ["a1_type", ""], ["a2_type", "wait"], ["a2_hours", "2"], ["a3_type", "tag"], ["a3_tag", "ok"]]));
    expect(a.map((x) => x.type)).toEqual(["send_message", "wait", "tag"]);
    expect(a[0]).toMatchObject({ buttons: [[{ text: "Voir", url: "https://x.y" }]] });
  });
  it("exige au moins une action", () => {
    expect(() => actionsFromForm(fd([]))).toThrow(/au moins une action/);
  });
});
