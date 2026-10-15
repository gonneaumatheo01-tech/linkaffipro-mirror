import { describe, expect, it } from "vitest";
import { hashTargets } from "./scroll-to-hash";

describe("retour sur les chiffres après « Appliquer »", () => {
  it("seulement quand l'adresse vise ce bloc", () => {
    expect(hashTargets("#chiffres", "chiffres")).toBe(true);
    expect(hashTargets("", "chiffres")).toBe(false);
    expect(hashTargets("#autre", "chiffres")).toBe(false);
  });
});
