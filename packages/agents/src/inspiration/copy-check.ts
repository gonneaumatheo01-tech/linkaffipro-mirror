/**
 * Phase 27 — contrôle « jamais de copie » (règle 1) : un texte produit ne partage jamais 8 mots consécutifs avec un post
 * de référence. Les suites de 8 mots des posts de référence sont gardées HACHÉES (`ReferencePost.shingles`) : le
 * contrôle marche encore après l'effacement du texte brut (30 jours). Fonctions pures.
 *
 * Normalisation résistante aux contournements (relecture adverse) : balises HTML retirées, entités décodées (nommées
 * courantes et numériques, même doublement encodées), lettres stylisées ramenées aux lettres simples (NFKD : gras
 * mathématique, pleine chasse, lettres entourées ; petites capitales et sosies cyrilliques / grecs par table),
 * caractères invisibles supprimés (espaces de largeur nulle, joints, trait d'union conditionnel, marques de sens…), et
 * mots coupés par un tiret (« limi-tées », « limi-\ntées ») recollés. Comme « écris-moi » et « écris moi » doivent
 * rester la même suite, chaque tiret entre deux lettres se lit des deux façons (séparateur ou mot recollé) : les
 * empreintes gardées et le contrôle couvrent toutes les combinaisons d'une fenêtre de 8 mots (32 au plus). Lecture
 * « tirets = séparateurs » = découpage d'avant : les empreintes déjà gardées d'un texte ordinaire restent valables.
 */
import { createHash } from "node:crypto";

/** Longueur de la suite de mots interdite. */
export const COPY_SHINGLE_WORDS = 8;
/** Une citation dans un rapport fait 10 mots au plus. */
export const MAX_QUOTE_WORDS = 10;
/** Version de la normalisation (repère `Setting inspiration.shinglesV2` du recalcul des empreintes gardées). */
export const COPY_NORMALIZATION_VERSION = 2;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  shy: "", zwj: "", zwnj: "", lrm: "", rlm: "", NoBreak: "", ZeroWidthSpace: "", hyphen: "-", dash: "-",
  ndash: "-", mdash: "-", minus: "-", lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"', rdquo: '"', bdquo: '"',
  laquo: '"', raquo: '"', hellip: "...", middot: "·", bull: "•", euro: "€", aelig: "ae", AElig: "AE", oelig: "oe",
  OElig: "OE", szlig: "ss", copy: " ", reg: " ", trade: " ",
};
const ACCENT_ENTITY = /^([A-Za-z])(acute|grave|circ|uml|tilde|cedil|ring|slash|caron)$/;

/** Décode les entités HTML nommées courantes et numériques (`&#39;`, `&#x27;`) ; inconnue : laissée telle quelle. */
export function decodeCopyEntities(s: string): string {
  let out = s;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (all, code: string) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
      }
      if (code in NAMED_ENTITIES) return NAMED_ENTITIES[code]!;
      const lower = code.toLowerCase();
      if (lower in NAMED_ENTITIES) return NAMED_ENTITIES[lower]!;
      const acc = ACCENT_ENTITY.exec(code);
      return acc ? acc[1]! : all;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

const BLOCK_TAG = /<\/?(?:br|p|div|li|ul|ol|blockquote|pre|tr|td|th|h[1-6]|hr)\b[^<>]*>/gi;
const ANY_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/g;

/** Retire les balises HTML (bloc → espace, en ligne → rien : « <b>limi</b>tées » reste un mot). */
export function stripCopyHtml(s: string): string {
  return s.replace(BLOCK_TAG, " ").replace(ANY_TAG, "");
}

/** Caractères invisibles ou de mise en forme (supprimés, jamais des séparateurs). */
const INVISIBLE =
  /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}]/gu;

