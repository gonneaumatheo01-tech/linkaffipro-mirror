/**
 * Typographie française : les guillemets « » sont collés à leur texte par une espace insécable (U+00A0), sinon le
 * navigateur peut couper la ligne entre « et le mot (« le bouton « » en fin de ligne, puis « Améliorer… » »).
 * Contrôle statique des sources : pas de « suivi d'une espace normale ni d'un retour à la ligne, pas d'espace normale
 * avant ». Les commentaires ne sont pas lus. Écriture : `« Mot »` (caractère insécable dans le texte JSX ou
 * une chaîne, `{" "}` entre deux expressions JSX).
 *
 * Périmètre : les écrans déjà corrigés (Statistiques, Réglages, Mon compte, Aide, guide de style, pages publiques)
 * et leurs composants (fichiers `.tsx`, plus les fichiers `.ts` listés) ; à étendre à tout `app/` et `components/`,
 * puis aux messages de retour des actions (`actions.ts`), quand les autres écrans le seront.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

const SCOPE = [
  "app/(admin)/stats",
  "app/(admin)/settings",
  "app/(admin)/account",
  "app/(admin)/help",
  "app/(admin)/styleguide",
  "app/(admin)/not-found.tsx",
  "app/privacy",
  "app/terms",
  "components/dashboard",
  "components/settings",
  "lib/status/telegram-error.ts",
];

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => {
    const p = join(path, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [p] : [];
  });
}

/** Lignes fautives d'un source (`n° : texte`), commentaires exclus. */
export function guillemetIssues(src: string): string[] {
  const out: string[] = [];
  src.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("//")) return;
    if (/« |«$|«\{" "\}| »|^»/.test(t)) out.push(`${i + 1} : ${t}`);
  });
  return out;
}

describe("guillemets français", () => {
  it("la règle repère les espaces sécables et les coupures autour des guillemets", () => {
    expect(guillemetIssues('label="le bouton « Améliorer »"')).toHaveLength(1);
    expect(guillemetIssues("puis «\n  Enregistrer ».")).toHaveLength(1);
    expect(guillemetIssues('entre «{" "}\n{label} »')).toHaveLength(1);
    expect(guillemetIssues("le bouton « Améliorer avec l'IA »")).toEqual([]);
    expect(guillemetIssues(" * Commentaire « libre » ignoré")).toEqual([]);
  });

  it("les écrans corrigés n'ont plus de guillemet séparable de son texte", () => {
    const files = SCOPE.flatMap((p) => sourceFiles(join(WEB, p)));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.flatMap((f) =>
      guillemetIssues(readFileSync(f, "utf-8")).map((l) => `${relative(WEB, f)}:${l}`),
    );
    expect(offenders).toEqual([]);
  });
});
