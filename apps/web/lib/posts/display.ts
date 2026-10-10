/**
 * Affichage des messages (fonctions pures, testées dans display.test.ts ; serveur et navigateur) : extrait lisible
 * du texte, ligne sous le titre de la fiche, message parti ou non, langues proposées dans le formulaire.
 */
import { stripHtml } from "@linkaffipro/core";
import { AI_LABELS, AI_LANGUAGES, type AiLanguage } from "@linkaffipro/ai/types";
import { momentLabel } from "./calendar";

/**
 * Début du texte sans mise en forme, sur une ligne : chaque retour à la ligne devient « · » (sinon le titre en gras
 * et le corps se collent : « Rappel Votre bonus… »), espaces compactés.
 */
export function postExcerpt(html: string, max?: number): string {
  const flat = stripHtml(html)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
  return max === undefined ? flat : flat.slice(0, max);
}

/** Message parti (ou en train de partir) : ses chiffres ont un sens. */
export function isSentLike(post: { status: string; sentAt: Date | null }): boolean {
  return post.sentAt !== null || ["SENT", "SENDING", "DELETED"].includes(post.status);
}

/**
 * Ligne sous le titre de la fiche : quand, et par quel bot (« sera publié » tant que le message n'est pas parti).
 * Un modèle n'en a pas : il ne se publie jamais tel quel.
 */
export function postHeaderLine(p: {
  isTemplate: boolean;
  status: string;
  /** Heures de Paris « AAAA-MM-JJTHH:MM ». */
  sentLocal: string | null;
  scheduledLocal: string | null;
  bot: string;
}): string | undefined {
  if (p.isTemplate) return undefined;
  const bot = `@${p.bot}`;
  if (p.sentLocal) return `Envoyé le ${momentLabel(p.sentLocal)} · publié par ${bot}`;
  const at = p.scheduledLocal ? momentLabel(p.scheduledLocal) : null;
  switch (p.status) {
    case "SCHEDULED":
      return `${at ? `Part le ${at}` : "Sans date"} · sera publié par ${bot}`;
    case "CANCELLED":
      return at ? `Était prévu le ${at} · envoi annulé` : "Envoi annulé";
    case "FAILED":
      return `${at ? `Prévu le ${at}` : "Sans date"} · envoi par ${bot}`;
    case "SENT":
    case "SENDING":
    case "DELETED":
      return `${at ? `Prévu le ${at}` : "Sans date"} · publié par ${bot}`;
    default:
      return `${at ? `Prévu le ${at}` : "Sans date"} · sera publié par ${bot}`;
  }
}

/** Les 6 langues des textes du bot (packages/telegram/src/i18n.ts), en clair. */
const BOT_LANGUAGES: readonly AiLanguage[] = ["fr", "en", "es", "pt", "de", "it"];
export const POST_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = BOT_LANGUAGES.map(
  (l) => ({ value: l, label: AI_LABELS.language[l] }),
);

/**
 * Choix de la langue du message (liste déroulante, même code envoyé dans `language`) : les 6 langues du bot, plus la
 * langue déjà enregistrée si elle n'en fait pas partie (elle reste choisie, rien n'est perdu à l'enregistrement).
 */
export function postLanguageOptions(current: string): Array<{ value: string; label: string }> {
  const code = current.trim();
  if (!code || POST_LANGUAGES.some((l) => l.value === code)) return [...POST_LANGUAGES];
  const known = (AI_LANGUAGES as readonly string[]).includes(code)
    ? AI_LABELS.language[code as AiLanguage]
    : code.toUpperCase();
  return [...POST_LANGUAGES, { value: code, label: known }];
}
