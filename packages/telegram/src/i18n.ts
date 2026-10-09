import type { Vertical } from "@linkaffipro/core";

/** Textes du bot, par langue puis par clé. Le français est la langue par défaut. */
export const MESSAGES = {
  fr: {
    verticalName: { CASINO: "casino", SPORTS: "paris sportifs", DATING: "dating" },
    welcome: "Bonjour, je suis {botName}, le bot {vertical}.",
    adminLinked: "Votre compte Telegram est maintenant lié à LinkAffi Pro, {name}.",
    adminLinkInvalid: "Ce lien de connexion est invalide ou a expiré.",
  },
  en: {
    verticalName: { CASINO: "casino", SPORTS: "sports betting", DATING: "dating" },
    welcome: "Hello, I am {botName}, the {vertical} bot.",
    adminLinked: "Your Telegram account is now linked to LinkAffi Pro, {name}.",
    adminLinkInvalid: "This login link is invalid or has expired.",
  },
} as const;

export type Lang = keyof typeof MESSAGES;
export const DEFAULT_LANG: Lang = "fr";

export function pickLang(languageCode: string | undefined | null): Lang {
  const base = (languageCode ?? "").toLowerCase().split("-")[0];
  return base && base in MESSAGES ? (base as Lang) : DEFAULT_LANG;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export function t(lang: Lang, key: "welcome", vars: { botName: string; vertical: Vertical }): string;
export function t(lang: Lang, key: "adminLinked", vars: { name: string }): string;
export function t(lang: Lang, key: "adminLinkInvalid"): string;
export function t(lang: Lang, key: string, vars: Record<string, string> = {}): string {
  const dict = MESSAGES[lang] ?? MESSAGES[DEFAULT_LANG];
  if (key === "welcome") {
    const v = vars.vertical as Vertical;
    return fill(dict.welcome, { botName: vars.botName ?? "", vertical: dict.verticalName[v] ?? v });
  }
  const template = (dict as Record<string, unknown>)[key];
  return typeof template === "string" ? fill(template, vars) : key;
}
