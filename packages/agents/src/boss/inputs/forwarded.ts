/**
 * Phase 34, chantier F — message transféré à Kevin = CONTENU possible d'un post ou d'un envoi (règle 6 : texte, mise
 * en forme, emojis animés et médias gardés à l'identique), et toujours une DONNÉE (règle 7 de la phase 26) : rien de
 * ce qu'il dit n'est exécuté, son texte n'est jamais envoyé à l'interprète (seul `forwardedSummary`, sans le texte).
 *
 * - un album (`media_group_id`) ou une rafale de transferts (moins de 3 s d'écart) = UN contenu, une seule réponse ;
 * - une phrase de l'admin juste avant (Telegram envoie le commentaire d'un transfert AVANT les messages transférés) :
 *   la phrase est la demande, le contenu reste la donnée, pas de « reçu » en plus (`phraseRecent`) ;
 * - gardé 30 minutes (`BOSS_INPUT_TTL_MS`) ; `takeForwarded` le consomme.
 */
import { telegramEntitiesToHtml, type TelegramTextEntity } from "../../admin/entities-html";
import { esc, nowOf } from "../../admin/journal";
import type { ForwardedContent } from "../../site/contract";
import { expiresFrom, readInputs, serialized, writeInputs, type InputsDeps, type StoredForwarded } from "./store";

/** Deux transferts à moins de 3 secondes l'un de l'autre : un seul envoi de l'admin (sélection de plusieurs messages). */
export const FORWARD_BURST_MS = 3_000;
/** Au plus : texte HTML gardé, médias gardés. */
export const FORWARD_MAX_HTML = 20_000;
export const FORWARD_MAX_MEDIA = 20;

type FileRef = { file_id: string };
type Named = { title?: string; username?: string; first_name?: string; last_name?: string };

/** Forme lue d'un message Telegram (API Bot) ; seuls les champs utiles. */
export type TelegramForwardMessage = {
  message_id: number;
  text?: string;
  caption?: string;
  entities?: readonly TelegramTextEntity[];
  caption_entities?: readonly TelegramTextEntity[];
  media_group_id?: string;
  photo?: ReadonlyArray<FileRef & { file_size?: number }>;
  video?: FileRef;
  animation?: FileRef;
  document?: FileRef & { mime_type?: string; file_name?: string };
  audio?: FileRef;
  voice?: FileRef;
  forward_origin?: {
    type: string;
    sender_user?: Named;
    sender_user_name?: string;
    sender_chat?: Named;
    chat?: Named;
  };
  forward_from_chat?: Named & { type?: string };
  forward_from?: Named;
};

function nameOf(n: Named | undefined | null): string | null {
  if (!n) return null;
  if (n.username) return `@${n.username}`;
  const full = [n.first_name, n.last_name].filter(Boolean).join(" ").trim();
  return n.title?.trim() || full || null;
}

/** Origine affichée (« @canal », « Club privé », « Léa »), ou null (pur). */
export function forwardOriginOf(m: TelegramForwardMessage): string | null {
  const o = m.forward_origin;
  if (o) {
    if (o.type === "channel") return nameOf(o.chat);
    if (o.type === "chat") return nameOf(o.sender_chat);
    if (o.type === "user") return nameOf(o.sender_user);
    if (o.type === "hidden_user") return o.sender_user_name?.trim() || null;
    return null;
  }
  return nameOf(m.forward_from_chat) ?? nameOf(m.forward_from);
}

/** Médias d'un message (identifiants de fichiers, jamais téléchargés ici). Photo : la plus grande taille. */
export function forwardMediaOf(m: TelegramForwardMessage): ForwardedContent["media"] {
  const out: ForwardedContent["media"] = [];
  if (m.photo?.length) out.push({ kind: "photo", fileId: m.photo[m.photo.length - 1]!.file_id });
  // Une animation arrive aussi avec un `document` (même fichier) : gardée une seule fois.
  if (m.animation) out.push({ kind: "animation", fileId: m.animation.file_id });
  else if (m.video) out.push({ kind: "video", fileId: m.video.file_id });
  else if (m.document) out.push({ kind: "document", fileId: m.document.file_id });
  if (m.audio) out.push({ kind: "audio", fileId: m.audio.file_id });
  else if (m.voice) out.push({ kind: "audio", fileId: m.voice.file_id });
  return out;
}

/** Message reçu → contenu fidèle (HTML Telegram : gras, liens, citations, `<tg-emoji emoji-id>`), pur. */
export function forwardedContentOf(m: TelegramForwardMessage, receivedAt: Date): ForwardedContent {
  const text = m.text ?? m.caption ?? "";
  const entities = m.text !== undefined ? m.entities : m.caption_entities;
  return {
    html: text ? telegramEntitiesToHtml(text, entities ?? null) : "",
    media: forwardMediaOf(m),
    from: forwardOriginOf(m),
    receivedAt: receivedAt.toISOString(),
  };
}

