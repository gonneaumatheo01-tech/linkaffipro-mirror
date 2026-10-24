/**
 * Fiche d'informations d'une persona (phase 25) : questions / réponses, seule source de ce que l'assistante peut
 * affirmer (bonus, dépôt minimum, pays, délais de retrait, VIP) ; tout le reste, elle le transmet à l'équipe.
 * Fonctions pures (navigateur et serveur), testées dans faq.test.ts :
 * - lecture tolérante de la colonne `Persona.faq` (`cleanFaq`) ;
 * - règle d'une entrée et de la fiche entière (`faqEntryProblem`, `validateFaq`) : 40 entrées au plus
 *   (`PERSONA_FAQ_MAX`), question de 300 caractères au plus, réponse de 1000 au plus, rien de vide, pas deux fois la
 *   même question ;
 * - import d'un fichier tableur `question;réponse` (`parseCsv`, `previewFaqImport`) : séparateur « ; », guillemets
 *   standard (« "" » pour un guillemet, point-virgule et retour à la ligne permis entre guillemets), ligne d'en-tête
 *   facultative reconnue, marque d'encodage (BOM) tolérée, lignes vides ignorées.
 */
import {
  PERSONA_FAQ_A_MAX,
  PERSONA_FAQ_MAX,
  PERSONA_FAQ_Q_MAX,
  type PersonaFaqEntry,
} from "@linkaffipro/core";

export type { PersonaFaqEntry };

export const FAQ_LIMITS = {
  max: PERSONA_FAQ_MAX,
  question: PERSONA_FAQ_Q_MAX,
  answer: PERSONA_FAQ_A_MAX,
} as const;

/** Question : espaces regroupés sur une ligne. Réponse : retours à la ligne gardés, espaces en trop retirés. */
export function cleanQuestion(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}

export function cleanAnswer(a: string): string {
  return a
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const chars = (s: string) => Array.from(s).length;

/** Fiche enregistrée (JSON quelconque) → entrées lisibles, dans l'ordre ; tout le reste est ignoré. */
export function cleanFaq(raw: unknown): PersonaFaqEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonaFaqEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { q, a } = e as { q?: unknown; a?: unknown };
    if (typeof q !== "string" || typeof a !== "string") continue;
    out.push({ q, a });
  }
  return out;
}

/** Ce qui ne va pas dans une entrée (null : acceptée). Les textes sont lus nettoyés. */
export function faqEntryProblem(e: PersonaFaqEntry): string | null {
  const q = cleanQuestion(e.q);
  const a = cleanAnswer(e.a);
  if (!q && !a) return "Question et réponse vides.";
  if (!q) return "La question est vide.";
  if (!a) return "La réponse est vide.";
  if (chars(q) > FAQ_LIMITS.question)
    return `Question trop longue (${FAQ_LIMITS.question} caractères au plus).`;
  if (chars(a) > FAQ_LIMITS.answer)
    return `Réponse trop longue (${FAQ_LIMITS.answer} caractères au plus).`;
  return null;
}

const questionKey = (q: string) => cleanQuestion(q).toLocaleLowerCase("fr");

export type FaqValidation = { ok: true; faq: PersonaFaqEntry[] } | { ok: false; error: string };

/** Fiche complète : nettoyée et vérifiée (le premier problème trouvé est rapporté, avec le numéro de l'entrée). */
export function validateFaq(entries: readonly PersonaFaqEntry[]): FaqValidation {
  if (entries.length > FAQ_LIMITS.max)
    return {
      ok: false,
      error: `${FAQ_LIMITS.max} questions au plus dans la fiche d'informations (il y en a ${entries.length}).`,
    };
  const seen = new Set<string>();
  const faq: PersonaFaqEntry[] = [];
  for (const [i, e] of entries.entries()) {
    const problem = faqEntryProblem(e);
    if (problem) return { ok: false, error: `Question n° ${i + 1} : ${problem}` };
    const key = questionKey(e.q);
    if (seen.has(key))
      return { ok: false, error: `Question n° ${i + 1} : cette question est déjà dans la fiche.` };
    seen.add(key);
    faq.push({ q: cleanQuestion(e.q), a: cleanAnswer(e.a) });
  }
  return { ok: true, faq };
}

/** Deux fiches identiques (mêmes questions et réponses, dans le même ordre, une fois nettoyées). */
export function sameFaq(a: readonly PersonaFaqEntry[], b: readonly PersonaFaqEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (e, i) =>
      cleanQuestion(e.q) === cleanQuestion(b[i]!.q) && cleanAnswer(e.a) === cleanAnswer(b[i]!.a),
  );
}

// ------------------------------------------------------------------
// Import d'un fichier tableur
// ------------------------------------------------------------------

/** Une ligne lue : ses cellules et son numéro de ligne dans le fichier (1 = première ligne). */
export type CsvRow = { line: number; cells: string[] };

