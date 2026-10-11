/**
 * Piège de Tailwind 4 : `outline-none` (ou `outline-hidden`) pose `--tw-outline-style: none`, que
 * `focus-visible:outline-2` réutilise. Sur un même élément, sans `focus-visible:outline-solid`, le contour de
 * focus clavier reste invisible (bouton, lien, onglet, case, interrupteur). Ce contrôle lit les sources : toute
 * chaîne de classes qui cumule les deux sans `outline-solid` est signalée.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");
const ROOTS = ["app", "components", "lib"].map((d) => join(WEB, d));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Chaînes littérales (guillemets doubles, simples ou accents graves) d'un fichier source. */
function literals(src: string): string[] {
  return src.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
}

/** Vrai si la chaîne de classes cache le contour de focus (règle pure, testée ci-dessous). */
function hidesFocusOutline(classList: string): boolean {
  const c = classList.split(/[\s"'`]+/).filter(Boolean);
  const removesOutline = c.some((x) => x === "outline-none" || x === "outline-hidden");
  if (!removesOutline) return false;
  for (const prefix of ["focus-visible:", "focus:"]) {
    const widens = c.some((x) => new RegExp(`^${prefix}outline-(\\d|\\[)`).test(x));
    const solid = c.some((x) =>
      new RegExp(`^${prefix}outline-(solid|dashed|dotted|double)$`).test(x),
    );
    if (widens && !solid) return true;
  }
  return false;
}

describe("contour de focus clavier (Tailwind 4)", () => {
  it("repère le piège outline-none + focus-visible:outline-2", () => {
    expect(
      hidesFocusOutline("outline-none focus-visible:outline-2 focus-visible:outline-ring"),
    ).toBe(true);
    expect(hidesFocusOutline("outline-hidden focus:outline-2")).toBe(true);
    expect(
      hidesFocusOutline(
        "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring",
      ),
    ).toBe(false);
    // Contour remplacé par un anneau et une bordure (champs) : visible, rien à signaler.
    expect(hidesFocusOutline("outline-none focus-visible:border-ring focus-visible:ring-3")).toBe(
      false,
    );
    // Sans outline-none, `--tw-outline-style` vaut « solid » par défaut.
    expect(hidesFocusOutline("focus-visible:outline-2 focus-visible:outline-ring")).toBe(false);
  });

  it("aucune chaîne de classes de l'interface ne cache le contour de focus", () => {
    const files = ROOTS.flatMap(sources);
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const f of files) {
      for (const lit of literals(readFileSync(f, "utf8"))) {
        if (hidesFocusOutline(lit)) offenders.push(`${relative(WEB, f)} : ${lit.slice(0, 90)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
