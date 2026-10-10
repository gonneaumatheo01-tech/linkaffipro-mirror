import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withBuiltinSections } from "./builtin-sections";
import { DEFAULT_HELP, PAGE_HELP, normalizePath, pageHelpFor } from "./page-help";
import { findHeading, guideHeadings, guideSections } from "./sections";

const GUIDE = readFileSync(
  join(__dirname, "..", "..", "..", "..", "docs", "GUIDE-UTILISATEUR.md"),
  "utf8",
);

describe("aide de la page courante : table adresse → sections du guide", () => {
  it("l'entrée la plus précise gagne, sous-pages comprises", () => {
    expect(pageHelpFor("/campaigns").help.label).toBe("Campagnes");
    expect(pageHelpFor("/campaigns/abc123?tab=ads").help.label).toBe("Campagnes");
    expect(pageHelpFor("/campaigns/links").help.label).toBe("Tous les liens");
    expect(pageHelpFor("/members/broadcasts/new").help.label).toBe("Écrire à un groupe");
    expect(pageHelpFor("/members/automations/r1/edit").help.label).toBe("Relances automatiques");
    expect(pageHelpFor("/members/m1").help.label).toBe("Membres");
    expect(pageHelpFor("/settings/connectors/meta/choose").help.label).toBe("Connexions");
    expect(pageHelpFor("/settings/journal/events").help.label).toBe("Journal");
    expect(pageHelpFor("/messages/ab/g1").help.label).toBe("Test A/B");
    expect(pageHelpFor("/stats").help.label).toBe("Statistiques");
  });

  it("« / » ne vaut que pour l'accueil ; repli sur « Les 10 premières minutes »", () => {
    expect(pageHelpFor("/")).toEqual({ help: PAGE_HELP[0], fallback: false });
    expect(pageHelpFor("/styleguide")).toEqual({ help: DEFAULT_HELP, fallback: true });
    expect(pageHelpFor("/campaignsx").fallback).toBe(true);
    expect(DEFAULT_HELP.sections).toEqual(["Les 10 premières minutes"]);
  });

  it("adresses normalisées", () => {
    expect(normalizePath("/campaigns/")).toBe("/campaigns");
    expect(normalizePath("/members?x=1#y")).toBe("/members");
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("javascript:alert(1)")).toBe("/");
    expect(normalizePath("/")).toBe("/");
  });

  it("une seule ligne par adresse", () => {
    const paths = PAGE_HELP.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("chaque titre de la table existe dans docs/GUIDE-UTILISATEUR.md ou ses sections intégrées", () => {
    const headings = guideHeadings(withBuiltinSections(GUIDE));
    const missing: string[] = [];
    for (const entry of [...PAGE_HELP, DEFAULT_HELP])
      for (const ref of entry.sections)
        if (!findHeading(headings, ref))
          missing.push(`${entry.path || "(repli)"} → ${typeof ref === "string" ? ref : ref.title}`);
    expect(missing).toEqual([]);
  });

  it("chaque page de l'application a une aide propre (sauf la page interne /styleguide)", () => {
    const pages = [
      "/",
      "/account",
      "/campaigns",
      "/campaigns/new",
      "/campaigns/import",
      "/campaigns/imports",
      "/campaigns/links",
      "/channels",
      "/channels/import",
      "/help",
      "/members",
      "/members/automations",
      "/members/broadcasts",
      "/messages",
      "/messages/categories",
      "/messages/new",
      "/settings",
      "/settings/ai",
      "/settings/alerts",
      "/settings/bots",
      "/settings/categories",
      "/settings/connectors",
      "/settings/journal",
      "/settings/postbacks",
      "/settings/reports",
      "/settings/status",
      "/settings/tags",
      "/settings/team",
      "/stats",
    ];
    expect(pages.filter((p) => pageHelpFor(p).fallback)).toEqual([]);
  });

  it("accueil : sa propre section « Accueil » (plus « Les 10 premières minutes »)", () => {
    const sections = guideSections(withBuiltinSections(GUIDE), pageHelpFor("/").help.sections);
    expect(sections.map((s) => s.id)).toEqual(["accueil"]);
    expect(sections[0]!.markdown).toContain("Bénéfice du jour");
  });

  it("les sections de chaque page se retrouvent dans le guide réel", () => {
    const sections = guideSections(GUIDE, pageHelpFor("/campaigns").help.sections);
    expect(sections.map((s) => s.id)).toEqual([
      "campagnes",
      "nommer-ses-campagnes-et-les-relier-a-link-affi",
      "une-pub-ne-remonte-pas",
    ]);
    expect(sections[0]!.markdown.startsWith("## Campagnes")).toBe(true);
    // Réglages : seulement l'introduction, sans les sous-sections.
    const settings = guideSections(GUIDE, pageHelpFor("/settings").help.sections);
    expect(settings).toHaveLength(1);
    expect(settings[0]!.markdown).not.toContain("### ");
  });
});
