import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTelegramHtml } from "@linkaffipro/core";
import { PHASE9_TEMPLATE_TEXTS } from "./phase10-templates";
import {
  buildTemplateRows,
  LIBRARY,
  RISK_NOTICE,
  seedTemplates,
  THEME_LABELS,
  VERTICAL_LABELS,
  type TemplateDb,
  type TemplateRow,
} from "./seed-templates";

// Bibliothèque des 63 modèles : construction des lignes (pure) et insertion idempotente, sans aucune catégorie.

const THEMES = [
  "bonus",
  "preuve-de-gains",
  "teasing",
  "rappel",
  "information",
  "evenement",
  "sondage",
];

describe("bibliothèque de modèles (construction pure)", () => {
  const rows = buildTemplateRows();

  it("63 modèles : 3 univers × 7 thèmes × 3", () => {
    expect(rows).toHaveLength(63);
    expect(new Set(rows.map((r) => r.code)).size).toBe(63);
  });
  it("aucune catégorie : le thème vit dans le code modele:<univers>:<thème>:<n>", () => {
    for (const r of rows) {
      expect(r.categoryId).toBeNull();
      expect(r.code).toMatch(
        /^modele:(casino|sports|dating):(bonus|preuve-de-gains|teasing|rappel|information|evenement|sondage):[1-3]$/,
      );
    }
  });
  it("nom lisible « <Univers> · <Thème> · <titre> » tiré de la table des thèmes", () => {
    expect(rows[0]).toMatchObject({
      code: "modele:casino:bonus:1",
      vertical: "CASINO",
      templateName: "Casino · Bonus · Bonus de bienvenue",
    });
    const event = rows.find((r) => r.code === "modele:dating:evenement:1");
    expect(event?.templateName.startsWith("Rencontres · Événement · ")).toBe(true);
    expect(rows.find((r) => r.code === "modele:sports:preuve-de-gains:2")?.templateName).toMatch(
      /^Paris sportifs · Preuve de gains · /,
    );
  });
  it("table des thèmes : les 7 thèmes, identiques dans chaque univers", () => {
    expect(Object.keys(THEME_LABELS)).toEqual(THEMES);
    expect(THEME_LABELS.evenement).toBe("Événement");
    for (const v of Object.keys(LIBRARY) as Array<keyof typeof LIBRARY>) {
      expect(Object.keys(LIBRARY[v]).sort()).toEqual([...THEMES].sort());
      expect(VERTICAL_LABELS[v]).toBeTruthy();
    }
  });
  it("mention des risques pour casino et paris sportifs, pas pour les rencontres", () => {
    for (const r of rows) {
      const hasRisk = r.text.includes("Jouer comporte des risques");
      expect(hasRisk).toBe(r.vertical !== "DATING");
    }
  });
  it("le script ne lit plus les catégories", () => {
    const src = readFileSync(new URL("./seed-templates.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/messageCategory|catBySlug|missingCats/);
  });
});

// Phase 10 : un message de canal ne remplace aucun repère ({prenom}, {offre}, {canal}… partiraient tels quels).
describe("modèles prêts à partir dans un canal (phase 10)", () => {
  const rows = buildTemplateRows();
  const offerRows = (r: TemplateRow) => r.buttons.flat().filter((b) => b.type === "OFFER");

  it("aucun repère entre accolades : ni {prenom}, ni {offre}, ni {canal}", () => {
    for (const r of rows) {
      expect(r.text, r.code).not.toContain("{prenom}");
      expect(r.text, r.code).not.toContain("{offre}");
      expect(r.text, r.code).not.toContain("{canal}");
      expect(r.text, r.code).not.toMatch(/\{[a-z_]+\}/);
    }
  });
  it("chaque modèle qui citait l'offre a un bouton « Offre (campagne) », sans campagne choisie d'avance", () => {
    const withOffer = Object.entries(PHASE9_TEMPLATE_TEXTS).filter(([, t]) =>
      t.includes("{offre}"),
    );
    expect(withOffer).toHaveLength(43);
    for (const r of rows) {
      const hadOffer = PHASE9_TEMPLATE_TEXTS[r.code]!.includes("{offre}");
      const offers = offerRows(r);
      expect(offers.length, r.code).toBe(hadOffer ? 1 : 0);
      if (!hadOffer) {
        expect(r.buttons, r.code).toEqual([]);
        continue;
      }
      // Structure de `Post.buttons` : une ligne, un bouton Offre ; la campagne se choisit à l'utilisation.
      expect(r.buttons, r.code).toEqual([[{ text: offers[0]!.text, type: "OFFER" }]]);
      expect(offers[0]!.text.trim().length, r.code).toBeGreaterThan(0);
      expect(offers[0]!.text.length, r.code).toBeLessThanOrEqual(64);
    }
  });
  it("un modèle avec bouton Offre invite à appuyer dessus ; sans bouton, il n'en parle pas", () => {
    for (const r of rows) {
      const mentions = /bouton ci-dessous/.test(r.text);
      expect(mentions, r.code).toBe(offerRows(r).length > 0);
    }
  });
  it("texte valable pour Telegram (balises permises, longueur)", () => {
    for (const r of rows) {
      const v = validateTelegramHtml(r.text);
      expect(v.ok, `${r.code} : ${v.ok ? "" : v.error}`).toBe(true);
      if (v.ok) expect(v.html).toBe(r.text);
    }
  });
  it("ton et mentions de risques inchangés : les modèles sans repère restent mot pour mot", () => {
    for (const r of rows) {
      const before = PHASE9_TEMPLATE_TEXTS[r.code]!;
      if (!/\{[a-z_]+\}/.test(before)) expect(r.text, r.code).toBe(before);
      // La mention des risques termine toujours les modèles casino et paris sportifs.
      if (r.vertical !== "DATING") expect(r.text.endsWith(RISK_NOTICE), r.code).toBe(true);
    }
    // Les messages de jeu responsable gardent le numéro d'aide.
    expect(rows.find((r) => r.code === "modele:casino:information:3")!.text).toContain(
      "09 74 75 13 13",
    );
  });
});

/** Base simulée : un canal et un bot par univers, posts en mémoire (aucune table de catégories). */
function fakeDb(opts: { withChannel?: boolean } = {}) {
  const posts = new Map<string, Record<string, unknown>>();
  const channel = (vertical: string) => ({
    id: `ch-${vertical}`,
    title: `Canal ${vertical}`,
    primaryBot: { id: `bot-${vertical}`, isActive: true },
    botAdmins: [],
  });
  const db = {
    channel: {
      findFirst: async ({ where }: { where: { vertical?: string } }) =>
        opts.withChannel === false ? null : channel(where.vertical ?? "ANY"),
    },
    bot: { findFirst: async () => null },
    post: {
      findUnique: async ({ where }: { where: { code: string } }) =>
        posts.has(where.code) ? { id: where.code } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        posts.set(String(data.code), data);
        return { id: String(data.code) };
      },
    },
  };
  return { db: db as unknown as TemplateDb, posts };
}

describe("insertion (idempotente)", () => {
  it("crée les 63 modèles sans catégorie sur le canal porteur de chaque univers", async () => {
    const { db, posts } = fakeDb();
    const r = await seedTemplates(db, () => undefined);
    expect(r).toEqual({ created: 63, skipped: 0 });
    const one = posts.get("modele:sports:rappel:1")!;
    expect(one).toMatchObject({
      channelId: "ch-SPORTS",
      botId: "bot-SPORTS",
      isTemplate: true,
      status: "DRAFT",
      categoryId: null,
      vertical: "SPORTS",
    });
  });
  it("insère le bouton Offre des modèles qui en ont un, aucun bouton pour les autres", async () => {
    const { db, posts } = fakeDb();
    await seedTemplates(db, () => undefined);
    for (const r of buildTemplateRows()) {
      const p = posts.get(r.code)!;
      expect(p.text, r.code).toBe(r.text);
      expect(p.buttons, r.code).toEqual(r.buttons);
    }
    expect(posts.get("modele:casino:bonus:1")!.buttons).toEqual([
      [{ text: expect.any(String), type: "OFFER" }],
    ]);
    expect(posts.get("modele:casino:information:3")!.buttons).toEqual([]);
  });
  it("relancé : ne recrée rien", async () => {
    const { db } = fakeDb();
    await seedTemplates(db, () => undefined);
    expect(await seedTemplates(db, () => undefined)).toEqual({ created: 0, skipped: 63 });
  });
  it("aucun canal actif : rien d'inséré, message clair", async () => {
    const { db, posts } = fakeDb({ withChannel: false });
    const logs: string[] = [];
    expect(await seedTemplates(db, (m) => logs.push(m))).toEqual({ created: 0, skipped: 0 });
    expect(posts.size).toBe(0);
    expect(logs.join("\n")).toContain("aucun canal actif");
  });
});
