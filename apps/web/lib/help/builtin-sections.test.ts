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

  it("le guide réel contient déjà tout : il est rendu tel quel", () => {
    expect(withBuiltinSections(GUIDE)).toBe(GUIDE);
    expect(guideHeadings(GUIDE).filter((h) => h.text === "Accueil")).toHaveLength(1);
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
