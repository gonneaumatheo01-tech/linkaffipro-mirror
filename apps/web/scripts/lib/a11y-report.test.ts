import { describe, expect, it } from "vitest";
import {
  blockingPages,
  countByImpact,
  formatSummary,
  isBlocking,
  toPageViolations,
  type A11yPageResult,
} from "./a11y-report";

const axeViolations = [
  {
    id: "color-contrast",
    impact: "serious",
    help: "Contraste insuffisant",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
    nodes: [{ target: [".a"] }, { target: [".b"] }],
  },
  {
    id: "button-name",
    impact: "critical",
    help: "Les boutons doivent avoir un texte",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.13/button-name",
    nodes: [{ target: ["#x"] }],
  },
  { id: "region", impact: null, help: "Région", helpUrl: "", nodes: [] },
];

function page(over: Partial<A11yPageResult>): A11yPageResult {
  return {
    route: "/",
    path: "/",
    status: "ok",
    httpStatus: 200,
    note: null,
    violations: toPageViolations(axeViolations),
    ...over,
  };
}

describe("rapport axe", () => {
  it("garde l'essentiel de chaque violation (règle, gravité, aide, nombre d'éléments, 5 cibles au plus)", () => {
    const v = toPageViolations([
      {
        id: "x",
        impact: "minor",
        help: "h",
        helpUrl: "u",
        nodes: Array.from({ length: 8 }, (_, i) => ({ target: [`#n${i}`] })),
      },
    ]);
    expect(v).toEqual([
      {
        id: "x",
        impact: "minor",
        help: "h",
        helpUrl: "u",
        nodes: 8,
        targets: ["#n0", "#n1", "#n2", "#n3", "#n4"],
      },
    ]);
  });

  it("gravité bloquante selon --fail-on", () => {
    expect(isBlocking("critical", "critical")).toBe(true);
    expect(isBlocking("serious", "critical")).toBe(false);
    expect(isBlocking("serious", "serious")).toBe(true);
    expect(isBlocking("minor", "moderate")).toBe(false);
    expect(isBlocking(null, "minor")).toBe(false);
  });

  it("compte les règles en violation par gravité, toutes pages confondues", () => {
    expect(countByImpact([page({}), page({ route: "/members" })])).toEqual({
      critical: 2,
      serious: 2,
      moderate: 0,
      minor: 0,
    });
  });

  it("pages bloquantes : seulement celles qui ont une violation au niveau demandé", () => {
    const ok = page({ route: "/ok", violations: toPageViolations([axeViolations[0]!]) });
    expect(blockingPages([page({}), ok], "critical").map((p) => p.route)).toEqual(["/"]);
    expect(blockingPages([page({}), ok], "serious").map((p) => p.route)).toEqual(["/", "/ok"]);
  });

  it("résumé lisible en console", () => {
    const lines = formatSummary(
      [page({}), page({ route: "/stats", status: "absent", httpStatus: 404, violations: [] })],
      "critical",
    );
    const text = lines.join("\n");
    expect(text).toContain("/ : 1 critical, 1 serious");
    expect(text).toContain("button-name");
    expect(text).toContain("/stats : absente (404)");
    expect(text).toMatch(/1 page\(s\) avec une violation « critical »/);
  });
});
