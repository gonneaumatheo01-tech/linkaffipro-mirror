/**
 * Phase 27 — lecture d'un canal de référence (« canal d'inspiration ») PAR la session déjà tenue ici : le worker ne se
 * connecte jamais aux comptes réels (une seconde connexion ferait révoquer la session). Même voie que les DM de
 * bienvenue : le worker dépose une demande en base (`Setting` `userbot.request.<id>`), cette boucle la traite et écrit
 * la réponse dans la même ligne. Protocole : copie structurelle de
 * `packages/agents/src/inspiration/sources/userbot-mailbox.ts`.
 *
 * Garde-fous :
 * - jamais un compte qui converse (persona ou bot fantôme), jamais un compte non connecté ici ;
 * - `is-member` lit l'entité du canal sans la rejoindre ; `history` : un lot de 50 au plus (`messages.getHistory`),
 *   5 s au moins entre deux lots d'un même compte ; `join-invite` : une seule tentative (`messages.importChatInvite`),
 *   déposée par le worker seulement après le CONFIRM du client ; aucun `JoinChannel`, aucun nom public rejoint ;
 * - FLOOD_WAIT jamais attendu ici : renvoyé au worker, qui attend ou arrête ;
 * - aucun média téléchargé, aucun membre lu ; journaux sans texte ni nom de canal ;
 * - une demande à la fois, boucle à part (les conversations des comptes ne passent pas par ici).
 */
import { floodWaitSecondsOf } from "@linkaffipro/mtproto";
import { Api, helpers, type TelegramClient } from "telegram";
import { logger } from "./logger";

export const USERBOT_REQUEST_PREFIX = "userbot.request.";
export const USERBOT_HEARTBEAT_KEY = "userbot.mailbox.heartbeat";
const INTERVAL_MS = 2_000;
const HEARTBEAT_EVERY_MS = 20_000;
/** Demande plus vieille que 15 minutes : abandonnée (le worker n'attend plus). */
export const STALE_REQUEST_MS = 15 * 60_000;
/** 5 s au moins entre deux lots d'historique d'un même compte. */
export const HISTORY_MIN_GAP_MS = 5_000;
export const HISTORY_MAX_LIMIT = 50;

export type MediaKind = "text" | "photo" | "video" | "poll" | "document" | "other";
export type WireChannel = { username: string | null; chatId: string | null };
export type WirePost = { externalId: number; postedAt: string; text: string | null; mediaKind: MediaKind; views: number | null; hasButton: boolean; linkCount: number };
export type UserbotRequest =
  | { kind: "is-member"; accountId: string; channel: WireChannel }
  | { kind: "history"; accountId: string; channel: WireChannel; limit: number; beforeId?: number }
  | { kind: "join-invite"; accountId: string; inviteLink: string };
export type UserbotResponse =
  | { ok: true; member?: boolean; posts?: WirePost[]; title?: string | null; chatId?: string | null }
  | { ok: false; error: string }
  | { ok: false; floodWaitSeconds: number };
type Row = UserbotRequest & { status: "PENDING" | "WORKING" | "DONE"; createdAt: string; response?: UserbotResponse };

// ——— Conversion d'un message GramJS (règle pure, sur `className`) ———

type AnyObj = { className?: string; [k: string]: unknown };

function mediaKindOf(media: AnyObj | undefined | null): MediaKind {
  if (!media) return "text";
  switch (media.className) {
    case "MessageMediaPhoto":
      return "photo";
    case "MessageMediaPoll":
      return "poll";
    case "MessageMediaWebPage":
      return "text";
    case "MessageMediaDocument": {
      const doc = media.document as AnyObj | undefined;
      const attrs = (doc?.attributes as AnyObj[] | undefined) ?? [];
      if (attrs.some((a) => a.className === "DocumentAttributeVideo" || a.className === "DocumentAttributeAnimated")) return "video";
      if (attrs.some((a) => a.className === "DocumentAttributeSticker" || a.className === "DocumentAttributeAudio")) return "other";
      return "document";
    }
    default:
      return "other";
  }
}

function pollQuestion(media: AnyObj | undefined | null): string | null {
  const q = (media?.poll as AnyObj | undefined)?.question as unknown;
  if (typeof q === "string") return q;
  if (q && typeof q === "object" && typeof (q as { text?: unknown }).text === "string") return (q as { text: string }).text;
  return null;
}