/**
 * Lecture d'un texte tableur (séparateur « ; » par défaut) : guillemets standard (une cellule entre guillemets peut
 * contenir le séparateur, des retours à la ligne et « "" » pour un guillemet), marque d'encodage retirée, fins de
 * ligne Windows / Mac / Unix. Les lignes entièrement vides sont omises.
 */
export function parseCsv(text: string, sep = ";"): CsvRow[] {
  const src = text.replace(/^﻿/, "");
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowLine, cells });
    cells = [];
    cell = "";
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n" || (ch === "\r" && src[i + 1] !== "\n")) line++;
        cell += ch === "\r" ? "" : ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === sep) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== "" || cells.length > 0) endRow();
  return rows;
}

const HEADER_Q = /^(questions?|q)$/;
const HEADER_A = /^(r[ée]ponses?|a|r|answers?)$/;
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s:]+$/, "");

/** Première ligne « question;réponse » (ou « Question ; Réponse », « q;a »…) : ligne d'en-tête, ignorée. */
export function isFaqHeader(cells: readonly string[]): boolean {
  return cells.length >= 2 && HEADER_Q.test(norm(cells[0]!)) && HEADER_A.test(norm(cells[1]!));
}

export type FaqImportMode = "add" | "replace";

export type FaqImportPreview = {
  /** Lignes retenues, dans l'ordre du fichier. */
  accepted: Array<{ line: number; q: string; a: string }>;
  /** Lignes refusées et pourquoi (dont celles au-delà de 40). */
  refused: Array<{ line: number; text: string; reason: string }>;
  /** Une ligne d'en-tête a été reconnue (et ignorée). */
  header: boolean;
  /** Lignes valables mais en trop (au-delà de 40 entrées dans la fiche). */
  overflow: number;
  /** Fiche obtenue si l'on confirme. */
  result: PersonaFaqEntry[];
};

const excerpt = (cells: readonly string[]) => {
  const t = cells.join(" ; ").replace(/\s+/g, " ").trim();
  return chars(t) > 80 ? `${Array.from(t).slice(0, 79).join("")}…` : t;
};

/**
 * Aperçu d'un import : chaque ligne du fichier est retenue ou refusée (avec la raison, en mots simples). En mode
 * « add », les lignes s'ajoutent à la fiche actuelle (une question déjà présente est refusée) ; en mode « replace »,
 * la fiche est remplacée par le fichier. Au-delà de 40 entrées, les lignes en trop sont refusées et comptées.
 */
export function previewFaqImport(
  text: string,
  existing: readonly PersonaFaqEntry[],
  mode: FaqImportMode,
): FaqImportPreview {
  const rows = parseCsv(text);
  const header = rows.length > 0 && isFaqHeader(rows[0]!.cells);
  const base = mode === "add" ? existing.map((e) => ({ q: e.q, a: e.a })) : [];
  const seen = new Set(base.map((e) => questionKey(e.q)));
  const accepted: FaqImportPreview["accepted"] = [];
  const refused: FaqImportPreview["refused"] = [];
  let overflow = 0;
  for (const row of header ? rows.slice(1) : rows) {
    // Cellules vides en fin de ligne (fréquentes à l'export d'un tableur) : ignorées.
    const cells = [...row.cells];
    while (cells.length > 2 && cells[cells.length - 1]!.trim() === "") cells.pop();
    const text = excerpt(cells);
    if (cells.length < 2) {
      refused.push({
        line: row.line,
        text,
        reason: "Pas de point-virgule : écrivez « question;réponse ».",
      });
      continue;
    }
    if (cells.length > 2) {
      refused.push({
        line: row.line,
        text,
        reason:
          "Plus de deux colonnes : si la réponse contient un point-virgule, mettez-la entre guillemets.",
      });
      continue;
    }
    const entry = { q: cells[0]!, a: cells[1]! };
    const problem = faqEntryProblem(entry);
    if (problem) {
      refused.push({ line: row.line, text, reason: problem });
      continue;
    }
    const key = questionKey(entry.q);
    if (seen.has(key)) {
      refused.push({ line: row.line, text, reason: "Question déjà dans la fiche." });
      continue;
    }
    if (base.length + accepted.length >= FAQ_LIMITS.max) {
      overflow++;
      refused.push({
        line: row.line,
        text,
        reason: `En trop : la fiche compte déjà ${FAQ_LIMITS.max} questions.`,
      });
      continue;
    }
    seen.add(key);
    accepted.push({ line: row.line, q: cleanQuestion(entry.q), a: cleanAnswer(entry.a) });
  }
  return {
    accepted,
    refused,
    header,
    overflow,
    result: [...base, ...accepted.map(({ q, a }) => ({ q, a }))],
  };
}

/** Déplace une entrée d'un cran vers le haut (-1) ou vers le bas (+1) ; sans effet aux extrémités. */
export function moveFaqEntry<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}
