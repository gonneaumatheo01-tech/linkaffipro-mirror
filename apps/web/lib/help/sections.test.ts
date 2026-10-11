import { describe, expect, it } from "vitest";
import { extractHeadings, renderMarkdown } from "./markdown";
import {
  findHeading,
  guideHeadings,
  guideSections,
  withoutSections,
  withoutTitle,
} from "./sections";

const MD = [
  "# Guide",
  "",
  "## Les 10 premières minutes",
  "Intro.",
  "### 1. Se connecter",
  "Ouvrez le site.",
  "## Réglages",
  "Le menu Réglages.",
  "### Équipe",
  "Inviter.",
  "```",
  "## pas un titre",
  "```",
  "### Équipe",
  "Doublon.",
  "## Mon compte",
  "Voir [la suite](#reglages).",
].join("\n");

describe("sections du guide", () => {
  it("titres hors blocs de code, ancres uniques comme la page /help", () => {
    const h = guideHeadings(MD);
    expect(h.map((x) => [x.level, x.id])).toEqual([
      [1, "guide"],
      [2, "les-10-premieres-minutes"],
      [3, "1-se-connecter"],
      [2, "reglages"],
      [3, "equipe"],
      [3, "equipe-2"],
      [2, "mon-compte"],
    ]);
    // Mêmes ancres que le rendu complet du guide.
    const html = renderMarkdown(MD);
    for (const x of h) expect(html).toContain(`id="${x.id}"`);
    // Sans bloc de code, mêmes ancres qu'extractHeadings (sommaire de /help).
    const plain = MD.replace(/```\n## pas un titre\n```\n/, "");
    expect(guideHeadings(plain).map((x) => x.id)).toEqual(extractHeadings(plain).map((x) => x.id));
  });

  it("titre retrouvé sans tenir compte des accents ni de la ponctuation", () => {
    const h = guideHeadings(MD);
    expect(findHeading(h, "Reglages")?.id).toBe("reglages");
    expect(findHeading(h, "les 10 premieres minutes !")?.id).toBe("les-10-premieres-minutes");
    expect(findHeading(h, "Inconnu")).toBeNull();
  });

  it("une section va jusqu'au prochain titre de même niveau, sous-sections comprises", () => {
    const [s] = guideSections(MD, ["Réglages"]);
    expect(s!.id).toBe("reglages");
    expect(s!.level).toBe(2);
    expect(s!.markdown).toContain("### Équipe");
    expect(s!.markdown).toContain("Doublon.");
    expect(s!.markdown).toContain("## pas un titre"); // dans le bloc de code
    expect(s!.markdown).not.toContain("Mon compte");
  });

  it("introOnly : le texte avant la première sous-section ; ordre des références ; inconnues ignorées", () => {
    const out = guideSections(MD, [
      "Mon compte",
      { title: "Réglages", introOnly: true },
      "Inconnu",
      "mon compte",
    ]);
    expect(out.map((s) => s.id)).toEqual(["mon-compte", "reglages"]);
    expect(out[1]!.markdown).toBe("## Réglages\nLe menu Réglages.");
  });
});

describe("guide sans certaines sections (page /help)", () => {
  it("retire la section et ses sous-sections, jusqu'au titre suivant de même niveau", () => {
    const out = withoutSections(MD, ["Réglages", "Inconnu"]);
    expect(guideHeadings(out).map((h) => h.text)).toEqual([
      "Guide",
      "Les 10 premières minutes",
      "1. Se connecter",
      "Mon compte",
    ]);
    expect(out).not.toContain("Doublon.");
    expect(out).toContain("Voir [la suite](#reglages).");
    expect(withoutSections(MD, [])).toBe(MD);
  });

  it("retire le titre de niveau 1 (le seul <h1> de /help est celui de la page), ancres inchangées", () => {
    const out = withoutTitle(MD);
    expect(guideHeadings(out).some((h) => h.level === 1)).toBe(false);
    expect(out).toContain("## pas un titre"); // bloc de code intact
    expect(guideHeadings(out).map((h) => h.id)).toEqual(
      guideHeadings(MD)
        .filter((h) => h.level > 1)
        .map((h) => h.id),
    );
    expect(renderMarkdown(withoutTitle("# Guide\n\nTexte."))).toBe("<p>Texte.</p>");
  });
});

describe("rendu d'un extrait dans le volet", () => {
  it("préfixe des ancres, titres décalés, liens internes vers /help", () => {
    const [s] = guideSections(MD, ["Mon compte"]);
    const html = renderMarkdown(s!.markdown, {
      idPrefix: "aide-",
      headingOffset: 1,
      anchorBase: "/help",
    });
    expect(html).toContain('<h3 id="aide-mon-compte">Mon compte</h3>');
    expect(html).toContain('<a href="/help#reglages">la suite</a>');
  });

  it("sans option : rendu inchangé ; niveaux plafonnés à h6", () => {
    expect(renderMarkdown("[a](#x)")).toBe('<p><a href="#x">a</a></p>');
    expect(renderMarkdown("#### Petit", { headingOffset: 5 })).toBe('<h6 id="petit">Petit</h6>');
  });

  it("décalage négatif : une sous-section de niveau 4 devient le <h3> du volet, jamais moins que h1", () => {
    const md = "#### Utilisateurs\nTexte.";
    expect(renderMarkdown(md, { headingOffset: 3 - 4 })).toBe(
      '<h3 id="utilisateurs">Utilisateurs</h3>\n<p>Texte.</p>',
    );
    expect(renderMarkdown("## Grand", { headingOffset: -5 })).toBe('<h1 id="grand">Grand</h1>');
  });
});
