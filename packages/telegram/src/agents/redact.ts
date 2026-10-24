/**
 * Masquage d'un secret dans une update AVANT sa journalisation (`Event`), dans le texte OU la légende d'un média : clé collée par l'admin (« clé fal … »,
 * « bookmaker … », « jeton boss … » et tout jeton de bot (phase 26), filet « voici la clé … <mot de 16 caractères ou plus> », réponse au message de N'IMPORTE QUELLE
 * demande SECRET, même close, ou texte qui ressemble à une clé pendant une demande SECRET en cours). Mêmes règles que
 * `handleAdminText` : les messages ordinaires de l'admin (« fait », « Parfait! ») restent journalisés tels quels,
 * `pnpm tg:inbox` les lit dans `Event`.
 */
import { isSecretAdminText, isSecretCommandText, looksLikeBotToken } from "@linkaffipro/agents";
import type { AgentsAdminState } from "../ports";
import type { Message, Update } from "grammy/types";
import type { TelegramDeps } from "../ports";

export const SECRET_REDACTED_TEXT = "[secret retiré]";

/** Message privé d'une personne (texte OU légende d'un média), nouveau ou modifié. */
function privateText(update: Update): { key: "message" | "edited_message"; msg: Message; content: string } | null {
  for (const key of ["message", "edited_message"] as const) {
    const msg = update[key];
    if (!msg || msg.chat.type !== "private" || !msg.from || msg.from.is_bot) continue;
    const content = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : null;
    if (content !== null) return { key, msg, content };
  }
  return null;
}

/** Copie du message sans son texte ni sa légende (ni leurs mises en forme). */
function redactedMessage(msg: Message): Message {
  const { entities: _e, caption_entities: _ce, text, caption, ...rest } = msg;
  return {
    ...rest,
    ...(typeof text === "string" ? { text: SECRET_REDACTED_TEXT } : {}),
    ...(typeof caption === "string" ? { caption: SECRET_REDACTED_TEXT } : {}),
  } as Message;
}

/** Contexte de `isSecretAdminText` tiré de l'état lu (ancienne forme : seulement `secretPending`). */
export function secretContextOf(
  state: AgentsAdminState,
  replyToMessageId?: number | null,
  opts: { withRetired?: boolean } = {},
) {
  return {
    pending: state.pendingSecret ?? (state.secretPending ? { key: "", telegramMessageId: null } : null),
    replyToMessageId: replyToMessageId ?? null,
    secretMessageIds: [...(state.secretMessageIds ?? []), ...(opts.withRetired ? (state.retiredSecretMessageIds ?? []) : [])],
  };
}

/**
 * Copie de l'update sans le texte (ou la légende) secret (même update si rien n'est à masquer). Ne lève jamais.
 * Détecteur partagé `isSecretAdminText` (`@linkaffipro/agents`, chemin rapide du Boss) pour l'admin : clés nues, mot de
 * passe même court pendant une demande SECRET, réponse à une question SECRET (y compris celles posées par ce bot avant
 * la bascule vers Kevin). Toute autre personne : commandes de clé et jetons de bot seulement.
 */
export async function redactAdminSecretUpdate(
  update: Update,
  deps: Pick<TelegramDeps, "agentsAdminState">,
): Promise<Update> {
  const found = privateText(update);
  if (!found) return update;
  const { key, msg, content } = found;
  // Phase 26 : « jeton boss <valeur> » et tout jeton de bot collé (même transféré) ne sont jamais journalisés.
  let secret = isSecretCommandText(content) || looksLikeBotToken(content);
  if (!secret && deps.agentsAdminState) {
    try {
      const state = await deps.agentsAdminState(BigInt(msg.from!.id));
      secret =
        state.isAdmin &&
        isSecretAdminText(content, secretContextOf(state, msg.reply_to_message?.message_id, { withRetired: true }));
    } catch (err) {
      console.warn("[telegram] état des demandes non lu", (err as Error).message);
      // Doute : le détecteur sans contexte (masquer de trop ne coûte rien).
      secret = isSecretAdminText(content, null);
    }
  }
  if (!secret) return update;
  return { ...update, [key]: redactedMessage(msg) } as Update;
}

export const GROUP_TEXT_REDACTED = (n: number) => `[message de groupe : ${n} caractères]`;

/**
 * Phase 26, section 4 — journal du Boss (`Event`) : un message du GROUPE n'y garde JAMAIS son texte (ni légende, ni
 * entités) : les conversations de l'équipe ne quittent pas la conversation (ce que Kevin en retient est dans
 * `BossTurn`, secrets en « [secret] »). En privé : les mêmes règles que le dialogue admin, appliquées à TOUTE personne
 * (un membre présenté qui envoie sa clé à Kevin est masqué comme l'admin). Ne lève jamais.
 */
