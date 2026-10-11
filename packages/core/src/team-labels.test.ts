import { describe, expect, it } from "vitest";
import {
  ALERT_KIND_LABELS,
  LINKAFFI_TABLE_LABELS,
  QUEUE_LABELS,
  alertKindLabel,
  linkAffiTableLabel,
  queueLabel,
} from "./team-labels";
import { VERTICAL_LABELS } from "./constants";

/** Mots techniques interdits en surface (docs/REFONTE-UX.md, « Vocabulaire »). */
const JARGON =
  /postback|webhook|sub[-_ ]?id|\bngr\b|\bftd\b|\bcpa\b|\bcpl\b|\broas\b|worker|segment|séquence|automatisation|cohorte|entonnoir|dating/i;

describe("libellés montrés à l'équipe", () => {
  it("aucun libellé ne contient de jargon", () => {
    for (const labels of [ALERT_KIND_LABELS, LINKAFFI_TABLE_LABELS, QUEUE_LABELS, VERTICAL_LABELS])
      for (const [key, label] of Object.entries(labels)) {
        expect(label, key).toBeTruthy();
        expect(label, key).not.toMatch(JARGON);
      }
  });

  it("un code inconnu garde un libellé lisible, jamais le code", () => {
    expect(alertKindLabel("bot_webhook")).toBe("Bot en difficulté");
    expect(alertKindLabel("nouveau_type")).toBe("Autre alerte");
    expect(linkAffiTableLabel("players")).toBe("Joueurs");
    expect(linkAffiTableLabel("x")).toBe("Autre donnée Link Affi");
    expect(queueLabel("telegram-send")).toBe("Envois Telegram");
    expect(queueLabel("inconnue")).toBe("Autre file");
  });

  it("univers : Casino, Paris sportifs, Rencontres", () => {
    expect(VERTICAL_LABELS).toEqual({
      CASINO: "Casino",
      SPORTS: "Paris sportifs",
      DATING: "Rencontres",
    });
  });
});
