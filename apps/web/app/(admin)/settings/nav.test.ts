import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_STATE_KEYS } from "@/lib/status/settings-cards";
import { SETTINGS_CARDS, settingsCardsFor, settingsHrefs, stateKeysOf } from "./nav";

describe("cartes de la page Réglages", () => {
  it("les 10 cartes de la spécification, dans l'ordre", () => {
    expect(SETTINGS_CARDS.map((c) => c.title)).toEqual([
      "Connexions",
      "Bots",
      "Équipe",
      "Alertes et rapports",
      "IA",
      "IA de conversation",
      "Catégories et étiquettes",
      "Journal",
      "État du système",
      "Avancé",
    ]);
  });

  it("chaque carte a une clé unique, une phrase et des adresses sous /settings", () => {
    const keys = SETTINGS_CARDS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of SETTINGS_CARDS) {
      expect(c.description.trim()).not.toBe("");
      expect(c.description.length).toBeLessThanOrEqual(100);
      for (const href of [c.href, ...(c.links ?? []).map((l) => l.href)])
        expect(href).toMatch(/^\/settings\/[a-z]+(\/[a-z]+)?$/);
      // Une carte qui regroupe des pages s'ouvre sur l'une d'elles.
      if (c.links) expect(c.links.map((l) => l.href)).toContain(c.href);
    }
  });

  it("chaque page de Réglages est atteignable depuis une carte (rien ne disparaît)", () => {
    const root = __dirname;
    const pages = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "page.tsx")))
      .map((d) => `/settings/${d.name}`);
    expect(pages.length).toBeGreaterThanOrEqual(11);
    const hrefs = settingsHrefs();
    for (const p of pages) expect(hrefs).toContain(p);
    for (const p of [
      "/settings/connectors/meta",
      "/settings/connectors/tiktok",
      "/settings/connectors/telegram",
      "/settings/journal/events",
    ])
      expect(hrefs).toContain(p);
  });

  it("le terme technique « postback » ne sort que dans la carte Avancé", () => {
    for (const c of SETTINGS_CARDS) {
      const text = [c.title, c.description, ...(c.links ?? []).map((l) => l.label)].join(" ");
      expect(text.toLowerCase()).not.toMatch(/postback|webhook|sub-id|ngr|ftd/);
      if (c.key !== "advanced") for (const l of c.links ?? []) expect(l.term).toBeUndefined();
    }
    expect(SETTINGS_CARDS.find((c) => c.key === "advanced")?.links?.[0]?.term).toBe("postbacks");
  });

  it("un administrateur voit toutes les cartes, dans l'ordre", () => {
    expect(settingsCardsFor("ADMIN")).toEqual(SETTINGS_CARDS);
  });

  it("phase 17 : « IA de conversation » ouvre /settings/assistant, réservée aux administrateurs", () => {
    const card = SETTINGS_CARDS.find((c) => c.key === "assistant")!;
    expect(card.href).toBe("/settings/assistant");
    expect(card.managers).toBeUndefined();
    expect(card.state).toBe("assistant");
    expect(card.description).not.toMatch(/dating|entonnoir/i);
    expect(settingsCardsFor("ADMIN").map((c) => c.href)).toContain("/settings/assistant");
    expect(settingsCardsFor("MANAGER").map((c) => c.href)).not.toContain("/settings/assistant");
  });

  it("un manager ne voit que ce qu'il peut ouvrir (Bots, IA, Journal)", () => {
    expect(settingsCardsFor("MANAGER").map((c) => c.href)).toEqual([
      "/settings/bots",
      "/settings/ai",
      "/settings/journal",
    ]);
  });

  it("un manager ne lit pas de promesse réservée aux administrateurs (ajout d'un bot)", () => {
    const managerBots = settingsCardsFor("MANAGER").find((c) => c.key === "bots")!;
    expect(managerBots.description).not.toMatch(/ajout/i);
    expect(managerBots.description).toBe(
      "Vos bots Telegram, un par univers : leur état et leur connexion Telegram.",
    );
    expect("managerDescription" in managerBots).toBe(false);
    const adminBots = settingsCardsFor("ADMIN").find((c) => c.key === "bots")!;
    expect(adminBots.description).toMatch(/l'ajout d'un bot/);
    // Les cartes sans phrase propre aux managers gardent la leur.
    const ai = SETTINGS_CARDS.find((c) => c.key === "ai")!;
    expect(settingsCardsFor("MANAGER").find((c) => c.key === "ai")!.description).toBe(
      ai.description,
    );
  });

  it("filtre aussi une liste fournie", () => {
    const cards = [
      { key: "team", title: "A", description: "a", href: "/settings/a" },
      { key: "bots", title: "B", description: "b", href: "/settings/b", managers: true },
    ] as const;
    expect(settingsCardsFor("MANAGER", cards).map((c) => c.href)).toEqual(["/settings/b"]);
    expect(settingsCardsFor("ADMIN", cards)).toHaveLength(2);
  });

  it("pastilles à calculer : celles des cartes visibles et de leurs liens", () => {
    expect([...stateKeysOf(settingsCardsFor("MANAGER"))].sort()).toEqual(["ai", "bots"]);
    const all = stateKeysOf(SETTINGS_CARDS);
    expect([...all].sort()).toEqual([...SETTINGS_STATE_KEYS].sort());
  });
});
