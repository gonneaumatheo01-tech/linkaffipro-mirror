/**
 * Textes par défaut des séquences du flux d'adhésion (six langues, voir i18n.ts) et rendu des placeholders.
 * Placeholders : {prenom} {canal} {liste_canaux} {delai} {bot}.
 */
import { LANGS, MESSAGES, pickLang, t, type Lang, type MessageKey } from "../i18n";

export type { Lang };

export type TextVars = { prenom?: string; canal?: string; liste_canaux?: string; delai?: string; bot?: string };

export function renderText(template: string, vars: TextVars): string {
  return template.replace(/\{(prenom|canal|liste_canaux|delai|bot)\}/g, (_m, k: keyof TextVars) => vars[k] ?? "");
}

/** Choisit la langue : celle du membre si disponible, sinon celle du canal, sinon fr. */
export function pickText(texts: Record<string, string> | null | undefined, memberLang: string | null | undefined, channelLang: string | null | undefined): string | null {
  if (!texts) return null;
  const candidates = [memberLang, channelLang, "fr"].map((l) => (l ?? "").toLowerCase().split("-")[0] ?? "").filter(Boolean);
  for (const l of candidates) {
    const t = texts[l];
    if (typeof t === "string" && t.trim()) return t;
  }
  const first = Object.values(texts).find((t) => typeof t === "string" && t.trim());
  return first ?? null;
}

/** Langue de base d'un code Telegram parmi les six langues du bot (fr par défaut). */
export function baseLang(code: string | null | undefined): Lang {
  return pickLang(code);
}

const DEFAULT_TEXT_KEYS = [
  "joinRequestGate",
  "joinRequestSoft",
  "joinRequestPlain",
  "gateSatisfied",
  "gateMissing",
  "gateReminder",
  "approved",
  "unknownCode",
  "joinedLabel",
  "joinLabel",
] as const satisfies readonly MessageKey[];

export type DefaultTextKey = (typeof DEFAULT_TEXT_KEYS)[number];

/** Textes par défaut du flux d'adhésion, par clé puis par langue (dérivés de i18n.ts). */
export const DEFAULT_TEXTS: Record<DefaultTextKey, Record<Lang, string>> = Object.fromEntries(
  DEFAULT_TEXT_KEYS.map((k) => [k, Object.fromEntries(LANGS.map((l) => [l, MESSAGES[l][k]]))]),
) as Record<DefaultTextKey, Record<Lang, string>>;

export function defaultText(key: DefaultTextKey, lang: Lang): string {
  return t(lang, key);
}
