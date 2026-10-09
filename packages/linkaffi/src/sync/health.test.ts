import { describe, expect, it } from "vitest";
import { evaluateSubIdHealth, SUB_ID_ALERT_MESSAGE } from "./health";

describe("santé du sub-ID", () => {
  it("alerte quand aucun postback et plus de 5 time_match", () => {
    const h = evaluateSubIdHealth({ postback: 0, timeMatch: 6, missingWithClicks: 0, offerClicks: 40 });
    expect(h.status).toBe("alert");
    expect(h.message).toBe(SUB_ID_ALERT_MESSAGE);
  });
  it("n'alerte pas à 5 time_match ou moins", () => {
    expect(evaluateSubIdHealth({ postback: 0, timeMatch: 5, missingWithClicks: 0, offerClicks: 10 }).status).toBe("warning");
  });
  it("est inactif sans aucun clic ni joueur", () => {
    expect(evaluateSubIdHealth({ postback: 0, timeMatch: 0, missingWithClicks: 0, offerClicks: 0 }).status).toBe("idle");
  });
  it("est ok quand des postbacks arrivent", () => {
    expect(evaluateSubIdHealth({ postback: 3, timeMatch: 1, missingWithClicks: 1, offerClicks: 50 }).status).toBe("ok");
  });
  it("avertit quand les joueurs sans sub-ID dominent", () => {
    expect(evaluateSubIdHealth({ postback: 2, timeMatch: 0, missingWithClicks: 9, offerClicks: 50 }).status).toBe("warning");
  });
});
