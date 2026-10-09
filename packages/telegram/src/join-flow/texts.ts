/**
 * Textes par défaut des séquences du flux d'adhésion (fr / en) et rendu des placeholders.
 * Placeholders : {prenom} {canal} {liste_canaux} {delai} {bot}.
 */
export type Lang = "fr" | "en";

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

export function baseLang(code: string | null | undefined): Lang {
  return (code ?? "").toLowerCase().startsWith("en") ? "en" : "fr";
}

export const DEFAULT_TEXTS = {
  joinRequestGate: {
    fr: "Salut {prenom} ! Pour rejoindre <b>{canal}</b>, rejoins d'abord nos canaux partenaires ci-dessous, puis appuie sur ✅ J'ai rejoint. Ton accès est validé {delai}.",
    en: "Hi {prenom}! To join <b>{canal}</b>, first join our partner channels below, then tap ✅ I joined. Your access is confirmed {delai}.",
  },
  joinRequestSoft: {
    fr: "Salut {prenom} ! Ta demande pour <b>{canal}</b> est bien reçue : elle sera validée {delai}. En attendant, découvre aussi nos autres canaux ci-dessous.",
    en: "Hi {prenom}! Your request for <b>{canal}</b> is received and will be confirmed {delai}. Meanwhile, check out our other channels below.",
  },
  joinRequestPlain: {
    fr: "Salut {prenom} ! Ta demande pour <b>{canal}</b> est bien reçue : elle sera validée {delai}.",
    en: "Hi {prenom}! Your request for <b>{canal}</b> is received and will be confirmed {delai}.",
  },
  gateSatisfied: {
    fr: "C'est bon {prenom}, tu seras accepté dans <b>{canal}</b> {delai}.",
    en: "All good {prenom}, you'll be accepted into <b>{canal}</b> {delai}.",
  },
  gateMissing: {
    fr: "Il te manque encore : {liste_canaux}. Rejoins-les puis appuie à nouveau sur ✅ J'ai rejoint.",
    en: "Still missing: {liste_canaux}. Join them, then tap ✅ I joined again.",
  },
  gateReminder: {
    fr: "{prenom}, ta demande pour <b>{canal}</b> attend encore : rejoins {liste_canaux} puis appuie sur ✅ J'ai rejoint.",
    en: "{prenom}, your request for <b>{canal}</b> is still pending: join {liste_canaux} then tap ✅ I joined.",
  },
  approved: {
    fr: "Bienvenue dans <b>{canal}</b>, {prenom} ! Tu es accepté.",
    en: "Welcome to <b>{canal}</b>, {prenom}! You're in.",
  },
  unknownCode: {
    fr: "Je ne retrouve pas ta demande. Refais une demande d'adhésion au canal, puis réessaie.",
    en: "I can't find your request. Please request to join the channel again, then retry.",
  },
  joinedLabel: { fr: "✅ J'ai rejoint", en: "✅ I joined" },
  joinLabel: { fr: "Rejoindre", en: "Join" },
} as const;

export type DefaultTextKey = keyof typeof DEFAULT_TEXTS;

export function defaultText(key: DefaultTextKey, lang: Lang): string {
  return DEFAULT_TEXTS[key][lang];
}
