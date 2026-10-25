import { describe, expect, it } from "vitest";
import { sideOf } from "./mapping";

const TEAMS = { homeTeam: "PSG", awayTeam: "OM" };

describe("relecture adverse : sélection « N+ »", () => {
  it("« 9+ » n'est jamais lu comme « plus de 9 » (mauvaise ligne) ; « Plus de 9,5 » reste lu", () => {
    expect(sideOf("9+", { selectionMap: {} } as never, TEAMS)).toBeNull();
    expect(sideOf("Plus de 9,5", { selectionMap: {} } as never, TEAMS)).toBe("over");
    expect(sideOf("9+", { selectionMap: { "9+": "over" } } as never, TEAMS)).toBe("over");
  });
});
