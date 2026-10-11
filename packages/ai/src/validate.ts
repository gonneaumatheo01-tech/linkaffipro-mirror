import {
  CUSTOM_EMOJI_TAG_RE,
  decodeEntities,
  escapeHtml,
  stripHtml,
  textLength,
  validateTelegramHtml,
} from "@linkaffipro/core";
import { PLACEHOLDER_RE, PLACEHOLDERS_BY_SURFACE } from "./prompt";
import type { AiContext, AiLanguage, AiRiskNotice, AiVersion } from "./types";

export type ValidationOutcome = { ok: true; version: AiVersion } | { ok: false; reason: string };

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** Repères `{prenom}`… présents dans un texte (dédoublonnés). */
export function placeholdersOf(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER_RE) ?? [])];
}

/**
 * Emojis animés d'un texte (balises `<tg-emoji emoji-id="…">😀</tg-emoji>`), dans l'ordre et avec les répétitions :
 * « identifiant:emoji de remplacement » (emoji décodé et sans espaces autour).
 */
export function customEmojiTagsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(CUSTOM_EMOJI_TAG_RE.source, "gi")))
    out.push(`${m[1] ?? m[2]}:${decodeEntities(m[3] ?? "").trim()}`);
  return out;
}

/** Emoji de remplacement d'une clé « identifiant:emoji », pour les messages. */
const fallbackOfKey = (key: string) => key.slice(key.indexOf(":") + 1) || "emoji";

/**
 * Emojis animés du texte d'origine conservés tels quels (D7, phase 12) : mêmes identifiants, même emoji de
 * remplacement, même nombre, n'importe où dans le texte. Renvoie la raison du refus, ou null si tout est là.
 * Le modèle ne connaît aucun autre identifiant : tout emoji animé ajouté est refusé.
 */
export function customEmojiProblem(source: string, text: string): string | null {
  const count = (list: string[]) =>
    list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const want = count(customEmojiTagsOf(source));
  const got = count(customEmojiTagsOf(text));
  const missing = [...want]
    .filter(([k, n]) => (got.get(k) ?? 0) < n)
    .map(([k]) => fallbackOfKey(k));
  if (missing.length) return `Emoji(s) animé(s) perdu(s) ou modifié(s) : ${missing.join(" ")}.`;
  const extra = [...got].filter(([k, n]) => (want.get(k) ?? 0) < n).map(([k]) => fallbackOfKey(k));
  if (extra.length) return `Emoji(s) animé(s) ajouté(s) ou modifié(s) : ${extra.join(" ")}.`;
  return null;
}

/** Liens (URL nues et href) présents dans un texte (dédoublonnés, sans ponctuation finale). */
export function linksOf(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[),.;!?]+$/, "")))];
}

function normalize(s: string): string {
  return stripHtml(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

/** Vrai si la mention des risques (ou son équivalent) est déjà dans le texte. */
export function hasRiskNotice(text: string, notice: string): boolean {
  return normalize(text).includes(normalize(notice));
}

export function hasAdultMention(text: string): boolean {
  return /18\s*\+|\+\s*18\b/.test(stripHtml(text));
}

/**
 * Ajoute la mention des risques et « 18+ » si elles manquent (casino, paris sportifs).
 * Hors français, la mention traduite n'est pas vérifiable mot à mot : seul « 18+ » est exigé, sinon la mention française est ajoutée.
 */
export function ensureRiskNotice(
  text: string,
  vertical: AiContext["vertical"],
  notice: AiRiskNotice,
  language: AiLanguage | null | undefined,
): string {
  if (vertical !== "CASINO" && vertical !== "SPORTS") return text;
  const wanted = vertical === "CASINO" ? notice.casino : notice.sports;
  const lang = language ?? "fr";
  const noticeOk =
    lang === "fr"
      ? hasRiskNotice(text, wanted)
      : hasRiskNotice(text, wanted) || hasAdultMention(text);
  const adultOk = hasAdultMention(text);
  if (noticeOk && adultOk) return text;
  const parts: string[] = [];
  if (!noticeOk) parts.push(escapeHtml(wanted));
  if (!adultOk) parts.push("18+");
  return `${text.trimEnd()}\n\n<i>${parts.join(" ")}</i>`;
}

/**
 * Valide une version : HTML Telegram (repli : texte sans balises), emojis animés du texte d'origine conservés tels
 * quels, repères et liens du brouillon conservés, mention des risques ajoutée si absente, longueur maximale respectée.
 */
export function validateVersion(
  version: AiVersion,
  input: {
    source: string;
    context: AiContext;
    notice: AiRiskNotice;
    max: number;
    checkSource: boolean;
  },
): ValidationOutcome {
  let text = version.text.replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, reason: "Texte vide." };
  let html = validateTelegramHtml(text, { max: Number.MAX_SAFE_INTEGER });
  if (!html.ok) {
    // Repli : on garde le texte sans balises plutôt que de perdre la version.
    text = escapeHtml(stripHtml(text));
    html = validateTelegramHtml(text, { max: Number.MAX_SAFE_INTEGER });
    if (!html.ok) return { ok: false, reason: `HTML refusé : ${html.error}` };
  }
  text = html.html;
  // Emojis animés : toujours vérifiés (même pour une idée), jamais remplacés en silence par leur emoji de remplacement.
  const emojiIssue = customEmojiProblem(input.source, text);
  if (emojiIssue) return { ok: false, reason: emojiIssue };
  if (input.checkSource) {
    const missingPh = placeholdersOf(input.source).filter((p) => !text.includes(p));
    if (missingPh.length)
      return { ok: false, reason: `Repère(s) perdu(s) : ${missingPh.join(", ")}.` };
    const missingLinks = linksOf(input.source).filter((l) => !text.includes(l));
    if (missingLinks.length)
      return { ok: false, reason: `Lien(s) perdu(s) : ${missingLinks.join(", ")}.` };
  }
  // Pas de repère inventé, ni de repère qui ne serait pas remplacé à cet endroit (message de canal : aucun).
  const surface = input.context.surface;
  const allowed = surface ? new Set(PLACEHOLDERS_BY_SURFACE[surface] ?? []) : KNOWN_PLACEHOLDERS;
  const extraPh = placeholdersOf(text).filter((p) => !input.source.includes(p) && !allowed.has(p));
  if (extraPh.length)
    return {
      ok: false,
      reason: `Repère(s) inconnu(s) ou non remplacé(s) ici : ${extraPh.join(", ")}.`,
    };
  text = ensureRiskNotice(
    text,
    input.context.vertical,
    input.notice,
    version.lang ?? input.context.language,
  );
  const len = textLength(text);
  if (len > input.max)
    return { ok: false, reason: `Trop long : ${len} caractères (maximum ${input.max}).` };
  return { ok: true, version: { ...version, text } };
}

/** Repères utilisés par les textes du bot et les modèles (fillPlaceholders de @linkaffipro/core). */
const KNOWN_PLACEHOLDERS = new Set([
  "{prenom}",
  "{canal}",
  "{offre}",
  "{bot}",
  "{delai}",
  "{liste_canaux}",
  "{lien}",
  "{nom}",
]);
