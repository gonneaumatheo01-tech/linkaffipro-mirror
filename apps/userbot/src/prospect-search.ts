/**
 * Phase 32 (chantier C) — recherche de canaux pour la prospection PAR la session déjà tenue ici, en LECTURE SEULE.
 * Même boîte aux lettres que la lecture des canaux de référence (`Setting userbot.request.<id>`, voir
 * `./reference-history`), demande `kind = "prospect-search"`. Protocole : copie structurelle de
 * `packages/agents/src/prospection/discover/sources/account-search.ts` (le userbot ne dépend pas de ce paquet).
 *
 * Deux opérations, UN appel Telegram chacune :
 * - `search` : recherche globale par mots-clés (`contacts.Search`), canaux publics seulement (nom public, diffusion) ;
 * - `profile` : fiche publique d'un canal trouvé (`channels.GetFullChannel` : abonnés, description, groupe lié), par
 *   l'identifiant et la clé d'accès rendus par la recherche (sans résolution de nom, donc sans second appel).
 *
 * Garde-fous (règle 5 de la phase 32) : aucune adhésion, aucun message, aucune invitation ouverte, aucun membre lu,
 * aucun média ; jamais un compte qui converse (vérifié par l'appelant `handleRequest`) ; 5 s au moins entre deux
 * demandes d'un même compte et 100 par jour (le worker tient aussi ces compteurs) ; FLOOD_WAIT jamais attendu ici
 * (renvoyé au worker, qui coupe la source) ; avertissement de Telegram (compte limité, gelé, signalé) renvoyé tel quel
 * pour que la source se coupe d'elle-même. Journaux sans mots-clés ni nom de canal.
 */
import { floodWaitSecondsOf, rpcCodeOf } from "@linkaffipro/mtproto";
import { Api, helpers, type TelegramClient } from "telegram";

export const PROSPECT_SEARCH_KIND = "prospect-search";
/** 5 s au moins entre deux demandes d'un même compte. */
export const PROSPECT_SEARCH_MIN_GAP_MS = 5_000;
/** 100 demandes par jour et par compte au plus (seconde barrière : le worker compte aussi). */
export const PROSPECT_SEARCH_PER_ACCOUNT_PER_DAY = 100;
/** Résultats d'une recherche : 20 au plus. */
export const PROSPECT_SEARCH_MAX_RESULTS = 20;

export type WireFoundChannel = { id: string; accessHash: string | null; username: string; title: string | null; subscribers: number | null };
export type WireProfile = {
  id: string;
  username: string | null;
  title: string | null;
  subscribers: number | null;
  about: string | null;
  linkedChat: { username: string | null; title: string | null } | null;
};
export type ProspectSearchRequest =
  | { kind: "prospect-search"; accountId: string; op: "search"; query: string; limit: number }
  | { kind: "prospect-search"; accountId: string; op: "profile"; channel: { id: string; accessHash: string | null; username: string | null } };
export type ProspectSearchResponse =
  | { ok: true; calls: number; channels?: WireFoundChannel[]; profile?: WireProfile }
  | { ok: false; error: string }
  | { ok: false; floodWaitSeconds: number }
  | { ok: false; warning: string };

/** Erreurs de Telegram qui avertissent le compte : la source se coupe au premier (règle 5). */
const WARNING_CODES = /PEER_FLOOD|USER_RESTRICTED|ACCOUNT_RESTRICTED|FROZEN|USER_DEACTIVATED|USER_BANNED|PHONE_NUMBER_BANNED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SPAM/;

/** Code d'avertissement de Telegram dans une erreur, ou null (pur). */
export function telegramWarningOf(err: unknown): string | null {
  const code = rpcCodeOf(err) ?? String((err as { errorMessage?: unknown; message?: unknown })?.errorMessage ?? (err as Error)?.message ?? "");
  const m = WARNING_CODES.exec(code);
  return m ? code.slice(0, 80) : null;
}

// ——— Conversion (règles pures, sur `className`) ———

type AnyObj = { className?: string; [k: string]: unknown };
const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Chats d'un résultat de recherche → canaux PUBLICS de diffusion (nom public), sans doublon, 20 au plus. */
export function toFoundChannels(chats: AnyObj[]): WireFoundChannel[] {
  const out: WireFoundChannel[] = [];
  const seen = new Set<string>();
  for (const c of chats) {
    if (c.className !== "Channel" || c.broadcast !== true) continue;
    const username = typeof c.username === "string" && c.username ? c.username : null;
    const id = str(c.id);
    if (!username || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, accessHash: str(c.accessHash), username, title: typeof c.title === "string" ? c.title : null, subscribers: num(c.participantsCount) });
    if (out.length >= PROSPECT_SEARCH_MAX_RESULTS) break;
  }
  return out;
}