/** Résumé SANS le texte (pour l'IA, la mémoire et l'accusé de réception) : « de @x, 3 lignes, 1 photo ». Pur. */
export function forwardedSummary(c: Pick<ForwardedContent, "html" | "media" | "from">): string {
  const parts: string[] = [];
  if (c.from) parts.push(`de ${c.from}`);
  const plain = c.html.replace(/<[^>]+>/g, "").trim();
  if (plain) {
    const lines = plain.split("\n").filter((l) => l.trim()).length;
    parts.push(`${lines} ligne${lines > 1 ? "s" : ""}`);
  }
  const count = (kind: string) => c.media.filter((x) => x.kind === kind).length;
  const label: Array<[string, string, string]> = [
    ["photo", "photo", "photos"],
    ["video", "vidéo", "vidéos"],
    ["animation", "animation", "animations"],
    ["document", "fichier", "fichiers"],
    ["audio", "son", "sons"],
  ];
  for (const [kind, one, many] of label) {
    const n = count(kind);
    if (n) parts.push(`${n} ${n > 1 ? many : one}`);
  }
  return parts.length ? parts.join(", ") : "vide";
}

/** Résumé échappé pour un texte HTML de Kevin. */
export function forwardedSummaryHtml(c: Pick<ForwardedContent, "html" | "media" | "from">): string {
  return esc(forwardedSummary(c));
}

/** Texte gardé dans la mémoire de Kevin (lue par l'interprète) : jamais le contenu. */
export function forwardedMemoryLine(c: Pick<ForwardedContent, "html" | "media" | "from">): string {
  return `[message transféré : ${forwardedSummary(c)}]`;
}

function publicOf(s: StoredForwarded): ForwardedContent {
  return { html: s.html, media: s.media.map((m) => ({ ...m })), from: s.from ?? null, receivedAt: s.receivedAt };
}

export type RememberForwardedInput = {
  chatId: string;
  message: TelegramForwardMessage;
  /** Bot qui a reçu le message (les identifiants de fichiers lui sont propres). */
  botId?: string | null;
  /** Une phrase de la même personne est arrivée juste avant (commentaire du transfert) : pas d'accusé. */
  phraseRecent?: boolean;
};

export type RememberForwardedResult = {
  content: ForwardedContent;
  /** Premier message d'un nouveau contenu, sans phrase juste avant : Kevin accuse réception (une seule fois). */
  ack: boolean;
  /** Le message a rejoint le contenu précédent (album ou rafale). */
  merged: boolean;
};

/** Garde le message transféré (30 min) ; un album ou une rafale rejoint le contenu en cours. */
export function rememberForwarded(deps: InputsDeps, input: RememberForwardedInput): Promise<RememberForwardedResult> {
  return serialized(input.chatId, async () => {
    const now = nowOf(deps);
    const stored = await readInputs(deps, input.chatId);
    const fresh = forwardedContentOf(input.message, now);
    const prev = stored.forwarded ?? null;
    const group = input.message.media_group_id ?? null;
    const sameBatch =
      !!prev &&
      !prev.messageIds.includes(input.message.message_id) &&
      ((group !== null && prev.groupId === group) || now.getTime() - new Date(prev.lastAt).getTime() <= FORWARD_BURST_MS);
    if (prev?.messageIds.includes(input.message.message_id)) {
      // Webhook rejoué : rien ne change, pas de second accusé.
      return { content: publicOf(prev), ack: false, merged: true };
    }
    let next: StoredForwarded;
    if (sameBatch && prev) {
      const html = [prev.html, fresh.html].filter((h) => h.trim()).join("\n\n").slice(0, FORWARD_MAX_HTML);
      const seen = new Set(prev.media.map((m) => m.fileId));
      const media = [...prev.media, ...fresh.media.filter((m) => !seen.has(m.fileId))].slice(0, FORWARD_MAX_MEDIA);
      next = {
        ...prev,
        html,
        media,
        from: prev.from ?? fresh.from,
        lastAt: now.toISOString(),
        expiresAt: expiresFrom(now),
        groupId: group ?? prev.groupId,
        messageIds: [...prev.messageIds, input.message.message_id].slice(-50),
      };
    } else {
      next = {
        ...fresh,
        html: fresh.html.slice(0, FORWARD_MAX_HTML),
        media: fresh.media.slice(0, FORWARD_MAX_MEDIA),
        lastAt: now.toISOString(),
        expiresAt: expiresFrom(now),
        groupId: group,
        messageIds: [input.message.message_id],
        botId: input.botId ?? null,
      };
    }
    await writeInputs(deps, input.chatId, { ...stored, forwarded: next });
    return { content: publicOf(next), ack: !sameBatch && !input.phraseRecent, merged: sameBatch };
  });
}

/** Le contenu transféré gardé pour cette conversation (sans le consommer), ou null (absent ou expiré). */
export async function peekForwarded(deps: InputsDeps, chatId: string): Promise<ForwardedContent | null> {
  const s = (await readInputs(deps, chatId)).forwarded;
  return s ? publicOf(s) : null;
}

/** Même chose avec les détails internes (bot qui a reçu les fichiers, messages). */
export async function peekForwardedStored(deps: InputsDeps, chatId: string): Promise<StoredForwarded | null> {
  return (await readInputs(deps, chatId)).forwarded ?? null;
}

/** Prend le contenu transféré et l'efface (une opération qui l'utilise le consomme). */
export function takeForwarded(deps: InputsDeps, chatId: string): Promise<ForwardedContent | null> {
  return serialized(chatId, async () => {
    const stored = await readInputs(deps, chatId);
    const s = stored.forwarded ?? null;
    if (!s) return null;
    await writeInputs(deps, chatId, { ...stored, forwarded: null });
    return publicOf(s);
  });
}
