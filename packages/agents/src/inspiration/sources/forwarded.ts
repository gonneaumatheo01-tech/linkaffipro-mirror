/**
 * Phase 27 (chantier A, lecture) — post transféré à Kevin (privé ou groupe) → format commun `ReferencePostInput`
 * (règle 2, troisième voie). L'origine vient de `forward_origin` (Bot API 7.0) : `channel` donne le canal (identifiant,
 * nom public, titre) et le numéro du post ; `user`, `hidden_user`, `chat` ou rien : origine inconnue (Kevin demandera
 * le nom du canal une fois, chantier C). Aucun média téléchargé ; liens comptés, jamais suivis. Fonction pure.
 */
import { textHash } from "../copy-check";
import type { ReferenceMediaKind, ReferencePostInput } from "../contract";

type Entity = { type: string; offset?: number; length?: number; url?: string };
type Button = { text?: string; url?: string; callback_data?: string };
type Chat = { id: number | bigint; type?: string; title?: string; username?: string };

/** Sous-ensemble du `Message` de la Bot API utile ici (les autres champs sont ignorés). */
export type ForwardedMessage = {
  message_id: number;
  date: number;
  /** Album (plusieurs photos ou vidéos envoyées ensemble) : même valeur pour chaque élément. */
  media_group_id?: string;
  chat?: { id: number | bigint };
  text?: string;
  caption?: string;
  entities?: Entity[];
  caption_entities?: Entity[];
  photo?: unknown[];
  video?: unknown;
  animation?: unknown;
  video_note?: unknown;
  document?: unknown;
  poll?: { question?: string };
  audio?: unknown;
  voice?: unknown;
  sticker?: unknown;
  location?: unknown;
  reply_markup?: { inline_keyboard?: Button[][] };
  forward_origin?:
    | { type: "channel"; date: number; chat: Chat; message_id: number; author_signature?: string }
    | { type: "user"; date: number; sender_user?: unknown }
    | { type: "hidden_user"; date: number; sender_user_name?: string }
    | { type: "chat"; date: number; sender_chat?: Chat }
    | { type: string; date: number; [k: string]: unknown };
  /** Anciens champs (avant Bot API 7.0), encore envoyés par certains clients. */
  forward_from_chat?: Chat;
  forward_from_message_id?: number;
  forward_date?: number;
};

export type ForwardedOrigin = { chatId: bigint; username: string | null; title: string | null };

function mediaKindOf(m: ForwardedMessage): ReferenceMediaKind {
  if (m.video || m.animation || m.video_note) return "video";
  if (m.photo && m.photo.length) return "photo";
  if (m.poll) return "poll";
  // Une animation arrive aussi avec `document` : vidéo d'abord.
  if (m.document) return "document";
  if (m.audio || m.voice || m.sticker || m.location) return "other";
  return "text";
}

function originOf(m: ForwardedMessage): { origin: ForwardedOrigin; messageId: number | null; date: number } | { origin: null; date: number | null } {
  const o = m.forward_origin;
  if (o && o.type === "channel") {
    const c = o as Extract<ForwardedMessage["forward_origin"], { type: "channel" }>;
    return {
      origin: { chatId: BigInt(c.chat.id), username: c.chat.username ?? null, title: c.chat.title ?? null },
      messageId: typeof c.message_id === "number" ? c.message_id : null,
      date: c.date,
    };
  }
  if (!o && m.forward_from_chat && m.forward_from_chat.type === "channel")
    return {
      origin: { chatId: BigInt(m.forward_from_chat.id), username: m.forward_from_chat.username ?? null, title: m.forward_from_chat.title ?? null },
      messageId: m.forward_from_message_id ?? null,
      date: m.forward_date ?? m.date,
    };
  return { origin: null, date: o?.date ?? m.forward_date ?? null };
}

/**
 * Numéro stable d'un post sans numéro d'origine (transfert masqué) : négatif (jamais confondu avec un vrai numéro),
 * tiré de l'empreinte du texte et de la date d'origine. Le même post transféré deux fois garde le même numéro.
 */
