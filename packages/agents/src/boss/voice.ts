/**
 * Phase 33 — la voix de Kevin (charte `docs/KEVIN-VOIX.md`). API FIGÉE (utilisée par tous les chantiers) :
 * - `KEVIN_VOICE` : la charte en consigne, ajoutée à tout appel d'IA qui écrit un texte envoyé par Kevin ;
 * - `pick(variants, key, chatId)` : une variante d'un texte fixe, sans répéter la précédente dans la conversation
 *   (déterministe en test : rotation par clé et conversation) ;
 * - `voiceCheck(text, opts)` : contrôle par le code (formules interdites, longueur, emojis, jargon, répétition).
 * Version de départ ; le chantier D (voix) la complète sans changer ces signatures.
 */

export const KEVIN_VOICE = [
  "Tu es Kevin, le collègue de l'équipe sur Telegram. Tu tutoies, phrases courtes, mots de tous les jours.",
  "La réponse d'abord : pas d'introduction (« Voici », « Bien sûr »), pas de formule de fin (« N'hésite pas », « J'espère que »).",
  "4 lignes en général, 8 au plus. Une idée par phrase. Pas de puces quand une phrase suffit. Un emoji au plus, seulement s'il sert.",
  "Pas de jargon : jamais « mission », « capacité », « dérogation », « orchestrateur », « payload », ni identifiant technique ; « pour de faux » plutôt que « en simulation ».",
  "Quand tu ne peux pas : ce qui bloque en une phrase, puis une chose que tu peux faire tout de suite, en question.",
  "Chiffres exacts, seulement ceux des données. Si on te demande sincèrement si tu es un bot, dis-le franchement en une phrase.",
].join("\n");

/** Dernière variante choisie par (clé, conversation) — en mémoire du processus (rotation sans répétition). */
const lastPicked = new Map<string, number>();

/** Petit hachage stable (rotation déterministe). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Une variante d'un texte fixe : jamais deux fois de suite la même pour une même clé dans une même conversation.
 * Sans conversation : première variante à la rotation déterministe.
 */
export function pick(variants: readonly string[], key: string, chatId?: bigint | string | number | null): string {
  if (variants.length === 0) return "";
  if (variants.length === 1) return variants[0]!;
  const conv = chatId === null || chatId === undefined ? "-" : String(chatId);
  const k = `${key}|${conv}`;
  const prev = lastPicked.get(k);
  let i = prev === undefined ? hash(k) % variants.length : (prev + 1) % variants.length;
  if (i === prev) i = (i + 1) % variants.length;
  lastPicked.set(k, i);
  return variants[i]!;
}

/** Remet la rotation à zéro (tests). */
export function resetVoiceRotation(): void {
  lastPicked.clear();
}

export const FORBIDDEN_PHRASES = [
  "voici",
  "bien sûr",
  "n'hésite",
  "n'hésitez",
  "je reste à ta disposition",
  "en tant qu'ia",
  "en tant qu'assistant",
  "excellente question",
  "j'espère que",
  "il est important de noter",
  "en résumé",
  "certainement",
  "absolument",
];

export const JARGON_WORDS = ["mission", "capacité", "dérogation", "orchestrateur", "payload"];

export type VoiceProblem = { code: string; detail: string };

/**
 * Contrôle de la voix (code, pur). `previous` : dernier message de Kevin dans la conversation (répétition interdite) ;
 * `allowList` : le client a demandé une liste ou un détail (puces et longueur tolérées).
 */
export function voiceCheck(text: string, opts: { previous?: string | null; allowList?: boolean; allowLong?: boolean } = {}): { ok: boolean; problems: VoiceProblem[] } {
  const problems: VoiceProblem[] = [];
  const plain = text.replace(/<[^>]+>/g, "");
  const low = plain.toLowerCase();
  for (const f of FORBIDDEN_PHRASES) {
    const re = new RegExp(`(^|[^\\p{L}])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu");
    if (re.test(low)) problems.push({ code: "formule", detail: f });
  }
  if (/(^|[^\p{L}])(vous|votre|vos)([^\p{L}]|$)/iu.test(low)) problems.push({ code: "vouvoiement", detail: "vous" });
  for (const j of JARGON_WORDS) if (new RegExp(`(^|[^\\p{L}])${j}s?([^\\p{L}]|$)`, "iu").test(low)) problems.push({ code: "jargon", detail: j });
  const lines = plain.split("\n").filter((l) => l.trim());
  if (!opts.allowLong && lines.length > 8) problems.push({ code: "longueur", detail: `${lines.length} lignes` });
  const bullets = lines.filter((l) => /^\s*([•\-*]|\d+[.)])\s/.test(l)).length;
  if (!opts.allowList && bullets > 4) problems.push({ code: "puces", detail: `${bullets} puces` });
  const emojis = plain.match(/\p{Extended_Pictographic}/gu) ?? [];
  const listMarks = lines.filter((l) => /^\s*(✅|⚠️|❌)/u.test(l)).length;
  if (emojis.length - listMarks > 1) problems.push({ code: "emojis", detail: `${emojis.length} emojis` });
  for (const sentence of plain.split(/[.!?\n]+/)) {
    const n = sentence.trim().split(/\s+/).filter(Boolean).length;
    if (n > 30) problems.push({ code: "phrase_longue", detail: `${n} mots` });
  }
  if ((text.match(/<b>/g) ?? []).length > 3) problems.push({ code: "gras", detail: "gras en série" });
  if (opts.previous && opts.previous.trim() && opts.previous.trim() === text.trim()) problems.push({ code: "repetition", detail: "même phrase que le message précédent" });
  return { ok: problems.length === 0, problems };
}
