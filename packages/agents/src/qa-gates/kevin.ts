/**
 * Phase 30, chantier B — QA Global des réponses de Kevin rédigées par l'IA (jamais les textes fixes du code, jamais un
 * message de moins de 50 caractères : accusés de réception).
 *
 * `qaKevinReply` : avant l'envoi, vérification `KEVIN_RESPONSE` avec la question et les données consultées.
 * - approuvée → envoyée ;
 * - refusée → nouvelle rédaction avec les corrections (même rédacteur), revérifiée ; 3 tentatives au plus, puis la
 *   phrase fixe « Je préfère vérifier avant de te répondre, je reviens vers toi. » (journalisée) ;
 * - QA indisponible → jamais la réponse non vérifiée : la phrase « Le contrôle qualité est en pause, je reprends dès
 *   que possible. » (une fois par heure au plus), suivie des lignes écrites par le code s'il y en a (texte fixe, sans IA).
 * `qaKevinLine` : variante pour une ligne lissée par l'IA dont le brouillon du code est le secours naturel.
 */
import { agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { QA_LIMITS, type QaDeps } from "../qa/contract";
import { contentHash } from "../qa/index";
import { QA_PAUSED_TEXT, QA_RESPONSE_HELD_TEXT } from "../boss/qa-gate-texts";
import { correctionLines, qaGate } from "./gate";

/** Repère de la dernière phrase « contrôle en pause » (une fois par heure au plus). */
export const QA_PAUSE_SAID_KEY = "qa.kevin.pauseSaidAt";
export const QA_PAUSE_EVERY_MS = 60 * 60_000;
export const KEVIN_QA_MAX_ATTEMPTS = 3;

/** Texte visible (balises HTML retirées) : sert au seuil des 50 caractères. */
export function plainLength(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim().length;
}

export type KevinReplyInput = {
  /** Tour de Kevin (`BossTurn`) ou repère stable de la réponse : les refus s'y cumulent. */
  contentId: string;
  question: string;
  /** Données consultées par le rédacteur (chiffres, lignes du code). */
  dataConsulted: unknown;
  /** Brouillon rédigé par l'IA (déjà contrôlé par le code : chiffres, voix). */
  draft: string;
  /** Nouvelle rédaction avec les corrections du QA (même rédacteur) ; null = pas de nouvelle rédaction possible. */
  regenerate?: (corrections: string[]) => Promise<string | null>;
  /** Lignes écrites par le code (sans IA), ajoutées après la phrase « contrôle en pause ». */
  codeFallback?: string | null;
  /** Équipe d'origine (journal du QA). */
  teamKey?: string;
};

export type KevinReplyResult = { text: string; status: "approved" | "short" | "held" | "paused"; attempts: number };

async function pauseNote(deps: QaDeps): Promise<string | null> {
  const now = nowOf(deps);
  const last = await readSetting(deps, QA_PAUSE_SAID_KEY).catch(() => undefined);
  const at = typeof last === "string" ? new Date(last).getTime() : 0;
  if (at && now.getTime() - at < QA_PAUSE_EVERY_MS) return null;
  await writeSetting(deps, QA_PAUSE_SAID_KEY, now.toISOString()).catch(() => undefined);
  return QA_PAUSED_TEXT;
}

/** Réponse de Kevin vérifiée par le QA Global (voir l'en-tête). Ne lève jamais. */
export async function qaKevinReply(deps: QaDeps, input: KevinReplyInput): Promise<KevinReplyResult> {
  if (plainLength(input.draft) < QA_LIMITS.kevinMinChars) return { text: input.draft, status: "short", attempts: 0 };
  let text = input.draft;
  for (let attempt = 1; attempt <= KEVIN_QA_MAX_ATTEMPTS; attempt++) {
    const gate = await qaGate(deps, {
      contentType: "KEVIN_RESPONSE",
      contentId: input.contentId,
      teamKey: input.teamKey ?? "boss",
      content: { question: input.question.slice(0, 2000), response: text, dataConsulted: input.dataConsulted ?? null },
    });
    if (gate.kind === "approved") return { text, status: "approved", attempts: attempt };
    if (gate.kind === "unavailable") {
      const note = await pauseNote(deps);
      const fallback = input.codeFallback?.trim() || null;
      const out = [note, fallback].filter((x): x is string => !!x).join("\n");
      await agentEvent(deps, "qa.kevin.paused", { contentId: input.contentId, withCodeLines: !!fallback });
      return { text: out || QA_RESPONSE_HELD_TEXT, status: "paused", attempts: attempt };
    }
    if (attempt >= KEVIN_QA_MAX_ATTEMPTS || gate.needsHuman || !input.regenerate) break;
    let next: string | null = null;
    try {
      next = await input.regenerate(correctionLines(gate.result));
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message }, "[qa] nouvelle rédaction de Kevin impossible");
    }
    if (!next || !next.trim()) break;
    // Nouvelle rédaction trop courte pour le QA : elle reste vérifiée (jamais un contournement par la longueur).
    text = next;
  }
  await agentEvent(deps, "qa.kevin.held", { contentId: input.contentId, hash: contentHash(text).slice(0, 12) });
  return { text: QA_RESPONSE_HELD_TEXT, status: "held", attempts: KEVIN_QA_MAX_ATTEMPTS };
}

/**
 * Ligne écrite par le code puis lissée par l'IA (`smoothLine`, réponses aux questions sur un ordre) : le brouillon du
 * code est un texte fixe ; il est gardé si le QA refuse ou ne répond pas (jamais la version de l'IA non vérifiée).
 */
export async function qaKevinLine(deps: QaDeps, input: { contentId: string; question: string; dataConsulted: unknown; aiText: string; codeText: string; teamKey?: string }): Promise<string> {
  if (input.aiText === input.codeText || plainLength(input.aiText) < QA_LIMITS.kevinMinChars) return input.aiText;
  const gate = await qaGate(deps, {
    contentType: "KEVIN_RESPONSE",
    contentId: input.contentId,
    teamKey: input.teamKey ?? "boss",
    content: { question: input.question.slice(0, 2000), response: input.aiText, dataConsulted: input.dataConsulted ?? null },
  });
  return gate.kind === "approved" ? input.aiText : input.codeText;
}

/** Repère stable d'une réponse sans tour enregistré (même question, même brouillon du code). */
export function kevinReplyId(prefix: string, seed: unknown): string {
  return `${prefix}:${contentHash(seed).slice(0, 24)}`;
}
