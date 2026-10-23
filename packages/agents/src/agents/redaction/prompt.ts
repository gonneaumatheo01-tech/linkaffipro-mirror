/**
 * Prompt de l'agent Rédaction : univers, canal, persona ou ton, exemples de style, consignes de l'équipe, 30 derniers
 * posts du canal (pour ne pas se répéter), règles de forme. Sortie JSON stricte `{ text, hook, topic }`, validée par
 * le code (`parseRedaction`). Le prompt système n'est pas modifiable par l'équipe : seules ses consignes s'ajoutent.
 */
import { stripHtml, validateTelegramHtml, textLength } from "@linkaffipro/core";
import { stripSimulationHeader } from "../../rules/similarity";

const UNIVERSE: Record<string, string> = {
  DATING: "rencontres (dating) : séduction, complicité, envie de discuter, jamais vulgaire ni explicite",
  CASINO: "casino en ligne : frisson du jeu, bonus, ambiance, jamais de promesse de gain",
  SPORTS: "paris sportifs : matchs, cotes, analyse, jamais de gain garanti",
};

const LANGUAGE: Record<string, string> = {
  fr: "français",
  en: "anglais",
  es: "espagnol",
  pt: "portugais",
  de: "allemand",
  it: "italien",
};

export type RedactionPromptInput = {
  vertical: string | null;
  channelTitle: string;
  language: string;
  format: "video" | "photo" | "text";
  maxLength: number;
  persona?: { name: string; tone: string; personality: string; styleExamples: string | null } | null;
  styleGuidelines?: string;
  themes?: readonly string[];
  /** Thème imposé pour ce post (choisi dans le plan du canal). */
  theme?: string | null;
  recentPosts: readonly string[];
  /** Motif du Contrôle qualité quand le texte est à refaire. */
  redoReason?: string | null;
};

export const REDACTION_SYSTEM = [
  "Tu écris des posts pour un canal Telegram. Tu es un rédacteur humain de l'équipe du canal.",
  "Règles de forme, toujours :",
  "- très court, style Telegram, phrases courtes, ton direct et « rentre dedans » ;",
  "- humain et précis, jamais générique ni publicitaire creux ; 0 à 3 emojis, sobres ;",
  "- jamais de mention d'intelligence artificielle, de robot, de bot, d'assistant ni de texte généré ;",
  "- aucun lien, aucune adresse de site, aucun @nom de compte : le bouton de l'offre est ajouté à part ;",
  "- aucune promesse de gain ni chiffre inventé ;",
  "- HTML Telegram seulement si utile : <b>, <i>, <u>, <s>, <tg-spoiler> ; retours à la ligne simples ;",
  "- ne répète ni l'accroche ni le sujet des derniers posts du canal.",
  "Réponds UNIQUEMENT par un objet JSON : {\"text\": \"…\", \"hook\": \"…\", \"topic\": \"…\"}",
  "« text » : le post complet (HTML Telegram) ; « hook » : sa première phrase ; « topic » : son sujet en 1 à 3 mots.",
].join("\n");

export function buildRedactionUser(i: RedactionPromptInput): string {
  const lines: string[] = ["Tâche : redaction"];
  lines.push(`Univers : ${UNIVERSE[i.vertical ?? ""] ?? "général"}`);
  lines.push(`Canal : ${i.channelTitle}`);
  lines.push(`Langue du post : ${LANGUAGE[i.language] ?? i.language}`);
  lines.push(
    `Format : ${i.format === "text" ? "post texte seul" : i.format === "video" ? "légende d'une vidéo" : "légende d'une photo"}`,
  );
  lines.push(`Longueur : ${i.maxLength} caractères visibles au plus (vise beaucoup moins).`);
  if (i.persona) {
    lines.push(`Voix : ${i.persona.name}${i.persona.tone ? `, ton ${i.persona.tone}` : ""}${i.persona.personality ? `, ${i.persona.personality}` : ""}`);
    if (i.persona.styleExamples) lines.push(`Exemples de style (à imiter, jamais à recopier) :\n${i.persona.styleExamples.slice(0, 1500)}`);
  }
  if (i.styleGuidelines?.trim()) lines.push(`Consignes de l'équipe :\n${i.styleGuidelines.trim().slice(0, 2000)}`);
  if (i.theme) lines.push(`Thème de ce post : ${i.theme}`);
  else if (i.themes?.length) lines.push(`Thèmes possibles : ${i.themes.join(", ")}`);
  if (i.recentPosts.length) {
    lines.push("Derniers posts du canal (ne pas répéter) :");
    for (const p of i.recentPosts.slice(0, 30)) lines.push(`- ${stripSimulationHeader(stripHtml(p)).replace(/\s+/g, " ").slice(0, 160)}`);
  }
  if (i.redoReason) lines.push(`Le texte précédent a été refusé : ${i.redoReason}. Écris un texte nettement différent.`);
  return lines.join("\n");
}

export type RedactionOutput = { text: string; hook: string; topic: string };

function extractObject(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("Réponse de l'IA sans objet JSON.");
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    throw new Error("Réponse de l'IA : JSON invalide.");
  }
}

/** Sortie stricte : trois chaînes, texte non vide, HTML Telegram valide, longueur respectée. */
export function parseRedaction(raw: string, maxLength: number): RedactionOutput {
  const data = extractObject(raw) as Record<string, unknown>;
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const hook = typeof data.hook === "string" ? data.hook.trim() : "";
  const topic = typeof data.topic === "string" ? data.topic.trim() : "";
  if (!text) throw new Error("Réponse de l'IA : texte vide.");
  const v = validateTelegramHtml(text, { max: 4096 });
  if (!v.ok) throw new Error(`Réponse de l'IA : ${v.error}`);
  const len = textLength(v.html);
  if (len > maxLength) throw new Error(`Réponse de l'IA trop longue (${len} caractères pour ${maxLength}).`);
  return { text: v.html, hook: hook.slice(0, 200), topic: topic.slice(0, 60) || "général" };
}