/** Message GramJS → post au format commun ; message de service ou vide → null. Rien n'est téléchargé. */
export function toWirePost(msg: AnyObj): WirePost | null {
  if (msg.className !== "Message" || typeof msg.id !== "number" || typeof msg.date !== "number") return null;
  const media = msg.media as AnyObj | undefined;
  const mediaKind = mediaKindOf(media);
  const raw = typeof msg.message === "string" && msg.message.trim() ? msg.message.trim() : mediaKind === "poll" ? pollQuestion(media) : null;
  const entities = (msg.entities as AnyObj[] | undefined) ?? [];
  const markup = msg.replyMarkup as AnyObj | undefined;
  const rows = markup?.className === "ReplyInlineMarkup" ? ((markup.rows as AnyObj[] | undefined) ?? []) : [];
  return {
    externalId: msg.id,
    postedAt: new Date(msg.date * 1000).toISOString(),
    text: raw ?? null,
    mediaKind,
    views: typeof msg.views === "number" ? msg.views : null,
    hasButton: rows.some((r) => ((r.buttons as unknown[] | undefined) ?? []).length > 0),
    linkCount: entities.filter((e) => e.className === "MessageEntityUrl" || e.className === "MessageEntityTextUrl").length,
  };
}

/** Lot de messages → posts ; un album compte pour un post (celui qui porte la légende, sinon le plus petit numéro). */
export function toWirePosts(messages: AnyObj[]): WirePost[] {
  const out: WirePost[] = [];
  const albums = new Map<string, { index: number; hasText: boolean }>();
  for (const m of messages) {
    const p = toWirePost(m);
    if (!p) continue;
    const group = m.groupedId === undefined || m.groupedId === null ? null : String(m.groupedId);
    if (!group) {
      out.push(p);
      continue;
    }
    const seen = albums.get(group);
    if (!seen) {
      albums.set(group, { index: out.length, hasText: Boolean(p.text) });
      out.push(p);
    } else if (!seen.hasText && p.text) {
      out[seen.index] = p;
      seen.hasText = true;
    }
  }
  return out;
}

/** Hachage d'un lien d'invitation (« t.me/+abc », « t.me/joinchat/abc ») ; nom public → null (jamais rejoint). */
export function inviteHashOf(link: string): string | null {
  return /(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)([A-Za-z0-9_-]+)/i.exec(link.trim())?.[1] ?? null;
}

// ——— Appels Telegram (injectables pour les tests) ———

export type ReaderOps = {
  isMember(client: TelegramClient, channel: WireChannel): Promise<{ member: boolean; title: string | null; chatId: string | null }>;
  history(client: TelegramClient, channel: WireChannel, limit: number, beforeId?: number): Promise<{ posts: WirePost[]; title: string | null; chatId: string | null }>;
  joinInvite(client: TelegramClient, hash: string): Promise<{ title: string | null; chatId: string | null }>;
};

async function resolveChannelEntity(client: TelegramClient, channel: WireChannel): Promise<Api.Channel> {
  // Nom public : résolu (sans rejoindre). Identifiant : seulement si le compte connaît déjà le canal.
  const target = channel.username ?? (channel.chatId ? helpers.returnBigInt(channel.chatId) : null);
  if (target === null) throw new Error("canal sans nom ni identifiant");
  const entity = await client.getEntity(target as never);
  if (!(entity instanceof Api.Channel)) throw new Error("ce n'est pas un canal");
  return entity;
}

/** Entité résolue gardée 30 minutes par compte et par canal (durée d'une lecture : 4 lots et plus). */
export const ENTITY_CACHE_MS = 30 * 60_000;
/** 5 s au moins entre la résolution du nom et le premier `GetHistory` (débit lent). */
export const RESOLVE_TO_HISTORY_GAP_MS = 5_000;

export type ResolvedEntity<T> = { entity: T; resolvedAt: number };

/**
 * Cache des entités résolues : un nom public n'est résolu (`getEntity`, donc `contacts.ResolveUsername`) qu'une fois par
 * lecture, pas à chaque lot. Clé : client (un par compte) + nom ou identifiant. Générique pour les tests.
 */
