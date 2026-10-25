/**
 * Phase 34, chantier A — messages du site traduits en phrases de collègue (règle 8 : jamais recopiés tels quels s'ils
 * ne passent pas la voix de Kevin). Ordre : le texte du site s'il passe déjà `voiceCheck` ; sinon des règles
 * (vouvoiement → tutoiement, « Choisissez » → « choisis », champ manquant → question) ; sinon UNE réécriture par le
 * rédacteur du Boss (Haiku, `rewriteForVoice` : mêmes chiffres, mêmes noms) ; sinon une phrase fixe selon le code
 * d'erreur. Ne lève jamais.
 */
import { esc } from "../admin/journal";
import type { BossLlm } from "../boss/contract";
import { pick, rewriteForVoice, voiceCheck, voiceTemplate, type VoiceTable } from "../boss/voice";
import type { SiteOpMeta, SiteOpResult } from "./contract";

export const SITE_ERRORS_VARIANTS = {
  invalid: [
    "Le site n'accepte pas ça tel quel. Tu me redis ce que tu veux, avec la valeur exacte ?",
    "Il manque quelque chose ou une valeur ne va pas. Tu me précises ?",
  ],
  forbidden: ["Ça, ton rôle ne le permet pas sur le site.", "Pas possible avec ton rôle, c'est réservé à l'admin."],
  notFound: ["Je ne trouve pas ce que tu vises. Tu me redis le nom exact ?", "Introuvable de mon côté. Tu me donnes le nom exact ?"],
  conflict: ["Ça existe déjà comme ça. Tu veux un autre nom ?", "Il y a déjà la même chose. On change le nom ?"],
  unavailable: ["Le site ne répond pas pour l'instant. Tu réessaies dans une minute ?", "Le site est injoignable là. On réessaie dans une minute ?"],
  done: ["C'est fait ✅", "Fait ✅", "C'est réglé ✅"],
  missing: voiceTemplate<{ what: string }>([{ what: "le pays" }, { what: "le nom" }], (p) => [
    `Il me manque ${p.what}. Tu me le donnes ?`,
    `Il me faut encore ${p.what}, c'est quoi ?`,
  ]),
} satisfies VoiceTable;

const V = SITE_ERRORS_VARIANTS;

type Failure = Extract<SiteOpResult, { ok: false }>;

/** Remplacements mot à mot : vouvoiement → tutoiement, impératifs du site → impératifs de collègue. */
const RULES: Array<[RegExp, string]> = [
  [/\bVeuillez\s+/g, ""],
  [/\bveuillez\s+/g, ""],
  [/\bMerci de\s+/g, ""],
  [/\bChoisissez\b/g, "Choisis"],
  [/\bchoisissez\b/g, "choisis"],
  [/\bIndiquez\b/g, "Dis-moi"],
  [/\bindiquez\b/g, "dis-moi"],
  [/\b(Saisissez|Entrez|Renseignez|Donnez)\b/g, "Donne-moi"],
  [/\b(saisissez|entrez|renseignez|donnez)\b/g, "donne-moi"],
  [/\bVérifiez\b/g, "Vérifie"],
  [/\bvérifiez\b/g, "vérifie"],
  [/\bRéessayez\b/g, "Réessaie"],
  [/\bréessayez\b/g, "réessaie"],
  [/\bAjoutez\b/g, "Ajoute"],
  [/\bajoutez\b/g, "ajoute"],
  [/\bVous devez\b/g, "Il faut"],
  [/\bvous devez\b/g, "il faut"],
  [/\bVous pouvez\b/g, "Tu peux"],
  [/\bvous pouvez\b/g, "tu peux"],
  [/\bVous avez\b/g, "Tu as"],
  [/\bvous avez\b/g, "tu as"],
  [/\bVous êtes\b/g, "Tu es"],
  [/\bvous êtes\b/g, "tu es"],
  [/\bVotre\b/g, "Ton"],
  [/\bvotre\b/g, "ton"],
  [/\bVos\b/g, "Tes"],
  [/\bvos\b/g, "tes"],
  [/\bVous\b/g, "Tu"],
  [/\bvous\b/g, "toi"],
];

/** Champ manquant (« Le champ pays est obligatoire », « Nom requis », « Pays manquant ») → ce qui manque, ou null. */
export function missingFieldOf(text: string): string | null {
  const t = text.trim().replace(/[.!]+$/, "");
  const patterns = [
    /^le champ\s+«?\s*(.+?)\s*»?\s+est (?:obligatoire|requis|vide)$/i,
    /^(?:il manque|manque)\s+(.+)$/i,
    /^(.+?)\s+(?:est |sont )?(?:obligatoires?|requis(?:e|es)?|manquante?s?)$/i,
    /^(?:merci de |veuillez )?(?:indiquer|choisir|saisir|renseigner|donner)\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m && m[1] && m[1].split(/\s+/).length <= 6) return m[1].trim();
  }
  return null;
}

