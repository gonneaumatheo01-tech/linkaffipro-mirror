/** Règles d'affichage du panneau « Améliorer avec l'IA » (fonctions pures, testées). */
import { TELEGRAM_CAPTION_MAX, TELEGRAM_TEXT_MAX } from "@linkaffipro/core";
import { AI_LANGUAGES, type AiLanguage, type AiVertical } from "@linkaffipro/ai/types";

const VERTICALS: readonly AiVertical[] = ["CASINO", "SPORTS", "DATING"];
const fmt = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");

/** Langue de l'assistant (une des langues des textes du bot), français par défaut. */
export function toAiLanguage(v: string | null | undefined): AiLanguage {
  return (AI_LANGUAGES as readonly string[]).includes(v ?? "") ? (v as AiLanguage) : "fr";
}

export function toAiVertical(v: string | null | undefined): AiVertical | null {
  return (VERTICALS as readonly string[]).includes(v ?? "") ? (v as AiVertical) : null;
}

/**
 * « Catégorie : Bonus · Média joint : oui · Limite : 1 024 caractères ».
 * `categoryName` absent (undefined) : l'écran n'a pas de catégorie (envoi groupé, texte du bot), on n'en parle pas.
 */
export function contextLine(ctx: { categoryName?: string | null; hasMedia: boolean }): string {
  const max = ctx.hasMedia ? TELEGRAM_CAPTION_MAX : TELEGRAM_TEXT_MAX;
  const parts = [
    `Média joint : ${ctx.hasMedia ? "oui" : "non"}`,
    `Limite : ${fmt(max)} caractères`,
  ];
  if (ctx.categoryName !== undefined)
    parts.unshift(`Catégorie : ${ctx.categoryName?.trim() || "aucune"}`);
  return parts.join(" · ");
}

/**
 * Action proposée sur une traduction : « use » (même langue que le champ : remplace le texte), « save » (l'hôte gère
 * plusieurs langues : enregistre dans cette langue), « copy » (sinon : copie, sans jamais écraser le texte du champ).
 */
export function translationAction(
  versionLang: AiLanguage,
  fieldLang: AiLanguage,
  hostHandlesLanguages: boolean,
): "use" | "save" | "copy" {
  if (versionLang === fieldLang) return "use";
  return hostHandlesLanguages ? "save" : "copy";
}
