import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_SECTIONS, withBuiltinSections } from "./builtin-sections";
import { guideHeadings, guideSections } from "./sections";

const GUIDE = readFileSync(
  join(__dirname, "..", "..", "..", "..", "docs", "GUIDE-UTILISATEUR.md"),
  "utf8",
);

const MINI = "# Guide\n\n## Premiers pas\n\nTexte.\n\n## Tableau de bord\n\nAncien.\n";

describe("sections d'aide intégrées en attendant le guide", () => {
  it("insérée avant son titre `before`, avec son ancre", () => {
    const out = withBuiltinSections(MINI, [
      { title: "Accueil", before: "Tableau de bord", markdown: "## Accueil\n\nNouveau." },
    ]);
    expect(guideHeadings(out).map((h) => h.text)).toEqual([
      "Guide",
      "Premiers pas",
      "Accueil",
      "Tableau de bord",
    ]);
    const [s] = guideSections(out, ["Accueil"]);
    expect(s).toMatchObject({ id: "accueil", markdown: "## Accueil\n\nNouveau." });
  });

  it("à la fin si le titre `before` manque", () => {
    const out = withBuiltinSections(MINI, [
      { title: "Accueil", before: "Introuvable", markdown: "## Accueil\n\nNouveau." },
    ]);
    expect(guideHeadings(out).at(-1)?.text).toBe("Accueil");
    expect(out.endsWith("## Accueil\n\nNouveau.\n")).toBe(true);
  });

  it("le guide prime : une section qu'il contient déjà n'est pas ajoutée (accents et casse ignorés)", () => {
    const guide = `${MINI}\n## ACCUEIL\n\nTexte du guide.\n`;
    expect(
      withBuiltinSections(guide, [{ title: "Accueil", markdown: "## Accueil\n\nNouveau." }]),
    ).toBe(guide);
  });

  it("guide réel : seules les sections qu'il n'a pas encore sont ajoutées, une seule fois chacune", () => {
    const out = withBuiltinSections(GUIDE);
    const missing = BUILTIN_SECTIONS.filter(
      (b) => !guideHeadings(GUIDE).some((h) => h.text === b.title),
    );
    if (missing.length === 0) expect(out).toBe(GUIDE);
    for (const b of BUILTIN_SECTIONS)
      expect(
        guideHeadings(out).filter((h) => h.text === b.title),
        b.title,
      ).toHaveLength(1);
    // Le texte du guide est gardé tel quel autour des sections ajoutées.
    let rest = out;
    for (const b of missing) rest = rest.replace(`${b.markdown.trim()}\n\n`, "");
    expect(rest).toBe(GUIDE);
    expect(guideHeadings(GUIDE).filter((h) => h.text === "Accueil")).toHaveLength(1);
  });

  it("phase 13 : « Affiliés sur vos canaux », juste avant Canaux, avec les cinq points du mode d'emploi", () => {
    const out = withBuiltinSections(GUIDE);
    const titles = guideHeadings(out)
      .filter((h) => h.level === 2)
      .map((h) => h.text);
    expect(titles.indexOf("Affiliés sur vos canaux")).toBe(titles.indexOf("Canaux") - 1);
    const [s] = guideSections(out, ["Affiliés sur vos canaux"]);
    expect(s!.markdown.match(/^\d\. /gm)).toHaveLength(5);
    expect(s!.markdown).toContain("Premier affilié gagne");
  });

  it("textes intégrés : titre de niveau 2 identique au titre déclaré, mots du client (aucun jargon)", () => {
    const JARGON =
      /\b(FTD|NGR|sub-?ID|ROAS|CPL|CPA|webhook|postback|Dating|cohorte|entonnoir|segment|Tableau de bord)\b/i;
    for (const b of BUILTIN_SECTIONS) {
      expect(b.markdown.split("\n")[0]).toBe(`## ${b.title}`);
      expect(b.markdown).not.toMatch(JARGON);
      // Vouvoiement : jamais de tutoiement.
      expect(b.markdown).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i);
    }
  });
});