export function createEntityCache<C extends object, T>(resolve: (client: C, channel: WireChannel) => Promise<T>, opts: { now?: () => number; ttlMs?: number } = {}) {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? ENTITY_CACHE_MS;
  const byClient = new WeakMap<C, Map<string, ResolvedEntity<T>>>();
  const keyOf = (c: WireChannel) => (c.username ? `@${c.username.toLowerCase()}` : `#${c.chatId ?? ""}`);
  return {
    async get(client: C, channel: WireChannel): Promise<ResolvedEntity<T>> {
      let map = byClient.get(client);
      if (!map) byClient.set(client, (map = new Map()));
      const key = keyOf(channel);
      const hit = map.get(key);
      if (hit && now() - hit.resolvedAt < ttl) return hit;
      const fresh = { entity: await resolve(client, channel), resolvedAt: now() };
      map.set(key, fresh);
      return fresh;
    },
    forget(client: C, channel: WireChannel): void {
      byClient.get(client)?.delete(keyOf(channel));
    },
  };
}

/** Attend le reste des 5 s depuis la résolution avant un `GetHistory`. */
export async function waitAfterResolution(resolvedAt: number, now: () => number, sleep: (ms: number) => Promise<void>): Promise<void> {
  const wait = resolvedAt + RESOLVE_TO_HISTORY_GAP_MS - now();
  if (wait > 0) await sleep(Math.min(wait, RESOLVE_TO_HISTORY_GAP_MS));
}

const fullChatId = (c: Api.Channel) => `-100${c.id.toString()}`;

/** Appels GramJS réels ; `sleep` / `now` injectables. */
export function createGramjsReaderOps(opts: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): ReaderOps {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const entities = createEntityCache<TelegramClient, Api.Channel>(resolveChannelEntity, { now });
  return {
    async isMember(client, channel) {
      // Toujours relue : l'état « membre » doit être frais (le cache resservira aux lots qui suivent).
      entities.forget(client, channel);
      const { entity: c } = await entities.get(client, channel);
      return { member: !c.left, title: c.title ?? null, chatId: fullChatId(c) };
    },
    async history(client, channel, limit, beforeId) {
      const { entity: c, resolvedAt } = await entities.get(client, channel);
      if (c.left) throw new Error("le compte n'est pas membre de ce canal");
      await waitAfterResolution(resolvedAt, now, sleep);
      const res = await client.invoke(
        new Api.messages.GetHistory({
          peer: c,
          offsetId: beforeId ?? 0,
          offsetDate: 0,
          addOffset: 0,
          limit: Math.min(HISTORY_MAX_LIMIT, Math.max(1, limit)),
          maxId: 0,
          minId: 0,
          hash: helpers.returnBigInt(0),
        }),
      );
      const list =
        res instanceof Api.messages.Messages || res instanceof Api.messages.MessagesSlice || res instanceof Api.messages.ChannelMessages
          ? (res.messages as unknown as AnyObj[])
          : [];
      return { posts: toWirePosts(list), title: c.title ?? null, chatId: fullChatId(c) };
    },
    async joinInvite(client, hash) {
      const res = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
      const chat = "chats" in res ? (res.chats as unknown as AnyObj[]).find((x) => x.className === "Channel") : undefined;
      return { title: typeof chat?.title === "string" ? chat.title : null, chatId: chat?.id ? `-100${String(chat.id)}` : null };
    },
  };
}

export const gramjsReaderOps: ReaderOps = createGramjsReaderOps();

// ——— Boucle ———

/** Base utilisée par la boucle (sous-ensemble de Prisma, faux en test). */
export type MailboxDb = {
  setting: {
    findMany(args: { where: { key: { startsWith: string } } }): Promise<Array<{ key: string; value: unknown }>>;
    updateMany(args: { where: { key: string }; data: { value: Row } }): Promise<{ count: number }>;
    deleteMany(args: { where: { key: string } }): Promise<{ count: number }>;
    upsert(args: { where: { key: string }; create: { key: string; value: unknown }; update: { value: unknown } }): Promise<unknown>;
  };
  telegramUserAccount: {
    findUnique(args: { where: { id: string }; select: { personaId: true; botId: true; isActive: true; status: true } }): Promise<{
      personaId: string | null;
      botId: string | null;
      isActive: boolean;
      status: string;
    } | null>;
  };
};

