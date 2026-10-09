/**
 * Contrôle statique d'accessibilité sur les écrans de l'interface : pas d'image sans `alt`,
 * pas de bouton icône (`size="icon"`) sans libellé, pas de champ de saisie sans identifiant ni `aria-label`.
 * Un vrai rendu de chaque page exigerait une base : ce contrôle lit les sources TSX, ce qui couvre déjà
 * les oublis les plus fréquents, à chaque exécution des tests.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = [join(__dirname, "..", "..", "app", "(admin)"), join(__dirname, "..", "..", "components")];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

/** Balises ouvrantes complètes (`<img …>` / `<Button …>`), multi-lignes comprises. */
function tags(src: string, name: string): string[] {
  // `=>` (fonctions fléchées dans les attributs) ne termine pas la balise.
  const re = new RegExp(`<${name}\\b(?:=>|[^>])*?>`, "gs");
  return src.match(re) ?? [];
}

const files = ROOTS.flatMap(tsxFiles);

describe("accessibilité statique des écrans", () => {
  it("trouve des écrans à contrôler", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("chaque <img> a un attribut alt", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const t of tags(readFileSync(f, "utf8"), "img")) if (!/\balt=/.test(t)) offenders.push(`${f.split("/apps/web/")[1]} : ${t.slice(0, 60)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("chaque bouton icône a un aria-label ou un title", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const t of tags(readFileSync(f, "utf8"), "Button")) {
        if (/size="icon"/.test(t) && !/aria-label=|title=/.test(t)) offenders.push(`${f.split("/apps/web/")[1]} : ${t.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("chaque champ de saisie natif a un id, un aria-label ou un aria-labelledby (ou est caché)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const t of [...tags(src, "input"), ...tags(src, "select"), ...tags(src, "textarea"), ...tags(src, "Input")]) {
        // Cases à cocher, boutons radio et champs fichier sont enveloppés dans un <label> (libellé implicite) ; les primitives ui/ sont libellées par leurs utilisateurs.
        if (/type=(\{[^}]*\}|"(hidden|checkbox|radio|file)")/.test(t) || f.includes("/components/ui/")) continue;
        if (!/\bid=|aria-label=|aria-labelledby=/.test(t)) offenders.push(`${f.split("/apps/web/")[1]} : ${t.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
