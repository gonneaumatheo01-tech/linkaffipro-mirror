import { describe, expect, it } from "vitest";
import {
  averageLatencyMs,
  byTeam,
  checkHref,
  correctionsOf,
  countsOf,
  dailyRates,
  dailyRefusals,
  dayBounds,
  hourlyRates,
  maskQaText,
  maskedContentFields,
  modelLabel,
  mostRejectedTeams,
  parseQualiteFilters,
  parseQualiteStep,
  parseQualiteView,
  qaPaused,
  qualiteHref,
  reasonLabel,
  reasonsOf,
  safeCheckId,
  topReasons,
  weekOverWeek,
  type QaCheckLite,
} from "./qualite";

const NOW = new Date("2026-10-26T10:30:00Z"); // 11 h 30 à Paris
const H = 3_600_000;
const SECRET = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";

let n = 0;
const row = (o: Partial<QaCheckLite> & { ago?: number } = {}): QaCheckLite => {
  const { ago = H, ...rest } = o;
  return { id: `q${++n}`, contentType: "POST", teamKey: "casino", verdict: "APPROVED", reasons: [], durationMs: 2000, createdAt: new Date(NOW.getTime() - ago), ...rest };
};
const gain = [{ code: "GAIN_PROMISE", message: "promesse", severity: "critical" }];

describe("Agents → Qualité : vues et filtres", () => {
  it("vue, pas, filtres lus dans l'adresse (valeurs inconnues ignorées)", () => {
    expect(parseQualiteView(undefined)).toBe("tableau");
    expect(parseQualiteView("historique")).toBe("historique");
    expect(parseQualiteView("approuver")).toBe("tableau");
    expect(parseQualiteStep("heure")).toBe("heure");
    expect(parseQualiteStep("minute")).toBe("jour");
    expect(parseQualiteFilters({ resultat: "REJECTED", type: "SHORT", equipe: "montage", du: "2026-10-20", au: "2026-10-26", page: "2" })).toEqual({
      verdict: "REJECTED",
      type: "SHORT",
      team: "montage",
      from: "2026-10-20",
      to: "2026-10-26",
      page: 2,
    });
    expect(parseQualiteFilters({ resultat: "OK", type: "x", equipe: "<script>", du: "20/10", page: "-1" })).toEqual({ verdict: null, type: null, team: null, from: null, to: null, page: 1 });
    expect(qualiteHref("tableau")).toBe("/agents/qualite");
    expect(qualiteHref("historique", { resultat: "REJECTED", type: null })).toBe("/agents/qualite?vue=historique&resultat=REJECTED");
    expect(checkHref("abc", parseQualiteFilters({ equipe: "casino" }))).toBe("/agents/qualite?vue=historique&equipe=casino&voir=abc");
    expect(safeCheckId("ck_12-ab")).toBe("ck_12-ab");
    expect(safeCheckId("../x")).toBeNull();
  });

  it("jours de Paris : bornes comprises, heure d'été", () => {
    const b = dayBounds("2026-10-20", "2026-10-26");
    expect(b.gte!.toISOString()).toBe("2026-10-19T22:00:00.000Z");
    // Passage à l'heure d'hiver le 25 octobre : minuit du 27 à Paris = 23 h UTC le 26.
    expect(b.lt!.toISOString()).toBe("2026-10-26T23:00:00.000Z");
    expect(dayBounds(null, null)).toEqual({});
  });
});