export async function redactBossUpdate(update: Update, deps: Pick<TelegramDeps, "agentsAdminState">): Promise<Update> {
  for (const key of ["message", "edited_message"] as const) {
    const msg = update[key];
    if (!msg || (msg.chat.type !== "group" && msg.chat.type !== "supergroup")) continue;
    const { entities: _e, caption_entities: _ce, text, caption, ...rest } = msg;
    const kept: Record<string, unknown> = { ...rest };
    if (typeof text === "string") kept.text = GROUP_TEXT_REDACTED(text.length);
    if (typeof caption === "string") kept.caption = GROUP_TEXT_REDACTED(caption.length);
    // Message auquel il répond : texte retiré aussi.
    if (rest.reply_to_message) {
      const { text: rt, caption: rc, entities: _re, caption_entities: _rce, ...r } = rest.reply_to_message;
      kept.reply_to_message = { ...r, ...(typeof rt === "string" ? { text: GROUP_TEXT_REDACTED(rt.length) } : {}), ...(typeof rc === "string" ? { caption: GROUP_TEXT_REDACTED(rc.length) } : {}) };
    }
    return { ...update, [key]: kept } as Update;
  }
  const found = privateText(update);
  if (!found) return update;
  const { key, msg, content } = found;
  let secret = isSecretCommandText(content) || looksLikeBotToken(content) || isSecretAdminText(content, null);
  if (!secret && deps.agentsAdminState) {
    try {
      const state = await deps.agentsAdminState(BigInt(msg.from!.id));
      secret = isSecretAdminText(content, secretContextOf(state, msg.reply_to_message?.message_id));
    } catch (err) {
      console.warn("[telegram] état des demandes non lu", (err as Error).message);
    }
  }
  // Un long mot qui ressemble à une clé envoyé en privé au Boss (membre qui répond à sa demande) : masqué aussi.
  if (!secret) secret = content.split(/\s+/).some((w) => w.length >= 20 && /\p{L}/u.test(w) && /\d/.test(w) && !/^https?:\/\//i.test(w));
  if (!secret) return update;
  return { ...update, [key]: redactedMessage(msg) } as Update;
}

// ——— Phase 27 : posts transférés (canal d'inspiration) ———

export const FORWARDED_TEXT_REDACTED = (n: number) => `[post transféré : ${n} caractères]`;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Champs média d'un message (remplacés par le seul type de média). */
const MEDIA_FIELDS = ["photo", "video", "animation", "video_note", "document", "poll", "audio", "voice", "sticker", "location", "venue", "contact", "dice", "story", "paid_media"] as const;

/** Le message est-il un transfert (`forward_origin`, ou anciens champs `forward_from_chat` / `forward_from` …) ? */
export function isForwardedMessage(msg: unknown): boolean {
  if (!isObj(msg)) return false;
  return ["forward_origin", "forward_from_chat", "forward_from", "forward_date", "forward_sender_name", "forward_signature"].some((k) => msg[k] !== undefined && msg[k] !== null);
}

/** Origine gardée : type, date, canal ou groupe d'origine et numéro ; jamais une personne ni une signature. */
function safeOrigin(o: unknown): Json | undefined {
  if (!isObj(o)) return undefined;
  const out: Json = { type: o.type, date: o.date };
  if (isObj(o.chat)) out.chat = { id: o.chat.id, type: o.chat.type, title: o.chat.title, username: o.chat.username };
  if (isObj(o.sender_chat)) out.sender_chat = { id: o.sender_chat.id, type: o.sender_chat.type, title: o.sender_chat.title, username: o.sender_chat.username };
  if (o.message_id !== undefined) out.message_id = o.message_id;
  return out;
}

/**
 * Copie d'un message transféré pour le journal : ni texte, ni légende, ni mises en forme, ni boutons, ni citation, ni
 * auteur d'origine (signature, nom, personne) ; seulement la longueur du texte et le type de média. Pure.
 */
export function redactForwardedMessage(msg: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(msg)) {
    if (["text", "caption", "entities", "caption_entities", "reply_markup", "forward_signature", "forward_sender_name", "forward_from", "quote", "external_reply", "media_group_id"].includes(k)) continue;
    if ((MEDIA_FIELDS as readonly string[]).includes(k)) continue;
    if (k === "forward_origin") {
      const o = safeOrigin(v);
      if (o) out.forward_origin = o;
      continue;
    }
    if (k === "forward_from_chat" && isObj(v)) {
      out.forward_from_chat = { id: v.id, type: v.type, title: v.title, username: v.username };
      continue;
    }
    if (k === "reply_to_message" && isObj(v)) {
      out.reply_to_message = isForwardedMessage(v) ? redactForwardedMessage(v) : v;
      continue;
    }
    out[k] = v;
  }
  if (typeof msg.text === "string") out.text = FORWARDED_TEXT_REDACTED([...msg.text].length);
  if (typeof msg.caption === "string") out.caption = FORWARDED_TEXT_REDACTED([...msg.caption].length);
  const media = MEDIA_FIELDS.find((k) => msg[k] !== undefined && msg[k] !== null);
  if (media) out.media_kind = media;
  out.forwarded_redacted = true;
  return out;
}

/**
 * Update à journaliser sans le contenu d'un post transféré (privé ou groupe) : la même update si rien n'est transféré.
 * Appliquée à tout bot de travail (le Boss, le bot du dialogue admin et le groupe de l'équipe compris) : les posts
 * d'un canal de référence ne sont gardés que dans `ReferencePost` (30 jours), jamais dans `Event`. Ne lève jamais.
 */
export function redactForwardedUpdate<T>(update: T): T {
  if (!isObj(update)) return update;
  let changed = false;
  const out: Json = { ...update };
  for (const key of ["message", "edited_message"] as const) {
    const msg = update[key];
    if (!isObj(msg) || !isForwardedMessage(msg) || msg.forwarded_redacted === true) continue;
    out[key] = redactForwardedMessage(msg);
    changed = true;
  }
  return (changed ? out : update) as T;
}
