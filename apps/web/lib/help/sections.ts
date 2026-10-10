/**
 * Extraits du guide (fonctions pures, testées dans sections.test.ts) : retrouve une section de
 * docs/GUIDE-UTILISATEUR.md par son titre et rend son Markdown, pour le volet d'aide de la page courante.
 * Les identifiants d'ancre sont ceux de la page /help (même règle que `renderMarkdown`).
 */
import { slugify } from "./markdown";

export type GuideHeading = {
  /** Index de la ligne du titre. */
  line: number;
  level: number;
  text: string;
  /** Ancre de la page /help (unique, « -2 », « -3 »… pour les doublons). */
  id: string;
};

/** Référence à une section : son titre exact (ou presque : accents et ponctuation ignorés). */
export type SectionRef =
  | string
  | {
      title: string;
      /** Seulement le texte avant la première sous-section. */
      introOnly?: boolean;
    };

export type GuideSection = {
  title: string;
  id: string;
  level: number;
  /** Markdown de la section, titre compris. */
  markdown: string;
};

const HEADING_RE = /^(#{1,4})\s+(.+?)\s*#*\s*$/;

/** Titres du guide hors blocs de code, dans l'ordre, avec les ancres de la page /help. */
export function guideHeadings(markdown: string): GuideHeading[] {
  const lines = markdown.split(/\r?\n/);
  const seen = new Map<string, number>();
  const out: GuideHeading[] = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = HEADING_RE.exec(line);
    if (!m) return;
    const base = slugify(m[2]!) || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({
      line: i,
      level: m[1]!.length,
      text: m[2]!,
      id: n === 0 ? base : `${base}-${n + 1}`,
    });
  });
  return out;
}

function refTitle(ref: SectionRef): string {
  return typeof ref === "string" ? ref : ref.title;
}

/** Titre du guide correspondant à une référence (comparaison sans accents ni ponctuation). */
export function findHeading(
  headings: readonly GuideHeading[],
  ref: SectionRef,
): GuideHeading | null {
  const wanted = slugify(refTitle(ref));
  return headings.find((h) => slugify(h.text) === wanted) ?? null;
}

/**
 * Sections demandées, dans l'ordre des références : du titre jusqu'au prochain titre de même niveau ou plus haut
 * (sous-sections comprises), ou jusqu'au prochain titre quel qu'il soit avec `introOnly`. Les titres introuvables
 * sont ignorés ; une même section n'est rendue qu'une fois.
 */
export function guideSections(markdown: string, refs: readonly SectionRef[]): GuideSection[] {
  const lines = markdown.split(/\r?\n/);
  const headings = guideHeadings(markdown);
  const out: GuideSection[] = [];
  const taken = new Set<string>();
  for (const ref of refs) {
    const h = findHeading(headings, ref);
    if (!h || taken.has(h.id)) continue;
    taken.add(h.id);
    const introOnly = typeof ref === "object" && ref.introOnly === true;
    const next = headings.find((o) => o.line > h.line && (introOnly || o.level <= h.level));
    const end = next ? next.line : lines.length;
    out.push({
      title: h.text,
      id: h.id,
      level: h.level,
      markdown: lines.slice(h.line, end).join("\n").trim(),
    });
  }
  return out;
}
