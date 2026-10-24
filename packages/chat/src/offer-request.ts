// Demande d'accès (Casino / Paris sportifs, phase 25) : la personne demande l'accès VIP, le lien ou l'inscription. Le
// lien peut alors partir sans attendre le nombre d'échanges de la persona (jamais au premier message de l'assistante,
// jamais au-delà du nombre d'envois permis : règles de `journey.ts`).
import { wordsForm } from "./text-utils";

const ACCESS_PATTERNS: readonly string[] = [
  "vip",
  // le lien / l'inscription
  "(?:le|ton|un|ce) lien",
  "inscri\\w*",
  "rejoindre",
  "code promo",
  "acces",
  // anglais
  "(?:the|a|your) link",
  "sign ?up",
  "register\\w*",
  "registration",
  "join",
  "promo code",
  "access",
  // espagnol
  "(?:el|un|tu) enlace",
  "registr\\w*",
  "unirme",
  "acceso",
  // portugais
  "(?:o|um|teu|seu) link",
  "cadastr\\w*",
  "entrar no grupo",
  "acesso",
  // allemand
  "(?:den|einen|deinen) link",
  "anmeld\\w*",
  "beitreten",
  "zugang",
  // italien
  "iscri\\w*",
  "accesso",
  "entrare nel gruppo",
];

const ACCESS_RE = new RegExp(`\\b(?:${ACCESS_PATTERNS.join("|")})\\b`);

/** Vrai si le message demande l'accès VIP, le lien ou l'inscription (6 langues). */
export function asksForOfferAccess(text: string | null | undefined): boolean {
  return ACCESS_RE.test(wordsForm(text ?? ""));
}
