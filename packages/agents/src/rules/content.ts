/**
 * Règles de contenu d'un post d'agent, vérifiées par le code (jamais par l'IA) : pas de mention d'IA ni d'assistant
 * (6 langues : fr en es pt de it), aucun lien hors des liens suivis de la plateforme, longueur maximale réglable
 * (comptée sur le texte visible), mots interdits de l'équipe, HTML Telegram valide. Fonctions pures.
 */
import { stripHtml, textLength, validateTelegramHtml, TELEGRAM_TEXT_MAX } from "@linkaffipro/core";

export const DEFAULT_MAX_TEXT_LENGTH = 900;
/** Seuls domaines autorisés dans un post : nos liens suivis (`TrackingLink`, `go.goolink.eu`). */
export const DEFAULT_ALLOWED_LINK_HOSTS: readonly string[] = ["go.goolink.eu"];

export type ContentProblemCode = "empty" | "html" | "too_long" | "ai_mention" | "foreign_link" | "forbidden_word";
export type ContentProblem = { code: ContentProblemCode; message: string };
export type ContentCheck = { ok: boolean; problems: ContentProblem[] };

export type ContentRulesOptions = {
  maxLength?: number;
  forbiddenWords?: readonly string[];
  allowedHosts?: readonly string[];
};

/** Minuscules, sans accents, ponctuation → espace (comparaisons de mots). */
export function normalizeWords(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Tournures qui parlent d'IA ou d'assistant, sur le texte normalisé (sans accents, minuscules).
const AI_WORD_PATTERNS: readonly RegExp[] = [
  // fr
  /\bintelligence artificielle\b/,
  /\bgenere (?:par|automatiquement|avec)\b/,
  /\becrit par (?:une? )?(?:ia|machine|programme|robot)\b/,
  /\bmodele de langage\b/,
  /\ben tant qu (?:ia|assistante?|intelligence)\b/,
  // en
  /\bartificial intelligence\b/,
  /\b(?:ai|machine) generated\b/,
  /\bgenerated (?:by|with|using)\b/,
  /\blanguage model\b/,
  /\bas an (?:ai|assistant|language)\b/,
  // es
  /\binteligencia artificial\b/,
  /\bgenerado (?:por|con|automaticamente)\b/,
  /\bmodelo de lenguaje\b/,
  // pt
  /\bgerado (?:por|com|automaticamente)\b/,
  /\bmodelo de linguagem\b/,
  // de
  /\bkunstliche intelligenz\b/,
  /\bkuenstliche intelligenz\b/,
  /\b(?:automatisch )?generiert (?:von|mit|durch)\b/,
  /\bsprachmodell\b/,
  // it
  /\bintelligenza artificiale\b/,
  /\bgenerato (?:da|con|automaticamente)\b/,
  /\bmodello linguistico\b/,
  // marques et mots communs aux 6 langues
  /\b(?:chat ?gpt|gpt ?\d*|openai|anthropic|copilot|llm)\b/,
  /\b(?:chat ?bot|chatbots|bots?|robots?|roboter|robo)\b/,
  // assistant(e) : fr en es pt de it
  /\b(?:assistante?s?|asistentes?|assistentes?|assistentin(?:nen)?|assistenten?|assistent)\b/,
  /\b(?:virtuel(?:le)?|virtual|virtuell(?:e|er)?|virtuale) (?:girl|fille|chica|garota|madchen|ragazza|amie|freundin|amica|amiga)\b/,
  /\b(?:fille|amie|copine|chica|novia|garota|namorada|ragazza|amica|amiga) virtu(?:el|elle|al|ale)\b/,
];

// Sigles sensibles à la casse (« IA », « AI », « KI ») : « ai » minuscule est un mot courant (« j'ai », « ai » italien).
const AI_ACRONYMS = /(?:^|[^\p{L}\p{N}])(?:I\.?A\.?|A\.?I\.?|K\.?I\.?)(?=$|[^\p{L}\p{N}])/u;

/** Vrai si le texte parle d'IA, de bot ou d'assistant (6 langues). */
export function mentionsAi(html: string): string | null {
  const visible = stripHtml(html);
  const acro = AI_ACRONYMS.exec(visible);
  if (acro) return acro[0].replace(/^[^\p{L}]+/u, "");
  const norm = normalizeWords(visible);
  for (const re of AI_WORD_PATTERNS) {
    const m = re.exec(norm);
    if (m) return m[0];
  }
  return null;
}

/** Hôtes trouvés dans le texte : liens `<a href>`, adresses en clair, domaines nus, liens t.me. */
export function linkHostsOf(html: string): string[] {
  const hosts = new Set<string>();
  const add = (raw: string) => {
    const h = raw.toLowerCase().replace(/^www\./, "").replace(/[.,;:!?)]+$/, "");
    if (h) hosts.add(h);
  };
  for (const m of html.matchAll(/href\s*=\s*["']([^"']*)["']/gi)) {
    const url = m[1]!.trim();
    const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url)?.[1];
    add(host ?? url);
  }
  const visible = stripHtml(html);
  for (const m of visible.matchAll(/\b(?:https?:\/\/|www\.)([^\s/?#:<>"']+)/gi)) add(m[1]!);
  for (const m of visible.matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|net|org|fr|io|bet|casino|app|me|ly|gg|co|eu|xyz|info|biz|tv|link|club|vip|win|online|site|live|pro|be|ch|es|pt|de|it|uk|us|ru|to|ws|cc|gl))\b(?![\p{L}])/giu))
    add(m[1]!);
  if (/\bt\.me\b|@[a-z0-9_]{5,}\b/i.test(visible)) {
    for (const m of visible.matchAll(/\bt\.me\/?/gi)) add(m[0].replace(/\/$/, ""));
    for (const m of visible.matchAll(/@([a-z0-9_]{5,})\b/gi)) add(`@${m[1]}`);
  }
  return [...hosts];
}

