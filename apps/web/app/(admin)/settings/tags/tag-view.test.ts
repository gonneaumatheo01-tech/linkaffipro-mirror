import { describe, expect, it } from "vitest";
import { fmtNum } from "@/lib/format";
import { deleteTagMessage, memberCountLabel, membersWithTagHref } from "./tag-view";

describe("Réglages → Étiquettes : textes", () => {
  it("compte de membres au singulier et au pluriel", () => {
    expect(memberCountLabel(0)).toBe("Aucun membre");
    expect(memberCountLabel(1)).toBe("1 membre");
    expect(memberCountLabel(1240)).toBe(`${fmtNum(1240)} membres`);
  });

  it("confirmation de suppression : dit combien de membres perdent l'étiquette", () => {
    expect(deleteTagMessage("VIP", 3)).toBe(
      "L'étiquette « VIP » sera supprimée et retirée de 3 membres. Les membres eux-mêmes ne sont pas touchés.",
    );
    expect(deleteTagMessage("Test", 0)).toBe(
      "L'étiquette « Test » sera supprimée. Aucun membre ne la porte.",
    );
  });

  it("lien vers les membres qui portent l'étiquette (nom encodé)", () => {
    expect(membersWithTagHref("VIP")).toBe("/members?tag=VIP");
    expect(membersWithTagHref("À relancer")).toBe("/members?tag=%C3%80+relancer");
  });
});
