import { describe, expect, it } from "vitest";
import { inputClassName } from "./input";

const classes = (s: string) => s.split(/\s+/);

describe("Input : bouton de fichier", () => {
  it("donne au bouton du navigateur l'allure d'un bouton secondaire", () => {
    const c = classes(inputClassName("file"));
    expect(c).toEqual(
      expect.arrayContaining([
        "file:bg-secondary",
        "file:text-secondary-foreground",
        "file:border",
        "file:border-input",
        "file:rounded-md",
        "file:px-3",
        "file:font-medium",
        "file:cursor-pointer",
        "file:h-7",
        "max-md:file:h-8",
      ]),
    );
    // Plus de bouton transparent sans bordure (simple texte gras).
    expect(c).not.toContain("file:bg-transparent");
    expect(c).not.toContain("file:border-0");
  });

  it("rend tout le champ cliquable et garde la hauteur des autres champs", () => {
    const c = classes(inputClassName("file"));
    expect(c).toEqual(
      expect.arrayContaining(["cursor-pointer", "pl-1", "py-0.5", "h-9", "max-md:h-10"]),
    );
    // `py-0.5` remplace `py-1` ; `pl-1` affine seulement la gauche de `px-3` (écrit après par Tailwind).
    expect(c).not.toContain("py-1");
  });

  it("ne change rien aux autres champs, et les classes de l'écran gagnent", () => {
    const text = classes(inputClassName("text"));
    expect(text).not.toContain("cursor-pointer");
    expect(text).toEqual(expect.arrayContaining(["px-3", "py-1"]));
    expect(classes(inputClassName(undefined, "font-mono"))).toContain("font-mono");
    expect(classes(inputClassName("file", "pl-3"))).toContain("pl-3");
  });
});
