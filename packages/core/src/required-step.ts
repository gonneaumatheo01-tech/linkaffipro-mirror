import { stripHtml } from "./telegram-html";

/**
 * Message d'accueil qui annonce une étape obligatoire (phase 14, décision E5) : règle unique, utilisée par le site
 * (avertissement « Vos canaux sont proposés : la personne est acceptée de toute façon… » dans « Ce que dit le bot » et
 * dans le formulaire de la règle) et réexportée par le paquet telegram. Avec des canaux « Proposés », la personne est
 * acceptée de toute façon : un accueil qui lui dit de les rejoindre pour entrer est faux.
 */

/**
 * Tournures repérées, sur le texte ramené à l'essentiel (`plainStepText`) : le bouton « ✅ J'ai rejoint » dans les six
 * langues du bot (`joinedLabel` de packages/telegram/src/i18n.ts ; un test du paquet telegram vérifie qu'ils sont tous
 * reconnus), puis « pour être accepté », « dernière étape », « obligatoire » et leurs équivalents anglais.
 */
const REQUIRED_STEP_PATTERNS: readonly RegExp[] = [
  /j'?ai rejoint/,
  /\bi joined\b/,
  /ya me uni/,
  /ja entrei/,
  /beigetreten/,
  /mi sono unit/,
  /pour etre accepte/,
  /derniere etape/,
  /obligatoire/,
  /to be accepted/,
  /last step/,
  /\bmandatory\b/,
];

/** Texte ramené à l'essentiel : sans balises ni entités, sans accents, apostrophes droites, minuscules, espaces simples. */
function plainStepText(text: string): string {
  return stripHtml(text.replace(/<[^>]*>/g, " "))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Le texte parle-t-il d'une étape obligatoire avant d'entrer (« J'ai rejoint », « pour être accepté »…) ? */
export function mentionsRequiredStep(text: string | null | undefined): boolean {
  if (!text) return false;
  const plain = plainStepText(text);
  return REQUIRED_STEP_PATTERNS.some((p) => p.test(plain));
}

/** Une des langues d'un message (`{ fr: "…", en: "…" }`) parle-t-elle d'une étape obligatoire ? */
export function textsMentionRequiredStep(
  texts: Record<string, string> | null | undefined,
): boolean {
  return Object.values(texts ?? {}).some((t) => typeof t === "string" && mentionsRequiredStep(t));
}
