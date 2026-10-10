import { describe, expect, it } from "vitest";
import {
  aiCostFigure,
  aiKeyView,
  aiKindLabel,
  aiModelLabel,
  aiSurfaceLabel,
  aiTokensLabel,
  aiUniverseLabel,
  aiUsedLabel,
  capUsage,
} from "./ai-view";

const base = { hasKey: true, keyHint: "sk-ant-…abcd", verifiedAt: null, lastError: null };

describe("Réglages → IA : état de la clé", () => {
  it("sans clé : assistant désactivé, pastille grise", () => {
    const v = aiKeyView({ ...base, hasKey: false, keyHint: null });
    expect(v.status).toBe("missing");
    expect(v.tone).toBe("muted");
    expect(v.sentence).toMatch(/désactivé/);
  });

  it("manager (lecture seule) : la phrase dit qu'un administrateur doit agir", () => {
    expect(
      aiKeyView({ ...base, hasKey: false, keyHint: null }, { readOnly: true }).sentence,
    ).toMatch(/un administrateur doit coller/);
    expect(aiKeyView(base, { readOnly: true }).sentence).toMatch(
      /administrateur doit encore la vérifier/,
    );
    expect(aiKeyView({ ...base, lastError: "Refusée." }, { readOnly: true }).sentence).not.toMatch(
      /Recollez/,
    );
  });

  it("clé enregistrée sans vérification : à vérifier", () => {
    const v = aiKeyView(base);
    expect(v.status).toBe("unverified");
    expect(v.tone).toBe("warning");
    expect(v.sentence).toContain("sk-ant-…abcd");
    expect(v.sentence).toContain("« Vérifier »");
  });

  it("clé vérifiée : date de vérification, pastille verte", () => {
    const v = aiKeyView({ ...base, verifiedAt: "2026-10-09T12:00:00.000Z" });
    expect(v.status).toBe("verified");
    expect(v.tone).toBe("success");
    expect(v.title).toMatch(/^Clé vérifiée le \d{2}\/\d{2}\/2026/);
  });

  it("un refus récent l'emporte sur une ancienne vérification", () => {
    const v = aiKeyView({
      ...base,
      verifiedAt: "2026-10-01T12:00:00.000Z",
      lastError: "Clé révoquée.",
    });
    expect(v.status).toBe("refused");
    expect(v.alert).toBe("destructive");
    expect(v.sentence).toMatch(/^Clé révoquée\./);
  });
});

describe("Réglages → IA : plafond mensuel", () => {
  it("pourcentage borné entre 0 et 100, nuance selon la part utilisée", () => {
    expect(capUsage(0, 20)).toMatchObject({ pct: 0, tone: "brand" });
    expect(capUsage(15, 20)).toMatchObject({ pct: 75, tone: "warning" });
    expect(capUsage(19, 20)).toMatchObject({ pct: 95, tone: "danger" });
    expect(capUsage(40, 20)).toMatchObject({ pct: 100, tone: "danger" });
    expect(capUsage(40, 20).sentence).toMatch(/Plafond atteint/);
  });

  it("plafond à 0 : jamais bloqué, pas de division par zéro", () => {
    expect(capUsage(3, 0)).toMatchObject({ pct: 0, tone: "brand" });
    expect(capUsage(3, 0).sentence).toMatch(/Aucun plafond/);
  });
});

describe("Réglages → IA : coût du mois en gros chiffre", () => {
  // Intl sépare le montant et « € » par une espace insécable : on la normalise pour comparer.
  const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

  it("au centime, jamais 4 décimales", () => {
    expect(plain(aiCostFigure(0).text)).toBe("0,00 €");
    expect(plain(aiCostFigure(0.01).text)).toBe("0,01 €");
    expect(plain(aiCostFigure(5).text)).toBe("5,00 €");
    expect(plain(aiCostFigure(12.345).text)).toBe("12,35 €");
    expect(aiCostFigure(0.5).text).not.toMatch(/,\d{3}/);
  });

  it("entre 0 et 1 centime : « moins de 0,01 € », pas « 0,00 € » qui ferait croire à zéro", () => {
    const f = aiCostFigure(0.0042);
    expect(f.lessThan).toBe(true);
    expect(plain(f.amount)).toBe("0,01 €");
    expect(plain(f.text)).toBe("moins de 0,01 €");
    expect(aiCostFigure(0).lessThan).toBe(false);
    expect(aiCostFigure(0.01).lessThan).toBe(false);
  });
});

describe("Réglages → IA : historique dans le vocabulaire du client", () => {
  it("écran d'origine : mots du client, pas « envoi groupé » ni « automatisation »", () => {
    expect(aiSurfaceLabel({ surface: "broadcast" })).toBe("Écrire à un groupe");
    expect(aiSurfaceLabel({ surface: "automation" })).toBe("Relance automatique");
    expect(aiSurfaceLabel({ surface: "bot_text" })).toBe("Messages du bot");
    expect(aiSurfaceLabel({})).toBe("—");
    expect(aiSurfaceLabel(null)).toBe("—");
  });

  it("univers : « Rencontres » plutôt que « Dating »", () => {
    expect(aiUniverseLabel({ vertical: "DATING" })).toBe("Rencontres");
    expect(aiUniverseLabel({ vertical: "inconnu" })).toBe("—");
  });

  it("demande, modèle, jetons et version utilisée", () => {
    expect(aiKindLabel("improve")).toBe("Améliorer");
    expect(aiKindLabel("autre")).toBe("autre");
    expect(aiModelLabel("modele-inconnu")).toBe("modele-inconnu");
    expect(aiUsedLabel({ context: {}, usedIndex: null })).toBe("Non");
    expect(aiUsedLabel({ context: {}, usedIndex: 1 })).toBe("Version 2");
    expect(aiUsedLabel({ context: { failed: "too_long" }, usedIndex: null })).toBe(
      "Échec : réponse coupée",
    );
    expect(aiTokensLabel({ inputTokens: 1200, outputTokens: 340, cachedTokens: 0 })).toMatch(
      /^1\s200 lus \/ 340 écrits$/,
    );
    expect(aiTokensLabel({ inputTokens: 10, outputTokens: 5, cachedTokens: 8 })).toBe(
      "10 lus / 5 écrits (8 en cache)",
    );
  });
});
