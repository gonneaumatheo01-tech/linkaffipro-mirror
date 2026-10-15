/**
 * Aucun lien de l'administration n'ouvre la vraie page publique d'une page d'atterrissage (phase 15) : ouverte par
 * l'équipe, elle compterait une visite, un clic et une ouverture de Telegram comme une vraie personne, et ses pixels
 * enverraient PageView et ClickButton aux régies depuis nos navigateurs. Pour voir une page, l'administration montre
 * son aperçu (même rendu, sans script, sans envoi, sans pixel : `PagePreviewDialog`). L'adresse publique reste
 * affichée et copiée (« Copier le lien ») : c'est elle qu'on colle dans la pub.
 * Contrôle statique des sources (comme no-legacy-addresses) : il tourne à chaque `pnpm test`.
 * Hors périmètre : `app/j/` (la page publique elle-même) et `scripts/` (outillage de mesure).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");
const ROOTS = ["app", "components", "lib"].map((d) => join(WEB, d));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap(sourceFiles)
  .map((f) => ({ rel: relative(WEB, f).split("\\").join("/"), src: readFileSync(f, "utf8") }))
  .filter((f) => !f.rel.startsWith("app/j/"));

/** Fonctions qui donnent l'adresse publique d'une page. */
const BUILDER = /\b(?:sourcePublicUrl|landingPublicUrl)\(/;
/** Variables du fichier qui reçoivent une adresse publique (`const url = sourcePublicUrl(…)`). */
function publicUrlVars(src: string): string[] {
  return [
    ...src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*(?:sourcePublicUrl|landingPublicUrl)\(/g),
  ].map((m) => m[1]!);
}

/** Expressions `href={…}` d'une ligne, accolades équilibrées (une adresse `${…}/j/${…}` comprise). */
function hrefExpressions(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\bhref=\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < line.length && depth > 0; i++) {
      if (line[i] === "{") depth++;
      else if (line[i] === "}") depth--;
    }
    out.push(line.slice(start, depth === 0 ? i - 1 : i));
  }
  return out;
}

/** Lignes qui ouvrent une adresse publique : `href={…}`, `window.open(…)`, `location.href = …`. */
function publicPageOpeners(src: string): number[] {
  const vars = publicUrlVars(src);
  const opensPublic = (expr: string) =>
    BUILDER.test(expr) ||
    /\/j\//.test(expr) ||
    vars.some((v) => new RegExp(`(?<![\\w.])${v}(?![\\w])`).test(expr));
  const out: number[] = [];
  src.split("\n").forEach((line, i) => {
    const exprs = [
      ...hrefExpressions(line),
      ...[...line.matchAll(/\bhref="([^"]*)"/g)].map((m) => m[1]!),
      ...[...line.matchAll(/\bwindow\.open\(([^)]*)/g)].map((m) => m[1]!),
      ...[...line.matchAll(/\blocation\.(?:href|assign)\s*(?:=|\()\s*([^;]*)/g)].map((m) => m[1]!),
    ];
    if (exprs.some(opensPublic)) out.push(i + 1);
  });
  return out;
}

describe("la vraie page publique n'est jamais ouverte depuis l'administration", () => {
  it("trouve des sources à contrôler", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => BUILDER.test(f.src))).toBe(true);
  });

  it("repère les liens vers une adresse publique (contrôle du contrôle)", () => {
    const src = [
      'const publicUrl = sourcePublicUrl(env.trackingBaseUrl, page.slug, "");',
      '<a href={publicUrl} target="_blank">Ouvrir la page</a>',
      '<a href={sourcePublicUrl(base, slug, "tk01")}>Voir</a>',
      "<a href={`${base}/j/${slug}`}>Voir</a>",
      "window.open(publicUrl)",
      '<Link href="/pages">Pages</Link>',
      "<CopyLinkButton url={publicUrl} />",
    ].join("\n");
    expect(publicPageOpeners(src)).toEqual([2, 3, 4, 5]);
  });

  it("aucun lien, aucune ouverture d'une adresse publique de page", () => {
    const found = files.flatMap((f) =>
      publicPageOpeners(f.src).map(
        (n) => `${f.rel}:${n} : ${f.src.split("\n")[n - 1]!.trim().slice(0, 100)}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