describe("Agents → Qualité : motifs et masquage", () => {
  it("motifs en français courant, jamais le code", () => {
    expect(reasonLabel("GAIN_PROMISE")).toBe("Promesse de gain");
    expect(reasonLabel("copy")).toBe("Texte copié sur une source");
    expect(reasonLabel("NOUVEAU_CODE")).toBe("Autre motif");
    expect(reasonsOf([{ code: "LANGUAGE", message: `virgule ; jeton ${SECRET}`, severity: "warning" }, "x"])).toEqual([
      { code: "LANGUAGE", label: "Français à corriger", message: "virgule ; jeton [jeton masqué]", critical: false },
    ]);
    expect(reasonsOf(null)).toEqual([]);
    expect(correctionsOf([{ field: "texte", expected: "sans promesse", got: "écris à a@b.fr", suggestion: "Retire le montant" }])).toEqual([
      { field: "texte", expected: "sans promesse", got: "écris à [courriel masqué]", suggestion: "Retire le montant" },
    ]);
  });

  it("contenu vérifié : masqué à nouveau, clés sensibles cachées, coupé", () => {
    const fields = maskedContentFields({ text: "<b>Salut</b> appelle le 06 12 34 56 78", token: "abc", apiKey: "x", media: { kind: "video" }, long: "y".repeat(900) });
    expect(fields).toEqual([
      { key: "Texte", value: "Salut appelle le [téléphone masqué]" },
      { key: "Jeton", value: "[masqué]" },
      { key: "apiKey", value: "[masqué]" },
      { key: "Média", value: '{"kind":"video"}' },
      { key: "long", value: `${"y".repeat(599)}…` },
    ]);
    expect(maskedContentFields(null)).toEqual([]);
    expect(maskedContentFields("brut sk-ant-abcdefghijklmn")).toEqual([{ key: "contenu", value: "brut [clé masquée]" }]);
    expect(maskQaText("https://site.fr/a?token=abc mort")).toBe("https://site.fr/a mort");
    expect(modelLabel("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelLabel(null)).toBe("—");
  });
});

describe("Agents → Qualité : chiffres", () => {
  const rows = [
    row({ ago: 1 * H }),
    row({ ago: 2 * H, verdict: "REJECTED", reasons: gain, durationMs: 4000 }),
    row({ ago: 3 * H, verdict: "TIMEOUT", durationMs: 30000, teamKey: "montage", contentType: "SHORT" }),
    row({ ago: 26 * H, verdict: "ERROR", durationMs: 100 }),
    row({ ago: 50 * H, verdict: "REJECTED", teamKey: "montage", contentType: "SHORT", reasons: [{ code: "SUBTITLE_ERROR", severity: "critical" }, { code: "LANGUAGE", severity: "warning" }] }),
    row({ ago: 9 * 24 * H, verdict: "REJECTED", reasons: gain }),
  ];

  it("comptes, temps moyen (vérifications menées à terme seulement)", () => {
    expect(countsOf(rows.slice(0, 4))).toEqual({ total: 4, approved: 1, rejected: 1, timeout: 1, error: 1, rate: 0.25 });
    expect(countsOf([]).rate).toBeNull();
    expect(averageLatencyMs(rows.slice(0, 4))).toBe(3000);
    expect(averageLatencyMs([])).toBeNull();
  });

  it("part acceptée par jour et par heure ; un jour sans vérification n'est pas une part nulle", () => {
    const d = dailyRates(rows, NOW);
    expect(d.labels).toHaveLength(7);
    expect(d.labels.at(-1)).toBe("26 oct.");
    expect(d.totals.at(-1)).toBe(3);
    expect(d.rates.at(-1)).toBeCloseTo(1 / 3);
    expect(Number.isNaN(d.rates[0]!)).toBe(true);
    const h = hourlyRates(rows, NOW);
    expect(h.labels).toHaveLength(168);
    expect(h.labels.at(-1)).toBe("26 oct. 11 h");
    expect(h.totals.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("par équipe, motifs les plus fréquents, équipes les plus refusées, évolution", () => {
    const teams = byTeam(rows);
    expect(teams.map((t) => [t.label, t.total, t.rejected])).toEqual([
      ["Casino", 4, 2],
      ["Montage", 2, 1],
    ]);
    expect(topReasons(rows)).toEqual([
      { label: "Promesse de gain", code: "GAIN_PROMISE", count: 2 },
      { label: "Erreur dans les sous-titres", code: "SUBTITLE_ERROR", count: 1 },
    ]);
    expect(mostRejectedTeams(rows).map((t) => t.key)).toEqual(["casino", "montage"]);
    const r = dailyRefusals(rows, NOW, 28);
    expect(r.labels).toHaveLength(28);
    expect(r.refusals.reduce((a, b) => a + b, 0)).toBe(3);
    const w = weekOverWeek(rows, NOW);
    expect(w.current.total).toBe(5);
    expect(w.previous).toMatchObject({ total: 1, rejected: 1 });
  });

  it("en pause : dernière vérification = contrôle indisponible, depuis moins d'une heure", () => {
    expect(qaPaused({ verdict: "ERROR", createdAt: new Date(NOW.getTime() - 10 * 60_000) }, NOW)).toBe(true);
    expect(qaPaused({ verdict: "ERROR", createdAt: new Date(NOW.getTime() - 2 * H) }, NOW)).toBe(false);
    expect(qaPaused({ verdict: "REJECTED", createdAt: NOW }, NOW)).toBe(false);
    expect(qaPaused(null, NOW)).toBe(false);
  });
});
