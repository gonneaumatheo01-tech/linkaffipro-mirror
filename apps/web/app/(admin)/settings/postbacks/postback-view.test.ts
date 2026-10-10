import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "@/lib/postback/parse";
import {
  EVENT_TYPE_LABELS,
  eventOptionLabel,
  importSummary,
  receivedSummary,
} from "./postback-view";

describe("Retours du casino : affichage", () => {
  it("chaque type d'événement a un libellé en français courant", () => {
    for (const t of EVENT_TYPES) expect(EVENT_TYPE_LABELS[t]).toBeTruthy();
    expect(EVENT_TYPE_LABELS.FTD).toBe("premier dépôt");
    expect(EVENT_TYPE_LABELS.NGR).toBe("revenu net");
  });

  it("option du test : valeur reçue → ce qu'elle devient", () => {
    expect(eventOptionLabel("registration", "REGISTRATION")).toBe("registration → inscription");
    expect(eventOptionLabel("ftd", "FTD")).toBe("ftd → premier dépôt");
    expect(eventOptionLabel("x", "INCONNU")).toBe("x → inconnu");
  });

  it("résumé des retours reçus par adresse", () => {
    expect(receivedSummary(0, null)).toBe("Aucun retour reçu pour l'instant");
    expect(receivedSummary(1, null)).toBe("1 retour reçu");
    expect(receivedSummary(12, new Date("2026-10-09T12:05:00.000Z"))).toMatch(
      /^12 retours reçus · dernier le 09\/10\/2026 14:05$/,
    );
  });

  it("résumé d'un import de joueurs", () => {
    expect(importSummary({ rows: 120, imported: 118, errors: ["a", "b"] })).toBe(
      "120 lignes · 118 importées · 2 erreurs",
    );
    expect(importSummary({ rows: 1, imported: 1, errors: null })).toBe(
      "1 ligne · 1 importée · 0 erreur",
    );
  });
});