/** Ce qui manque, avec son article (« pays » → « le pays », « la date » gardé). */
function withArticle(what: string): string {
  const w = what.trim();
  if (/^(le|la|les|l'|un|une|des|du|ton|ta|tes)\b/i.test(w) || /^l'/i.test(w)) return w.charAt(0).toLowerCase() + w.slice(1);
  const low = w.charAt(0).toLowerCase() + w.slice(1);
  if (/^[aeiouyéèêh]/i.test(low)) return `l'${low}`;
  return /(e|ion|té)$/.test(low.split(" ")[0]!) ? `la ${low}` : `le ${low}`;
}

const NOT_VERBS = new Set(["assez", "chez", "nez", "rez"]);

/** Impératifs au vouvoiement en début de phrase (« Choisissez-en », « Modifiez ») → tutoiement (pur, approché). */
function imperativesToTu(text: string): string {
  return text.replace(/(^|[.!?:;]\s+|,\s+|\n)(\p{L}{2,})ez(?=[\s\-.,!?:;]|$)/gu, (all, lead: string, stem: string) => {
    const word = `${stem}ez`;
    if (NOT_VERBS.has(word.toLowerCase())) return all;
    // -issez (verbes en -ir : choisissez, remplissez) → -is ; sinon -ez → -e (indiquez → indique).
    const tu = /iss$/i.test(stem) ? stem.slice(0, -1) : `${stem}e`;
    return `${lead}${tu}`;
  });
}

/** Règles seules (pur, sans IA) : champ manquant → question ; sinon tutoiement ; le texte s'il passe la voix, sinon null. */
export function colleagueRules(text: string, opts: { chatId?: bigint | string | null } = {}): string | null {
  const plain = text.trim();
  if (!plain) return null;
  const field = missingFieldOf(plain);
  if (field) {
    const q = pick(V.missing({ what: esc(withArticle(field)) }), "site.errors.missing", opts.chatId ?? null);
    if (voiceCheck(q).ok) return q;
  }
  let out = plain;
  for (const [re, by] of RULES) out = out.replace(re, by);
  out = imperativesToTu(out);
  out = out.replace(/^\s*(\p{Ll})/u, (m) => m.toUpperCase());
  return voiceCheck(out).ok ? out : null;
}

function fallbackFor(code: Failure["code"] | undefined, chatId?: bigint | string | null): string {
  const key = code === "forbidden" ? "forbidden" : code === "not_found" ? "notFound" : code === "conflict" ? "conflict" : code === "unavailable" ? "unavailable" : "invalid";
  return pick(V[key], `site.errors.${key}`, chatId ?? null);
}

export type ColleagueOptions = { llm?: Pick<BossLlm, "write"> | null; chatId?: bigint | string | null };

/**
 * Erreur d'une opération du site → phrase de collègue (tutoiement, voix de Kevin). `unavailable` : toujours la phrase
 * fixe (le détail technique reste au journal, jamais montré). Le résultat passe toujours `voiceCheck`.
 */
export async function colleagueError(error: Failure | string, meta?: Pick<SiteOpMeta, "key" | "description"> | null, opts: ColleagueOptions = {}): Promise<string> {
  const failure: Failure = typeof error === "string" ? { ok: false, error } : error;
  if (failure.code === "unavailable" || !failure.error?.trim()) return fallbackFor(failure.code, opts.chatId);
  const text = esc(failure.error.trim().slice(0, 600));
  const ruled = colleagueRules(text, opts);
  if (ruled) return ruled;
  const problems = voiceCheck(text).problems;
  const rewritten = await rewriteForVoice(opts.llm, text, problems).catch(() => ({ text: null }));
  if (rewritten.text && voiceCheck(rewritten.text).ok) return rewritten.text;
  void meta;
  return fallbackFor(failure.code, opts.chatId);
}

/** Message de réussite du site → phrase de collègue (même ordre que les erreurs ; secours « C'est fait ✅ »). */
export async function colleagueMessage(message: string | null | undefined, opts: ColleagueOptions = {}): Promise<string> {
  const text = esc((message ?? "").trim().slice(0, 1200));
  if (!text) return pick(V.done, "site.errors.done", opts.chatId ?? null);
  const ruled = colleagueRules(text, opts);
  if (ruled) return ruled;
  const rewritten = await rewriteForVoice(opts.llm, text, voiceCheck(text).problems).catch(() => ({ text: null }));
  if (rewritten.text && voiceCheck(rewritten.text).ok) return rewritten.text;
  return pick(V.done, "site.errors.done", opts.chatId ?? null);
}
