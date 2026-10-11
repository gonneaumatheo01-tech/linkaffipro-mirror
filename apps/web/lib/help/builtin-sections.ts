/**
 * Sections d'aide écrites ici en attendant leur place dans docs/GUIDE-UTILISATEUR.md (fonctions pures, testées dans
 * builtin-sections.test.ts). Le guide prime : dès qu'il contient un titre de même nom, la section d'ici est ignorée
 * (elle peut alors être supprimée). Sinon, elle est insérée dans le guide avant le titre `before` (ou à la fin), pour
 * le volet « ? » comme pour la page /help : même texte, même ancre.
 * Pourquoi : un écran refait peut être mis en ligne avant la réécriture du guide ; son aide ne doit pas renvoyer, en
 * attendant, vers l'écran d'avant.
 *
 * Liste vide depuis la réécriture du guide (phase 9) : le guide contient toutes les sections, Accueil compris. Pour
 * un nouvel écran, ajoutez ici sa section le temps de l'écrire dans le guide (un test vérifie le vocabulaire).
 */
import { guideHeadings } from "./sections";
import { slugify } from "./markdown";

export type BuiltinSection = {
  /** Titre de niveau 2 (`## …`) : celui qu'emploie `PAGE_HELP`. */
  title: string;
  /** Titre de niveau 2 du guide devant lequel insérer la section ; absent ou introuvable : à la fin du guide. */
  before?: string;
  /** Markdown complet de la section, titre compris. */
  markdown: string;
};

export const BUILTIN_SECTIONS: readonly BuiltinSection[] = [];

/**
 * Guide complété des sections intégrées qu'il ne contient pas encore (comparaison des titres sans accents ni
 * ponctuation, comme `findHeading`). Chaque section manquante est insérée avant son titre `before` de niveau 2, ou à
 * la fin. Un guide qui a déjà toutes les sections est rendu tel quel.
 */
export function withBuiltinSections(
  markdown: string,
  builtins: readonly BuiltinSection[] = BUILTIN_SECTIONS,
): string {
  let out = markdown;
  for (const b of builtins) {
    const headings = guideHeadings(out);
    const wanted = slugify(b.title);
    if (headings.some((h) => slugify(h.text) === wanted)) continue;
    const anchor = b.before
      ? headings.find((h) => h.level === 2 && slugify(h.text) === slugify(b.before!))
      : undefined;
    const section = b.markdown.trim();
    if (!anchor) {
      out = `${out.replace(/\s+$/, "")}\n\n${section}\n`;
      continue;
    }
    const lines = out.split(/\r?\n/);
    lines.splice(anchor.line, 0, section, "");
    out = lines.join("\n");
  }
  return out;
}
