import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Mini-carte de l'éditeur (relecture phase 10) : sur un long parcours, des blocs pâles à bordure de moins d'un pixel,
// délavés par le voile, étaient indiscernables. On garde des fonds francs, une bordure fixe à l'écran et un voile léger.
const css = readFileSync(join(__dirname, "flow.css"), "utf8");

/** Déclarations d'une règle (sélecteur exact). */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `règle ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("mini-carte du parcours : lisible une fois réduite", () => {
  it("bordure d'épaisseur fixe à l'écran (pas réduite avec le parcours)", () => {
    const node = rule(".lap-flow .react-flow__minimap-node");
    expect(node).toMatch(/vector-effect:\s*non-scaling-stroke/);
    expect(node).toMatch(/stroke-width:\s*1\.5px/);
  });

  it("fond franc de la couleur du type de bloc (pas le fond pâle des pastilles)", () => {
    for (const type of ["trigger", "condition", "action", "wait", "stop", "invalid"]) {
      const r = rule(`.lap-flow .react-flow__minimap-node.is-${type}`);
      expect(r, type).toMatch(
        /fill:\s*color-mix\(in oklab, var\(--[a-z-]+\) (4\d|50)%, var\(--surface\)\)/,
      );
      expect(r, type).not.toMatch(/fill:\s*var\(--[a-z]+-soft\)/);
    }
  });

  it("voile hors de la vue léger (les blocs restent visibles dessous)", () => {
    expect(css.replace(/\s+/g, " ")).toContain(
      "--xy-minimap-mask-background-color-default: color-mix( in oklab, var(--background) 45%, transparent );",
    );
  });
});