/** `messages.ChatFull` → fiche publique (abonnés, description, groupe lié). */
export function toProfile(res: AnyObj, fallback: { id: string; username: string | null }): WireProfile {
  const full = (res.fullChat ?? {}) as AnyObj;
  const chats = ((res.chats as AnyObj[] | undefined) ?? []).filter((c) => c.className === "Channel");
  const self = chats.find((c) => str(c.id) === fallback.id) ?? chats.find((c) => c.broadcast === true) ?? null;
  const linkedId = str(full.linkedChatId);
  const linked = linkedId ? (chats.find((c) => str(c.id) === linkedId) ?? null) : null;
  return {
    id: fallback.id,
    username: (typeof self?.username === "string" && self.username) || fallback.username,
    title: typeof self?.title === "string" ? self.title : null,
    subscribers: num(full.participantsCount) ?? num(self?.participantsCount),
    about: typeof full.about === "string" && full.about.trim() ? full.about.trim().slice(0, 500) : null,
    linkedChat: linked ? { username: typeof linked.username === "string" && linked.username ? linked.username : null, title: typeof linked.title === "string" ? linked.title : null } : null,
  };
}

// ——— Appels Telegram (injectables pour les tests) ———

/** Le client tel que vu par ce chemin : seulement `invoke` (aucune autre méthode du client n'est appelée). */
export type SearchClient = Pick<TelegramClient, "invoke">;

export type ProspectSearchOps = {
  search(client: SearchClient, query: string, limit: number): Promise<WireFoundChannel[]>;
  profile(client: SearchClient, channel: { id: string; accessHash: string | null; username: string | null }): Promise<WireProfile>;
};

/**
 * Les SEULES requêtes Telegram permises sur ce chemin (test adverse) : la recherche et la fiche d'un canal. Aucune
 * méthode d'adhésion, d'envoi ou d'invitation n'est construite ici.
 */
export const PROSPECT_SEARCH_ALLOWED_REQUESTS = ["contacts.Search", "channels.GetFullChannel"] as const;

export const gramjsProspectSearchOps: ProspectSearchOps = {
  async search(client, query, limit) {
    const res = (await client.invoke(new Api.contacts.Search({ q: query.slice(0, 64), limit: Math.min(PROSPECT_SEARCH_MAX_RESULTS, Math.max(1, limit)) }))) as unknown as AnyObj;
    return toFoundChannels((res.chats as AnyObj[] | undefined) ?? []);
  },
  async profile(client, channel) {
    if (!channel.accessHash) throw new Error("clé d'accès absente : canal à rechercher d'abord");
    const input = new Api.InputChannel({ channelId: helpers.returnBigInt(channel.id), accessHash: helpers.returnBigInt(channel.accessHash) });
    const res = (await client.invoke(new Api.channels.GetFullChannel({ channel: input }))) as unknown as AnyObj;
    return toProfile(res, { id: channel.id, username: channel.username });
  },
};

/** État par compte : dernière demande (5 s) et compte du jour (100). */
export type ProspectSearchState = { lastAt: Map<string, number>; perDay: Map<string, { day: string; n: number }> };
export const newProspectSearchState = (): ProspectSearchState => ({ lastAt: new Map(), perDay: new Map() });

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/**
 * Traite une demande `prospect-search` sur la session d'un compte déjà vérifié par l'appelant (actif, connecté ici,
 * sans persona ni bot fantôme). « later » : moins de 5 s depuis la précédente demande de ce compte.
 */
export async function handleProspectSearch(
  client: SearchClient,
  req: ProspectSearchRequest,
  state: ProspectSearchState,
  opts: { ops?: ProspectSearchOps; now: number },
): Promise<ProspectSearchResponse | "later"> {
  const ops = opts.ops ?? gramjsProspectSearchOps;
  const last = state.lastAt.get(req.accountId) ?? 0;
  if (opts.now - last < PROSPECT_SEARCH_MIN_GAP_MS) return "later";
  const day = new Date(opts.now).toISOString().slice(0, 10);
  const count = state.perDay.get(req.accountId);
  const used = count && count.day === day ? count.n : 0;
  if (used >= PROSPECT_SEARCH_PER_ACCOUNT_PER_DAY) return { ok: false, error: "plafond du jour atteint pour ce compte (100 demandes)" };
  state.lastAt.set(req.accountId, opts.now);
  state.perDay.set(req.accountId, { day, n: used + 1 });
  try {
    if (req.op === "search") {
      const query = req.query.trim();
      if (!query) return { ok: false, error: "recherche vide" };
      return { ok: true, calls: 1, channels: await ops.search(client, query, req.limit) };
    }
    if (req.op === "profile") return { ok: true, calls: 1, profile: await ops.profile(client, req.channel) };
    return { ok: false, error: "opération inconnue" };
  } catch (err) {
    const wait = floodWaitSecondsOf(err);
    if (wait !== null) return { ok: false, floodWaitSeconds: wait };
    const warning = telegramWarningOf(err);
    if (warning) return { ok: false, warning };
    return { ok: false, error: errorText(err) };
  }
}
