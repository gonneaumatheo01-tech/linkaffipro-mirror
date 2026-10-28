/**
 * Boîte aux lettres du worker, traitée PAR la session déjà tenue ici : le worker ne se connecte jamais aux comptes
 * réels (une seconde connexion ferait révoquer la session). Même voie que les DM de bienvenue : le worker dépose une
 * demande en base (`Setting` `userbot.request.<id>`), cette boucle la traite et écrit la réponse dans la même ligne.
 * Protocole : copie structurelle de `packages/agents/src/channel-reader/userbot-mailbox.ts`.
 *
 * Seule demande : la recherche de canaux de la prospection (phase 32, `./prospect-search`), lecture seule.
 * Garde-fous :
 * - jamais un compte qui converse (persona ou bot fantôme), jamais un compte non connecté ici ;
 * - FLOOD_WAIT jamais attendu ici : renvoyé au worker, qui attend ou arrête ;
 * - une demande à la fois, boucle à part (les conversations des comptes ne passent pas par ici).
 */
import type { TelegramClient } from "telegram";
import { logger } from "./logger";
import { handleProspectSearch, newProspectSearchState, PROSPECT_SEARCH_KIND, type ProspectSearchOps, type ProspectSearchRequest, type ProspectSearchResponse, type ProspectSearchState } from "./prospect-search";

export const USERBOT_REQUEST_PREFIX = "userbot.request.";
export const USERBOT_HEARTBEAT_KEY = "userbot.mailbox.heartbeat";
const INTERVAL_MS = 2_000;
const HEARTBEAT_EVERY_MS = 20_000;
/** Demande plus vieille que 15 minutes : abandonnée (le worker n'attend plus). */
export const STALE_REQUEST_MS = 15 * 60_000;

export type UserbotRequest = ProspectSearchRequest;
export type UserbotResponse = { ok: false; error: string } | ProspectSearchResponse;
type Row = UserbotRequest & { status: "PENDING" | "WORKING" | "DONE"; createdAt: string; response?: UserbotResponse };

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
  /** Appels de la recherche de prospection (faux en test). */
  searchOps?: ProspectSearchOps;
  now?: () => Date;
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Traite une demande (fonction testée sur faux Telegram). */
export async function handleRequest(
  deps: MailboxDeps,
  req: UserbotRequest,
  searchState: ProspectSearchState = newProspectSearchState(),
): Promise<UserbotResponse | "later"> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const live = deps.accounts().get(req.accountId);
  if (!live) return { ok: false, error: "compte non connecté au service des comptes réels" };
  const acc = await deps.db.telegramUserAccount.findUnique({ where: { id: req.accountId }, select: { personaId: true, botId: true, isActive: true, status: true } });
  if (!acc || !acc.isActive || acc.status !== "ACTIVE") return { ok: false, error: "compte inactif" };
  // Règle de la phase 18 : un compte qui porte une persona ou un bot fantôme converse, il ne lit jamais.
  if (acc.personaId || acc.botId) return { ok: false, error: "compte occupé par des conversations" };
  if (req.kind !== PROSPECT_SEARCH_KIND) return { ok: false, error: "demande inconnue" };
  return handleProspectSearch(live.client, req, searchState, { ...(deps.searchOps ? { ops: deps.searchOps } : {}), now });
}

/** Un tour de boucle : signal de vie, demandes abandonnées effacées, puis UNE demande traitée (la plus ancienne). */
export async function mailboxTick(deps: MailboxDeps, state: { lastBeatAt: number; search?: ProspectSearchState }): Promise<"none" | "done" | "later"> {
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
    const res = await handleRequest(deps, row, (state.search ??= newProspectSearchState()));
    if (res === "later") continue;
    await deps.db.setting.updateMany({ where: { key }, data: { value: { ...row, status: "DONE", response: res } } });
    logger.info({ demande: row.kind, ok: res.ok }, "demande du worker traitee");
    return "done";
  }
  return pending.length ? "later" : "none";
}

/** Démarre la boucle ; rend une fonction d'arrêt. */
export function startMailboxLoop(deps: MailboxDeps): () => void {
  const state = { lastBeatAt: 0, search: newProspectSearchState() };
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await mailboxTick(deps, state);
    } catch (err) {
      logger.error({ err: errorText(err) }, "boucle des demandes du worker");
    } finally {
      busy = false;
    }
  };
  const handle = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  return () => clearInterval(handle);
}
