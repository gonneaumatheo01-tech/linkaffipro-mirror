import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Emplacements possibles du guide. En développement, Next tourne depuis `apps/web` ; en production,
 * le conteneur copie le monorepo dans `/app` et démarre depuis `/app/apps/web`. Le premier fichier lisible gagne.
 */
export function guideCandidates(cwd = process.cwd()): string[] {
  return [
    path.resolve(cwd, "docs", "GUIDE-UTILISATEUR.md"),
    path.resolve(cwd, "..", "..", "docs", "GUIDE-UTILISATEUR.md"),
    path.resolve("/app", "docs", "GUIDE-UTILISATEUR.md"),
  ];
}

export type GuideFile = { markdown: string; path: string } | { markdown: null; tried: string[] };

export async function loadGuide(): Promise<GuideFile> {
  const tried = guideCandidates();
  for (const p of tried) {
    try {
      const markdown = await readFile(p, "utf8");
      if (markdown.trim()) return { markdown, path: p };
    } catch {
      // chemin suivant
    }
  }
  return { markdown: null, tried };
}
