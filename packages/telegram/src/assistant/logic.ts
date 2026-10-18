// Assistant de conversation (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 4) : règles pures de la réception par
// le bot assistant — source du /start, commande, nature du message reçu, langue des textes fixes, journal sans texte.
import {
  chatLangOf,
  type ChatLang,
  type ChatMediaKind,
  type ConversationStage,
  type ConversationStatus,
} from "@linkaffipro/chat";
import type { Message, Update } from "grammy/types";

/** Source d'un `/start` : alphabet des liens profonds Telegram, 64 caractères au plus. */
const START_SOURCE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Source d'un `/start <payload>` (lien profond `t.me/<bot>?start=tk01`) : gardée telle quelle si elle respecte
 * `[A-Za-z0-9_-]{1,64}`, sinon null (texte tapé à la main, trop long, caractères interdits). Le jeton de liaison d'un
 * compte de l'équipe (`admin_…`) n'est jamais une source.
 */
export function cleanStartSource(payload: string | null | undefined): string | null {
  const p = (payload ?? "").trim();
  if (!START_SOURCE_RE.test(p)) return null;
  if (p.startsWith("admin_")) return null;
  return p;
}

/**
 * Jeton de liaison d'un compte de l'équipe (`/start admin_<jeton>`, lien de Mon compte ; "" s'il manque), sinon null.
 * Il n'est jamais une source de conversation ni écrit dans le journal.
 */
export function adminLinkToken(payload: string | null | undefined): string | null {
  const p = (payload ?? "").trim();
  return p.startsWith("admin_") ? p.slice("admin_".length) : null;
}

/** Commandes de l'assistant. */
export type AssistantCommand = "start" | "stop" | "reset";

/** Commande reconnue au début d'un texte (`/stop`, `/start tk01`, `/reset@MonBot`), sinon null. */
export function parseAssistantCommand(
  text: string | null | undefined,
  botUsername?: string,
): { command: AssistantCommand; payload: string | null } | null {
  const m = /^\/(start|stop|reset)(?:@([A-Za-z0-9_]{1,64}))?(?:\s+([\s\S]*))?$/i.exec(
    (text ?? "").trim(),
  );
  if (!m) return null;
  // `/stop@AutreBot` s'adresse à un autre bot (n'arrive qu'en groupe, mais on reste strict).
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  const payload = (m[3] ?? "").trim();
  return { command: m[1]!.toLowerCase() as AssistantCommand, payload: payload || null };
}

/** Message reçu, tel que gardé dans la conversation : texte brut (ou légende) et nature du média éventuel. */
export type AssistantInbound = { text: string; media: { kind: ChatMediaKind } | null };

/** Contenus envoyés par la personne elle-même rangés dans « autre » (les messages de service ne comptent pas). */
const OTHER_CONTENT_KEYS = [
  "contact",
  "location",
  "venue",
  "poll",
  "dice",
  "game",
  "story",
  "paid_media",
  "checklist",
] as const;

/**
 * Nature d'un message privé reçu : texte, photo, autocollant, vocal, vidéo, document ou autre (contact, position,
 * sondage…). Texte gardé = `text` ou `caption` (légende), "" pour un média sans légende. Message de service (message
 * épinglé, accès accordé au bot, paiement…) : null, il n'est pas un message de la personne.
 */
export function classifyAssistantMessage(msg: Message): AssistantInbound | null {
  if (typeof msg.text === "string") return { text: msg.text, media: null };
  const kind = mediaKindOf(msg);
  if (!kind) return null;
  return { text: typeof msg.caption === "string" ? msg.caption : "", media: { kind } };
}

function mediaKindOf(msg: Message): ChatMediaKind | null {
  if (msg.photo) return "photo";
  if (msg.sticker) return "sticker";
  if (msg.voice || msg.audio) return "voice";
  // Une animation (GIF) porte aussi `document` : elle est rangée avec les vidéos.
  if (msg.video || msg.video_note || msg.animation) return "video";
  if (msg.document) return "document";
  const raw = msg as unknown as Record<string, unknown>;
  if (OTHER_CONTENT_KEYS.some((k) => raw[k] !== undefined && raw[k] !== null)) return "other";
  return null;
}

