import { describe, expect, it } from "vitest";
import {
  FAQ_LIMITS,
  cleanFaq,
  isFaqHeader,
  moveFaqEntry,
  parseCsv,
  previewFaqImport,
  sameFaq,
  validateFaq,
} from "./faq";

describe("lecture d'un fichier tableur (séparateur « ; »)", () => {
  it("lignes simples, fins de ligne Windows, marque d'encodage et lignes vides", () => {
    const rows = parseCsv("﻿question;réponse\r\nDépôt minimum ?;10 €\r\n\r\nPays ?;France\r\n");
    expect(rows).toEqual([
      { line: 1, cells: ["question", "réponse"] },
      { line: 2, cells: ["Dépôt minimum ?", "10 €"] },
      { line: 4, cells: ["Pays ?", "France"] },
    ]);
  });

  it("guillemets : point-virgule, guillemet doublé et retour à la ligne dans une cellule", () => {
    const rows = parseCsv(
      '"Bonus ?";"100 % ; jusqu\'à 200 €, code ""BIENVENUE""\nvalable 7 jours"\nVIP ?;Oui',
    );
    expect(rows[0]!.cells).toEqual([
      "Bonus ?",
      '100 % ; jusqu\'à 200 €, code "BIENVENUE"\nvalable 7 jours',
    ]);
    expect(rows[1]).toEqual({ line: 3, cells: ["VIP ?", "Oui"] });
  });

  it("en-tête reconnu (accents, majuscules, deux-points)", () => {
    expect(isFaqHeader(["Question", "Réponse"])).toBe(true);
    expect(isFaqHeader(["questions :", "reponses"])).toBe(true);
    expect(isFaqHeader(["q", "a"])).toBe(true);
    expect(isFaqHeader(["Quel bonus ?", "100 %"])).toBe(false);
  });
});

describe("aperçu d'un import", () => {
  it("lignes retenues et refusées, avec la raison", () => {
    const p = previewFaqImport(
      [
        "question;réponse",
        "Dépôt minimum ?;10 €",
        "sans séparateur",
        "Trois;colonnes;ici",
        ";réponse sans question",
        "Question sans réponse;",
        "dépôt minimum ?;doublon",
        "Retrait ?;48 h;;",
      ].join("\n"),
      [],
      "add",
    );
    expect(p.header).toBe(true);
    expect(p.accepted.map((a) => a.line)).toEqual([2, 8]);
    expect(p.accepted[1]).toMatchObject({ q: "Retrait ?", a: "48 h" });
    expect(p.refused.map((r) => [r.line, r.reason])).toEqual([
      [3, expect.stringMatching(/point-virgule/)],
      [4, expect.stringMatching(/deux colonnes/)],
      [5, "La question est vide."],
      [6, "La réponse est vide."],
      [7, "Question déjà dans la fiche."],
    ]);
    expect(p.result).toHaveLength(2);
  });

  it("ajouter : une question déjà dans la fiche est refusée ; remplacer : la fiche repart du fichier", () => {
    const existing = [{ q: "Pays ?", a: "France" }];
    const add = previewFaqImport("Pays ?;Belgique\nVIP ?;Oui", existing, "add");
    expect(add.accepted.map((a) => a.q)).toEqual(["VIP ?"]);
    expect(add.result.map((e) => e.q)).toEqual(["Pays ?", "VIP ?"]);
    const replace = previewFaqImport("Pays ?;Belgique\nVIP ?;Oui", existing, "replace");
    expect(replace.result).toEqual([
      { q: "Pays ?", a: "Belgique" },
      { q: "VIP ?", a: "Oui" },
    ]);
  });

  it("au-delà de 40, les lignes en trop sont signalées", () => {
    const existing = Array.from({ length: 38 }, (_, i) => ({ q: `Q${i}`, a: "r" }));
    const lines = Array.from({ length: 5 }, (_, i) => `Nouvelle ${i};r`).join("\n");
    const p = previewFaqImport(lines, existing, "add");
    expect(p.accepted).toHaveLength(2);
    expect(p.overflow).toBe(3);
    expect(p.result).toHaveLength(FAQ_LIMITS.max);
    expect(p.refused[0]!.reason).toMatch(/En trop/);
  });

  it("textes trop longs refusés", () => {
    const p = previewFaqImport(`${"q".repeat(301)};r\nq;${"a".repeat(1001)}`, [], "add");
    expect(p.refused.map((r) => r.reason)).toEqual([
      expect.stringMatching(/Question trop longue/),
      expect.stringMatching(/Réponse trop longue/),
    ]);
  });
});

describe("règle de la fiche", () => {
  it("nettoie et accepte une fiche correcte", () => {
    const v = validateFaq([{ q: "  Dépôt   minimum ? ", a: " 10 €  \n\n\n par carte " }]);
    expect(v).toEqual({ ok: true, faq: [{ q: "Dépôt minimum ?", a: "10 €\n\npar carte" }] });
  });

  it("refuse une entrée vide, un doublon, plus de 40 entrées", () => {
    expect(validateFaq([{ q: "", a: "" }])).toMatchObject({ ok: false, error: /n° 1/ });
    const dup = validateFaq([
      { q: "VIP ?", a: "Oui" },
      { q: "vip ?", a: "Non" },
    ]);
    expect(dup).toMatchObject({ ok: false, error: /n° 2.*déjà/ });
    const many = Array.from({ length: 41 }, (_, i) => ({ q: `Q${i}`, a: "r" }));
    expect(validateFaq(many)).toMatchObject({ ok: false, error: /40 questions au plus/ });
  });

  it("lecture tolérante de la colonne, comparaison, déplacement", () => {
    expect(cleanFaq(null)).toEqual([]);
    expect(cleanFaq([{ q: "a", a: "b" }, { q: 1 }, "x"])).toEqual([{ q: "a", a: "b" }]);
    expect(sameFaq([{ q: "a ", a: "b" }], [{ q: "a", a: "b" }])).toBe(true);
    expect(sameFaq([{ q: "a", a: "b" }], [{ q: "a", a: "c" }])).toBe(false);
    expect(moveFaqEntry([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveFaqEntry([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