/** Hôtes non autorisés (tout ce qui n'est pas un de nos liens suivis). */
export function foreignLinks(html: string, allowed: readonly string[] = DEFAULT_ALLOWED_LINK_HOSTS): string[] {
  const ok = new Set(allowed.map((h) => h.toLowerCase()));
  return linkHostsOf(html).filter((h) => !ok.has(h));
}

/** Mots interdits trouvés (comparaison sans accents ni casse, mot ou expression entière). */
export function forbiddenWordsIn(html: string, words: readonly string[]): string[] {
  const norm = ` ${normalizeWords(stripHtml(html))} `;
  const found: string[] = [];
  for (const w of words) {
    const n = normalizeWords(w);
    if (n && norm.includes(` ${n} `)) found.push(w);
  }
  return found;
}

/** Applique toutes les règles ; `ok` seulement si aucun problème. */
export function checkContent(html: string, opts: ContentRulesOptions = {}): ContentCheck {
  const problems: ContentProblem[] = [];
  const max = opts.maxLength && opts.maxLength > 0 ? opts.maxLength : DEFAULT_MAX_TEXT_LENGTH;
  if (!html || stripHtml(html).trim() === "") {
    return { ok: false, problems: [{ code: "empty", message: "Le texte est vide." }] };
  }
  const v = validateTelegramHtml(html, { max: TELEGRAM_TEXT_MAX });
  if (!v.ok) problems.push({ code: "html", message: `Mise en forme refusée par Telegram : ${v.error}` });
  const len = textLength(html);
  if (len > max) problems.push({ code: "too_long", message: `Texte trop long : ${len} caractères pour ${max} au plus.` });
  const ai = mentionsAi(html);
  if (ai) problems.push({ code: "ai_mention", message: `Le texte parle d'IA ou d'assistant (« ${ai} »).` });
  const links = foreignLinks(html, opts.allowedHosts ?? DEFAULT_ALLOWED_LINK_HOSTS);
  if (links.length) problems.push({ code: "foreign_link", message: `Lien non autorisé : ${links.join(", ")} (seuls nos liens suivis sont permis).` });
  const words = forbiddenWordsIn(html, opts.forbiddenWords ?? []);
  if (words.length) problems.push({ code: "forbidden_word", message: `Mot interdit : ${words.join(", ")}.` });
  return { ok: problems.length === 0, problems };
}