/** Petites capitales et sosies cyrilliques / grecs que NFKD ne ramène pas aux lettres latines. */
const LOOKALIKES: Record<string, string> = {
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k", ʟ: "l", ᴍ: "m", ɴ: "n",
  ᴏ: "o", ᴘ: "p", ǫ: "q", ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w", ʏ: "y", ᴢ: "z",
  // Cyrillique
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ѕ: "s",
  і: "i", ї: "i", ј: "j", ԁ: "d", ԛ: "q", ԝ: "w", һ: "h", ӏ: "l",
  // Grec
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKES).join("")}]`, "gu");

/** Tiret ou point médian seul entre deux lettres (« limi-tées », « limi-\ntées » en fin de ligne, « limité·es »). */
const INNER_HYPHEN_GAP = /^[-\u2010-\u2015\u2212\uFE63\u00B7\u2027][ \t]*(?:\r?\n[ \t]*)?$/u;
const PIECE = /[\p{L}\p{N}]+/gu;

/** Texte nettoyé (balises, entités, invisibles, lettres stylisées, accents, casse ; liens et mentions retirés). */
function cleanText(text: string): string {
  return decodeCopyEntities(stripCopyHtml(text))
    .replace(ANY_TAG, "")
    .replace(INVISIBLE, "")
    .normalize("NFKD")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(LOOKALIKE_RE, (c) => LOOKALIKES[c] ?? c)
    .replace(/https?:\/\/\S+|t\.me\/\S+|@\w+/g, " ");
}

type Pieces = { pieces: string[]; /** `links[i]` : les morceaux i et i+1 sont reliés par un tiret entre deux lettres. */ links: boolean[] };

function piecesOf(text: string): Pieces {
  const clean = cleanText(text);
  const pieces: string[] = [];
  const links: boolean[] = [];
  let prevEnd = -1;
  for (const m of clean.matchAll(PIECE)) {
    if (pieces.length) {
      const gap = clean.slice(prevEnd, m.index);
      const prev = pieces[pieces.length - 1]!;
      links.push(INNER_HYPHEN_GAP.test(gap) && /\p{L}$/u.test(prev) && /^\p{L}/u.test(m[0]));
    }
    pieces.push(m[0]);
    prevEnd = m.index + m[0].length;
  }
  return { pieces, links };
}

/** Choix « recollé » explorés au plus par fenêtre (au-delà : tirets = séparateurs). */
const MAX_JOIN_BRANCHES = 32;

/**
 * Toutes les suites de `n` mots d'un texte, pour chaque façon de lire ses tirets entre deux lettres (séparateur ou mot
 * recollé) : « écris-moi » donne « ecris moi » et « ecrismoi », « limi-tées » donne « limi tees » et « limitees ». Le
 * même énumérateur sert aux empreintes gardées et au contrôle : un texte qui mélange les deux façons est reconnu.
 */
function windowsOf(text: string, n: number, visit: (seq: string) => boolean): void {
  const { pieces, links } = piecesOf(text);
  for (let start = 0; start + 1 <= pieces.length; start++) {
    let budget = MAX_JOIN_BRANCHES;
    let stop = false;
    const walk = (pos: number, words: string[], cur: string): void => {
      if (stop) return;
      const next = pos + 1;
      if (links[pos] && next < pieces.length && budget > 0) {
        budget--;
        walk(next, words, cur + pieces[next]!);
        if (stop) return;
      }
      const done = [...words, cur];
      if (done.length === n) {
        if (visit(done.join(" "))) stop = true;
        return;
      }
      if (next < pieces.length) walk(next, done, pieces[next]!);
    };
    walk(start, [], pieces[start]!);
    if (stop) return;
  }
}

/** Mots normalisés, tirets = séparateurs (minuscules, sans accents, sans ponctuation ni emojis ; liens et mentions retirés). */
export function copyWords(text: string): string[] {
  return piecesOf(text).pieces;
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Empreintes des suites de `n` mots d'un texte (sans doublon), toutes lectures des tirets comprises. */
export function shingleHashes(text: string, n = COPY_SHINGLE_WORDS): string[] {
  const out = new Set<string>();
  windowsOf(text, n, (seq) => {
    out.add(hash(seq));
    return false;
  });
  return [...out];
}

/** Empreinte du texte entier (normalisé, tirets = séparateurs). */
export function textHash(text: string): string {
  return hash(copyWords(text).join(" "));
}

/**
 * Le texte copie-t-il un post de référence ? Rend la suite de 8 mots fautive (normalisée), ou null. Les appelants ne
 * l'écrivent JAMAIS dans un journal, un motif ou un profil (fragment d'un texte de référence gardé au-delà de 30 jours) :
 * ils écrivent seulement « 8 mots repris d'un post de référence » (`COPY_PROBLEM`).
 * `referenceShingles` : empreintes déjà gardées (`ReferencePost.shingles`) de tous les posts des références liées.
 */
export function copiedSequence(text: string, referenceShingles: Iterable<string>, n = COPY_SHINGLE_WORDS): string | null {
  const refs = referenceShingles instanceof Set ? (referenceShingles as Set<string>) : new Set(referenceShingles);
  if (refs.size === 0) return null;
  let found: string | null = null;
  windowsOf(text, n, (seq) => {
    if (!refs.has(hash(seq))) return false;
    found = seq;
    return true;
  });
  return found;
}

/** Motif écrit quand un texte reprend 8 mots d'un post de référence (sans les mots). */
export const COPY_PROBLEM = "8 mots repris d'un post de référence";

/** Coupe une citation à 10 mots au plus (« … » si coupée). */
export function shortQuote(text: string, max = MAX_QUOTE_WORDS): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.length <= max ? words.join(" ") : `${words.slice(0, max).join(" ")} …`;
}