export function syntheticExternalId(text: string | null, date: number, mediaKind: ReferenceMediaKind): number {
  const h = textHash(`${text ?? ""}|${date}|${mediaKind}`);
  return -(parseInt(h.slice(0, 8), 16) % 2_000_000_000) - 1;
}

/** Message transféré → origine (ou null) + post au format commun. Pas un transfert : `null`. */
export function forwardedToReferencePost(message: ForwardedMessage): { origin: ForwardedOrigin | null; post: ReferencePostInput } | null {
  const isForward = Boolean(message.forward_origin || message.forward_from_chat || message.forward_date);
  if (!isForward) return null;
  const o = originOf(message);
  const mediaKind = mediaKindOf(message);
  const raw = message.text ?? message.caption ?? (mediaKind === "poll" ? (message.poll?.question ?? null) : null);
  const text = raw && raw.trim() ? raw.trim() : null;
  const entities = message.entities ?? message.caption_entities ?? [];
  const buttons = (message.reply_markup?.inline_keyboard ?? []).flat();
  const linkCount = entities.filter((e) => e.type === "url" || e.type === "text_link").length;
  const date = o.date ?? message.date;
  const externalId = o.origin && "messageId" in o && o.messageId !== null ? o.messageId : syntheticExternalId(text, date, mediaKind);
  return {
    origin: o.origin,
    post: {
      externalId,
      postedAt: new Date(date * 1000),
      text,
      mediaKind,
      views: null,
      hasButton: buttons.length > 0,
      linkCount,
    },
  };
}

/**
 * Clé d'album d'un message transféré (`media_group_id`, par conversation) : null hors album. Sert à reconnaître une
 * photo d'un album déjà rangé quand les éléments arrivent dans des updates séparées.
 */
export function forwardedAlbumKey(message: ForwardedMessage): string | null {
  if (!message.media_group_id) return null;
  return `${message.chat ? String(message.chat.id) : "?"}:${message.media_group_id}`;
}

const MEDIA_RANK: Record<ReferenceMediaKind, number> = { video: 5, photo: 4, document: 3, poll: 2, other: 1, text: 0 };

/**
 * Messages transférés → posts au format commun, un album (`media_group_id`) = UN post : numéro et date du premier
 * élément (plus petit numéro d'origine), texte = la légende non vide (Telegram la porte sur un seul élément), média le
 * plus parlant (vidéo avant photo), boutons et liens réunis. Messages non transférés ignorés ; ordre d'arrivée gardé.
 */
export function groupForwardedAlbums(messages: readonly ForwardedMessage[]): { origin: ForwardedOrigin | null; post: ReferencePostInput }[] {
  type Item = { origin: ForwardedOrigin | null; post: ReferencePostInput; album: string | null };
  const out: Item[] = [];
  const byAlbum = new Map<string, Item>();
  for (const m of messages) {
    const r = forwardedToReferencePost(m);
    if (!r) continue;
    const key = forwardedAlbumKey(m);
    const prev = key ? byAlbum.get(key) : undefined;
    if (!key || !prev) {
      const item: Item = { ...r, album: key };
      out.push(item);
      if (key) byAlbum.set(key, item);
      continue;
    }
    const a = prev.post;
    const b = r.post;
    const first = b.externalId > 0 && (a.externalId < 0 || b.externalId < a.externalId) ? b : a;
    const text = a.text ?? b.text;
    prev.post = {
      externalId: first.externalId,
      postedAt: first.postedAt,
      text,
      mediaKind: MEDIA_RANK[b.mediaKind] > MEDIA_RANK[a.mediaKind] ? b.mediaKind : a.mediaKind,
      views: a.views ?? b.views,
      hasButton: a.hasButton || b.hasButton,
      linkCount: Math.max(a.linkCount, b.linkCount),
    };
    prev.origin ??= r.origin;
  }
  // Album sans numéro d'origine (transfert masqué) : numéro stable tiré de la légende, comme un post seul.
  return out.map(({ origin, post }) => ({
    origin,
    post: post.externalId < 0 ? { ...post, externalId: syntheticExternalId(post.text, Math.round(post.postedAt.getTime() / 1000), post.mediaKind) } : post,
  }));
}
