import { describe, expect, it } from "vitest";
import { VERTICALS } from "@linkaffipro/core";
import { STATUS_DICT } from "./status-badges";
import { UNIVERSES, UNIVERSE_LABELS, toUniverse, universeClasses, universeLabel } from "./universe";

describe("univers (libellés et couleurs)", () => {
  it("couvre exactement les univers du modèle de données", () => {
    expect([...UNIVERSES]).toEqual([...VERTICALS]);
  });

  it("utilise les mots du client", () => {
    expect(UNIVERSE_LABELS).toEqual({
      CASINO: "Casino",
      SPORTS: "Paris sportifs",
      DATING: "Rencontres",
    });
  });

  it("a les mêmes libellés que les badges de statut", () => {
    for (const u of UNIVERSES) expect(UNIVERSE_LABELS[u]).toBe(STATUS_DICT.vertical[u].label);
  });

  it("reconnaît les valeurs quelle que soit la casse, et rien d'autre", () => {
    expect(toUniverse("CASINO")).toBe("CASINO");
    expect(toUniverse("sports")).toBe("SPORTS");
    expect(toUniverse(" Dating ")).toBe("DATING");
    expect(toUniverse("poker")).toBeNull();
    expect(toUniverse(null)).toBeNull();
    expect(toUniverse(undefined)).toBeNull();
    expect(toUniverse(3)).toBeNull();
  });

  it("donne un libellé de repli sans univers", () => {
    expect(universeLabel("DATING")).toBe("Rencontres");
    expect(universeLabel(null)).toBe("Sans univers");
    expect(universeLabel("inconnu")).toBe("Sans univers");
  });

  it("donne des classes de pastille, de texte et de bordure, jamais de fond plein de surface", () => {
    expect(universeClasses("CASINO")).toEqual({
      dot: "bg-casino",
      ink: "text-casino-ink",
      border: "border-casino/40",
    });
    expect(universeClasses("SPORTS").dot).toBe("bg-sports");
    expect(universeClasses("DATING").ink).toBe("text-dating-ink");
    // Sans univers : gris neutre.
    expect(universeClasses(null)).toEqual({
      dot: "bg-muted-foreground/50",
      ink: "text-muted-foreground",
      border: "border-border",
    });
  });
});
