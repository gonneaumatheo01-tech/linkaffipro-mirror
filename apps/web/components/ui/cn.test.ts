import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn (fusion des classes avec les jetons du thème)", () => {
  it("garde une taille de texte du thème à côté d'une couleur", () => {
    expect(cn("text-note text-muted-foreground")).toBe("text-note text-muted-foreground");
    expect(cn("text-title", "text-brand-ink")).toBe("text-title text-brand-ink");
    expect(cn("text-figure tabular-nums", "text-success")).toBe(
      "text-figure tabular-nums text-success",
    );
  });

  it("remplace une taille par une autre (la dernière gagne)", () => {
    expect(cn("text-sm", "text-note")).toBe("text-note");
    expect(cn("text-body", "text-title")).toBe("text-title");
    expect(cn("text-title", "text-base")).toBe("text-base");
  });

  it("remplace une couleur par une autre sans toucher la taille", () => {
    expect(cn("text-body text-foreground", "text-danger")).toBe("text-body text-danger");
  });

  it("accepte les conditions comme clsx", () => {
    expect(cn("px-2", false && "px-4", { "font-medium": true }, ["text-note"])).toBe(
      "px-2 font-medium text-note",
    );
  });
});
