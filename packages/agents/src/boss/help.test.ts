import { beforeEach, describe, expect, it } from "vitest";
import type { BossAction, BossTheme } from "./contract";
import { BOSS_HELP_MAX_LINES, BOSS_THEME_EXAMPLES, HELP_VARIANTS, bossHelpText } from "./help";
import { resetVoiceRotation, voiceCheck } from "./voice";

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
  beforeEach(() => resetVoiceRotation());

  it("phrase d'introduction, une ligne d'exemples par thème présent (dans l'ordre), phrase de fin", () => {
    const text = bossHelpText(CATALOG as BossAction[], "Kevin", null, []);
    const lines = text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(BOSS_HELP_MAX_LINES);
    expect(HELP_VARIANTS.intro({ name: "Kevin" })).toContain(lines[0]);
    expect(lines[1]).toBe(`• Démarrer : ${BOSS_THEME_EXAMPLES.guide.map((e) => `« ${e.replace("'", "&#39;")} »`).join(", ")}`.replace(/&#39;/g, "'"));
    expect(text).toContain("• Équipes : « mets le casino en pause », « passe le dating en vrai »");
    expect(text.indexOf("• État")).toBeLessThan(text.indexOf("• Chiffres"));
    expect(text).not.toContain("Essais");
    expect(HELP_VARIANTS.outro).toContain(lines[lines.length - 1]);
    // Des exemples de phrases, plus des descriptions.
    expect(text).not.toContain("met une équipe en pause ou la relance");
    expect(voiceCheck(text, { allowList: true, allowLong: true }).problems).toEqual([]);
  });

  it("HTML échappé, nom de Kevin repris quand la variante le cite", () => {
    const texts = new Set<string>();
    for (let i = 0; i < 3; i++) texts.add(bossHelpText(CATALOG as BossAction[], "Kev <in>", 1n));
    const all = [...texts].join("\n");
    expect(all).toContain("Kev &lt;in&gt;");
    expect(all).not.toMatch(/<(?!\/?b>)/);
  });

  it("deux « aide » de suite dans la même conversation : pas la même phrase d'introduction", () => {
    const a = bossHelpText(CATALOG as BossAction[], "Kevin", 7n).split("\n")[0];
    const b = bossHelpText(CATALOG as BossAction[], "Kevin", 7n).split("\n")[0];
    expect(a).not.toBe(b);
  });

  it("très gros catalogue : 25 lignes au plus, une ligne par thème", () => {
    const themes: BossTheme[] = ["etat", "chiffres", "demandes", "equipes", "canaux", "rencontres", "casino", "paris", "algorithme", "ads", "tests", "guide"];
    const big = themes.flatMap((t) => Array.from({ length: 30 }, (_, i) => action(`${t}${i}`, t, `Action numéro ${i} du thème ${t} avec une description assez longue`)));
    const lines = bossHelpText(big as BossAction[], "Kevin", null, []).split("\n");
    expect(lines.length).toBeLessThanOrEqual(BOSS_HELP_MAX_LINES);
    expect(lines.length).toBe(themes.length + 2);
    expect(lines.every((l) => l.length < 400)).toBe(true);
  });
});

describe("Kevin : aide par domaine du site (phase 34)", () => {
  const ops = [
    { key: "campagnes.creer", domain: "campagnes", description: "Créer une campagne", examples: ["crée une campagne Celsius"], kind: "create", role: "MANAGER", confirm: "none", params: {}, serverActions: [] },
    { key: "campagnes.supprimer", domain: "campagnes", description: "Supprimer une campagne", examples: ["supprime la campagne test"], kind: "delete", role: "ADMIN", confirm: "delete", params: {}, serverActions: [] },
    { key: "reglages.etiquette_creer", domain: "reglages", description: "Créer une étiquette", examples: ["crée l'étiquette VIP"], kind: "create", role: "MANAGER", confirm: "none", params: {}, serverActions: [] },
  ] as const;

  it("« aide » : une ligne par domaine avec 2 exemples ; « aide campagnes » détaille", async () => {
    const { bossDomainHelpText } = await import("./help");
    const text = bossHelpText(CATALOG as BossAction[], "Kevin", null, ops as never);
    expect(text).toContain("• Campagnes : « crée une campagne Celsius », « supprime la campagne test »");
    expect(text).toContain("• Réglages : « crée l'étiquette VIP »");
    expect(voiceCheck(text, { allowList: true, allowLong: true }).problems).toEqual([]);
    const detail = bossDomainHelpText("campagnes", null, ops as never);
    expect(detail).toContain("• Créer une campagne : « crée une campagne Celsius »");
    expect(detail).toContain("• Supprimer une campagne : « supprime la campagne test »");
    expect(voiceCheck(detail, { allowList: true, allowLong: true }).problems).toEqual([]);
    expect(voiceCheck(bossDomainHelpText("pages", null, ops as never)).problems).toEqual([]);
  });
});