/**
 * Langue des textes fixes (`stopDone`, `resetDone`, `stoppedAlready`) : langue courante de la conversation, sinon celle
 * de la personne si la persona la parle, sinon la première langue de la persona, sinon la langue de la personne, sinon fr.
 */
export function assistantReplyLang(input: {
  conversationLanguage?: string | null;
  memberLanguage?: string | null;
  personaLanguages?: readonly string[] | null;
}): ChatLang {
  const current = chatLangOf(input.conversationLanguage);
  if (current) return current;
  const personaLangs = (input.personaLanguages ?? [])
    .map((l) => chatLangOf(l))
    .filter((l): l is ChatLang => l !== null);
  const member = chatLangOf(input.memberLanguage);
  if (member && (personaLangs.length === 0 || personaLangs.includes(member))) return member;
  return personaLangs[0] ?? member ?? "fr";
}

// ------------------------------------------------------------------
// Peut répondre, réouverture
// ------------------------------------------------------------------

/**
 * Persona qui parle dans une conversation : celle posée sur la conversation (persona du bot au premier message), sinon
 * celle du bot. Même règle que le worker (`Conversation.personaId ?? Bot.personaId`).
 */
export function conversationPersonaId(
  conv: { personaId: string | null },
  bot: { personaId?: string | null },
): string | null {
  return conv.personaId ?? bot.personaId ?? null;
}

/**
 * Fermetures dues à l'envoi seulement (bot bloqué, personne injoignable) : la conversation repart quand la personne
 * réécrit elle-même (`/start`, message). Jamais après un /stop, pour un mineur, ni une fermeture par l'équipe.
 */
export const REOPENABLE_CLOSE_REASONS: readonly string[] = ["BLOCKED", "UNREACHABLE"];

export function canReopenConversation(conv: {
  status: ConversationStatus;
  closedReason: string | null;
  stoppedAt: Date | null;
  isMinor: boolean;
}): boolean {
  return (
    conv.status === "CLOSED" &&
    !conv.stoppedAt &&
    !conv.isMinor &&
    conv.closedReason !== null &&
    REOPENABLE_CLOSE_REASONS.includes(conv.closedReason)
  );
}

/**
 * Étape d'une conversation rouverte : celle d'avant la fermeture (passage d'étape vers CLOSED), sinon la discussion si
 * l'assistant avait déjà répondu, sinon l'accueil.
 */
export function reopenStage(input: {
  stageBeforeClose: ConversationStage | null;
  assistantTurns: number;
}): ConversationStage {
  const before = input.stageBeforeClose;
  if (before && before !== "CLOSED") return before;
  return input.assistantTurns > 0 ? "CHAT" : "WELCOME";
}

// ------------------------------------------------------------------
// Journal sans texte (table Event) : jamais le texte d'une conversation de l'assistant
// ------------------------------------------------------------------

/** Champs de texte remplacés par leur longueur (`textLength`, `captionLength`, `file_nameLength`…). */
const TEXT_KEYS = new Set(["text", "caption", "question", "explanation", "file_name"]);
/** Mises en forme et contenus associés au texte (dont l'adresse d'aperçu d'un lien tapé) : retirés. */
const DROPPED_KEYS = new Set([
  "link_preview_options",
  "entities",
  "caption_entities",
  "question_entities",
  "explanation_entities",
  "text_entities",
]);
/** Données personnelles d'un message (contact, position, lieu) : remplacées par une simple mention. */
const PRIVATE_KEYS = new Set(["contact", "location", "venue"]);

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 12 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(k)) continue;
    if (TEXT_KEYS.has(k) && typeof v === "string") {
      out[`${k}Length`] = [...v].length;
      continue;
    }
    if (PRIVATE_KEYS.has(k) && v && typeof v === "object") {
      out[k] = { redacted: true };
      continue;
    }
    out[k] = redactValue(v, depth + 1);
  }
  return out;
}

/**
 * Update d'un bot assistant telle qu'écrite dans la table `Event` : aucun texte, aucune légende, aucun nom de fichier,
 * aucune mise en forme ni adresse d'aperçu de lien (longueur seulement : `textLength`, `captionLength`), contact /
 * position / lieu masqués. Copie : l'update traitée
 * par les handlers reste entière. Idempotent.
 */
export function redactAssistantUpdate(update: Update): Update {
  return redactValue(update, 0) as Update;
}