export type MailboxDeps = {
  db: MailboxDb;
  /** Comptes connectés ici (relus à chaque tour). */
  accounts: () => Map<string, { client: TelegramClient }>;
  ops?: ReaderOps;
  now?: () => Date;
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Traite une demande (fonction testée sur faux Telegram). */
export async function handleRequest(deps: MailboxDeps, req: UserbotRequest, lastHistoryAt: Map<string, number>): Promise<UserbotResponse | "later"> {
  const ops = deps.ops ?? gramjsReaderOps;
  const now = (deps.now ?? (() => new Date()))().getTime();
  const live = deps.accounts().get(req.accountId);
  if (!live) return { ok: false, error: "compte non connecté au service des comptes réels" };
  const acc = await deps.db.telegramUserAccount.findUnique({ where: { id: req.accountId }, select: { personaId: true, botId: true, isActive: true, status: true } });
  if (!acc || !acc.isActive || acc.status !== "ACTIVE") return { ok: false, error: "compte inactif" };
  // Règle de la phase 18 : un compte qui porte une persona ou un bot fantôme converse, il ne lit jamais.
  if (acc.personaId || acc.botId) return { ok: false, error: "compte occupé par des conversations" };
  try {
    if (req.kind === "is-member") {
      const r = await ops.isMember(live.client, req.channel);
      return { ok: true, member: r.member, title: r.title, chatId: r.chatId };
    }
    if (req.kind === "history") {
      const last = lastHistoryAt.get(req.accountId) ?? 0;
      if (now - last < HISTORY_MIN_GAP_MS) return "later";
      lastHistoryAt.set(req.accountId, now);
      const r = await ops.history(live.client, req.channel, Math.min(HISTORY_MAX_LIMIT, req.limit), req.beforeId);
      return { ok: true, posts: r.posts, title: r.title, chatId: r.chatId };
    }
    const hash = inviteHashOf(req.inviteLink);
    if (!hash) return { ok: false, error: "ce n'est pas un lien d'invitation" };
    const r = await ops.joinInvite(live.client, hash);
    return { ok: true, title: r.title, chatId: r.chatId };
  } catch (err) {
    const wait = floodWaitSecondsOf(err);
    if (wait !== null) return { ok: false, floodWaitSeconds: wait };
    return { ok: false, error: errorText(err) };
  }
}

/** Un tour de boucle : signal de vie, demandes abandonnées effacées, puis UNE demande traitée (la plus ancienne). */
export async function mailboxTick(deps: MailboxDeps, state: { lastHistoryAt: Map<string, number>; lastBeatAt: number }): Promise<"none" | "done" | "later"> {
  const now = (deps.now ?? (() => new Date()))();
  if (now.getTime() - state.lastBeatAt >= HEARTBEAT_EVERY_MS) {
    const value = { at: now.toISOString() };
    await deps.db.setting.upsert({ where: { key: USERBOT_HEARTBEAT_KEY }, create: { key: USERBOT_HEARTBEAT_KEY, value }, update: { value } });
    state.lastBeatAt = now.getTime();
  }
  const rows = await deps.db.setting.findMany({ where: { key: { startsWith: USERBOT_REQUEST_PREFIX } } });
  const pending: Array<{ key: string; row: Row }> = [];
  for (const r of rows) {
    const row = r.value as Row | null;
    const created = Date.parse(String(row?.createdAt ?? ""));
    if (!row || !Number.isFinite(created) || now.getTime() - created > STALE_REQUEST_MS) {
      await deps.db.setting.deleteMany({ where: { key: r.key } });
      continue;
    }
    if (row.status === "PENDING") pending.push({ key: r.key, row });
  }
  pending.sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt));
  for (const { key, row } of pending) {
    const res = await handleRequest(deps, row, state.lastHistoryAt);
    if (res === "later") continue;
    await deps.db.setting.updateMany({ where: { key }, data: { value: { ...row, status: "DONE", response: res } } });
    logger.info({ demande: row.kind, ok: res.ok }, "lecture de canal de reference");
    return "done";
  }
  return pending.length ? "later" : "none";
}

/** Démarre la boucle ; rend une fonction d'arrêt. */
export function startReferenceHistoryLoop(deps: MailboxDeps): () => void {
  const state = { lastHistoryAt: new Map<string, number>(), lastBeatAt: 0 };
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await mailboxTick(deps, state);
    } catch (err) {
      logger.error({ err: errorText(err) }, "boucle de lecture des canaux de reference");
    } finally {
      busy = false;
    }
  };
  const handle = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  return () => clearInterval(handle);
}
