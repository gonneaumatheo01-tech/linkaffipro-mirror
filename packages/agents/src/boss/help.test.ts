import { describe, expect, it } from "vitest";
import type { BossAction, BossTheme } from "./contract";
import { BOSS_HELP_EXAMPLES, BOSS_HELP_MAX_LINES, bossHelpText } from "./help";

/** Petit catalogue factice (le vrai est celui du chantier B). */
const action = (key: string, theme: BossTheme, description: string) => ({ key, theme, description }) as Pick<BossAction, "key" | "theme" | "description">;
const CATALOG = [
  action("etat", "etat", "Donne l'état général des équipes."),
  action("pause", "equipes", "Met une équipe en pause ou la relance."),
  action("niveau", "equipes", "Change le niveau d'une équipe (0 à 2)."),
  action("depenses", "chiffres", "Dit combien a été dépensé ce mois."),
  action("demandes", "demandes", "Liste ce qui attend ta réponse."),
  action("cats", "paris", "Active une catégorie <corners> & co."),
  action("commencer", "guide", "Guide la mise en route."),
  action("vide", "tests", "   "),
];

describe("Kevin : aide", () => {
  it("groupée par thème, dans l'ordre, puis les 5 exemples", () => {
    const text = bossHelpText(CATALOG as BossAction[]);
    const lines = text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(BOSS_HELP_MAX_LINES);
    expect(lines[1]).toBe("<b>Démarrer</b> : guide la mise en route");
    expect(text).toContain("<b>Équipes</b> : met une équipe en pause ou la relance · change le niveau d'une équipe (0 à 2)");
    expect(text.indexOf("<b>État</b>")).toBeLessThan(text.indexOf("<b>Chiffres</b>"));
    expect(text).not.toContain("<b>Essais</b>");
    for (const e of BOSS_HELP_EXAMPLES) expect(text).toContain(`« ${e.replace("'", "'")} »`);
    expect(lines.slice(-5).every((l) => l.startsWith("• « "))).toBe(true);
  });

  it("HTML échappé, nom de Kevin repris", () => {
    const text = bossHelpText(CATALOG as BossAction[], "Kev <in>");
    expect(text).toContain("active une catégorie &lt;corners&gt; &amp; co");
    expect(text).toContain("Kev &lt;in&gt;");
    expect(text).not.toMatch(/<(?!\/?b>)/);
  });

  it("très gros catalogue : 25 lignes au plus, lignes raccourcies", () => {
    const themes: BossTheme[] = ["etat", "chiffres", "demandes", "equipes", "canaux", "rencontres", "casino", "paris", "algorithme", "ads", "tests", "guide"];
    const big = themes.flatMap((t) => Array.from({ length: 30 }, (_, i) => action(`${t}${i}`, t, `Action numéro ${i} du thème ${t} avec une description assez longue`)));
    const lines = bossHelpText(big as BossAction[]).split("\n");
    expect(lines.length).toBeLessThanOrEqual(BOSS_HELP_MAX_LINES);
    expect(lines.filter((l) => l.endsWith("…")).length).toBeGreaterThan(0);
    expect(lines.every((l) => l.length < 400)).toBe(true);
  });
});
