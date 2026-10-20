import { describe, expect, it } from "vitest";
import { inventedNumbers } from "./validate";

describe("chiffres inventés", () => {
  it("« h24 » n'est pas un nombre inventé", () => {
    expect(inventedNumbers("jsuis h24 dessus", [])).toEqual([]);
  });

  it("un vrai nombre reste refusé", () => {
    expect(inventedNumbers("jsuis dispo depuis 24 mois", [])).toEqual(["24"]);
  });
});
