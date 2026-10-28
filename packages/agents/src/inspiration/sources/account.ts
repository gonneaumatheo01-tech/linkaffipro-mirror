/**
 * Phase 27 (chantier A, lecture) — lecture d'un canal par un compte réel de la phase 18 DÉJÀ MEMBRE (règle 2) :
 * historique par lots de 50, un lot toutes les 5 secondes, 200 posts au plus, `FLOOD_WAIT` respecté (au-delà de
 * 5 minutes : arrêt propre avec ce qui est lu). Aucune fonction ici ne rejoint un canal de soi-même : seule
 * `joinWithInviteOnce` (une tentative, débit lent) existe, appelée par Kevin APRÈS le CONFIRM du client, avec un lien
 * d'invitation fourni par le client. Jamais un compte qui converse.
 *
 * Lecteur réel (`prismaAccountHistoryReader`) : les sessions des comptes réels sont tenues EN PERMANENCE par le service
 * `apps/userbot` (une connexion GramJS persistante par compte actif). Ouvrir la même session depuis le worker ferait
 * deux connexions simultanées (`AUTH_KEY_DUPLICATED` : session révoquée, risque de bannissement) : le worker ne se
 * connecte JAMAIS. Le transport passe par le userbot (`./userbot-mailbox`, `createDefaultAccountReader`) ; sans lui
 * (userbot arrêté ou ancien), le lecteur réel se déclare indisponible et Kevin demande des posts transférés.
 */
import type { AgentsPrisma } from "../../types";
import { INSPIRATION_LIMITS, type AccountHistoryReader, type ReferencePostInput, type ReferenceReadResult } from "../contract";
import { isInviteLink } from "./web-preview";

export type AccountChannelRef = { username: string | null; chatId: bigint | null };

export type AccountReadOptions = {
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  maxPosts?: number;
  maxAgeDays?: number;
  /** Relecture : s'arrête aux posts déjà connus. */
  sinceId?: number;
  /** Compte imposé (doit être dans la liste des comptes membres libres). */
  accountId?: string;
  /** Appelée après chaque lot (renouvellement du verrou de lecture). */
  onBatch?: () => Promise<void>;
};

export type AccountReadResult = ReferenceReadResult & {
  accountId?: string;
  /** Lecture arrêtée par Telegram (attente trop longue) : posts déjà lus rendus. */
  partial?: "rate_limited";
  batches?: number;
};

/** Attente FLOOD_WAIT acceptée au plus (au-delà : arrêt propre). */
export const ACCOUNT_MAX_FLOOD_WAIT_S = 5 * 60;
/** Nouvelles tentatives d'un même lot après un FLOOD_WAIT. */
const MAX_FLOOD_RETRIES = 3;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const nameOf = (c: AccountChannelRef) => (c.username ? `@${c.username}` : "ce canal");

/** Lit l'historique d'un canal par un compte réel membre et libre (posts du plus récent au plus ancien). */
export async function readWithAccount(reader: AccountHistoryReader, channel: AccountChannelRef, opts: AccountReadOptions = {}): Promise<AccountReadResult> {
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? defaultSleep;
  const maxPosts = Math.min(opts.maxPosts ?? INSPIRATION_LIMITS.maxPostsPerRead, INSPIRATION_LIMITS.maxPostsPerRead);
  const oldest = now.getTime() - Math.min(opts.maxAgeDays ?? INSPIRATION_LIMITS.maxAgeDays, INSPIRATION_LIMITS.maxAgeDays) * 86_400_000;

  let accounts: string[];
  try {
    accounts = await reader.memberAccounts(channel);
  } catch (err) {
    return { ok: false, reason: "error", message: `Comptes réels illisibles pour l'instant (${String((err as Error)?.message ?? err).slice(0, 80)}).` };
  }
  const accountId = opts.accountId ? accounts.find((a) => a === opts.accountId) : accounts[0];
  if (!accountId)
    return {
      ok: false,
      reason: "no_account",
      message: `Aucun de nos comptes réels libres n'est membre de ${nameOf(channel)} : transfère-moi 10 à 30 de ses posts.`,
    };

  const byId = new Map<number, ReferencePostInput>();
  let title: string | null = null;
  let chatId: bigint | null = channel.chatId;
  let beforeId: number | undefined;
  let batches = 0;
  let partial: "rate_limited" | undefined;
  let done = false;
  while (!done && byId.size < maxPosts) {
    if (batches > 0) await sleep(INSPIRATION_LIMITS.accountDelayMs);
    const limit = Math.min(INSPIRATION_LIMITS.accountBatch, maxPosts - byId.size);
    let res: Awaited<ReturnType<AccountHistoryReader["history"]>> | null = null;
    for (let attempt = 0; attempt <= MAX_FLOOD_RETRIES; attempt++) {
      try {
        res = await reader.history(accountId, channel, { limit, ...(beforeId !== undefined ? { beforeId } : {}) });
      } catch (err) {
        if (batches === 0 && byId.size === 0)
          return { ok: false, reason: "error", message: `Lecture de ${nameOf(channel)} impossible (${String((err as Error)?.message ?? err).slice(0, 80)}).` };
        res = null;
        done = true;
        break;
      }
      if (!("floodWaitSeconds" in res)) break;
      const wait = Math.max(1, Math.ceil(res.floodWaitSeconds));
      if (wait > ACCOUNT_MAX_FLOOD_WAIT_S || attempt === MAX_FLOOD_RETRIES) {
        partial = "rate_limited";
        res = null;
        done = true;
        break;
      }
      await sleep(wait * 1000);
      res = null;
    }
    batches++;
    await opts.onBatch?.();
    if (!res || "floodWaitSeconds" in res) break;
    title ??= res.title;
    chatId ??= res.chatId;
    const sorted = [...res.posts].sort((a, b) => b.externalId - a.externalId);
    if (!sorted.length) break;
    let progressed = false;
    for (const p of sorted) {
      if (beforeId !== undefined && p.externalId >= beforeId) continue;
      if ((opts.sinceId !== undefined && p.externalId <= opts.sinceId) || p.postedAt.getTime() < oldest) {
        done = true;
        break;
      }
      if (!byId.has(p.externalId)) byId.set(p.externalId, p);
      progressed = true;
      if (byId.size >= maxPosts) break;
    }
    if (!progressed) break;
    beforeId = sorted[sorted.length - 1]!.externalId;
    if (beforeId <= 1 || sorted.length < limit) break;
  }
  const posts = [...byId.values()].sort((a, b) => b.externalId - a.externalId);
  if (partial && posts.length === 0)
    return { ok: false, reason: "rate_limited", message: `Telegram limite la lecture de ${nameOf(channel)} pour l'instant : je réessaierai plus tard.` };
  return { ok: true, title, username: channel.username, chatId, posts, accountId, batches, ...(partial ? { partial } : {}) };
}

/** Lecteur capable aussi de rejoindre par un lien d'invitation (CONFIRM du client exigé, voir `joinWithInviteOnce`). */
export type AccountJoinReader = AccountHistoryReader & {
  joinWithInvite?(
    accountId: string,
    inviteLink: string,
  ): Promise<{ ok: true; chatId: bigint | null; title: string | null } | { ok: false; message: string } | { floodWaitSeconds: number }>;
};

export type JoinOnceResult =
  | { ok: true; chatId: bigint | null; title: string | null }
  | { ok: false; reason: "invalid_link" | "unavailable" | "rate_limited" | "refused"; message: string };

/**
 * Une seule tentative d'entrée par un lien d'invitation fourni par le client, APRÈS son CONFIRM (Kevin, chantier C) :
 * débit lent (5 s d'attente avant l'appel), aucune nouvelle tentative (FLOOD_WAIT compris), jamais un nom public
 * (seuls les liens d'invitation « t.me/+… » sont acceptés). Ne vérifie pas le CONFIRM : c'est à l'appelant de le faire.
 */
export async function joinWithInviteOnce(
  reader: AccountJoinReader,
  accountId: string,
  inviteLink: string,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<JoinOnceResult> {
  if (!isInviteLink(inviteLink)) return { ok: false, reason: "invalid_link", message: "Ce n'est pas un lien d'invitation Telegram (t.me/+…)." };
  if (!reader.joinWithInvite) return { ok: false, reason: "unavailable", message: ACCOUNT_READER_UNAVAILABLE };
  await (opts.sleep ?? defaultSleep)(INSPIRATION_LIMITS.accountDelayMs);
  try {
    const res = await reader.joinWithInvite(accountId, inviteLink.trim());
    if ("floodWaitSeconds" in res)
      return { ok: false, reason: "rate_limited", message: `Telegram demande d'attendre ${Math.ceil(res.floodWaitSeconds)} s : je n'insiste pas.` };
    if (!res.ok) return { ok: false, reason: "refused", message: res.message.slice(0, 200) };
    return res;
  } catch (err) {
    return { ok: false, reason: "refused", message: `Entrée refusée (${String((err as Error)?.message ?? err).slice(0, 120)}).` };
  }
}

/** Raison affichée quand la lecture par compte réel n'a pas de transport sûr (service des comptes arrêté). */
export const ACCOUNT_READER_UNAVAILABLE =
  "La lecture par compte réel est indisponible pour l'instant : le service des comptes réels ne répond pas, et je ne me connecte jamais à leur place. Transfère-moi plutôt 10 à 30 posts.";

/**
 * Transport sûr vers les sessions des comptes réels (par le service `apps/userbot`, seul détenteur des sessions,
 * voir `./userbot-mailbox`). Absent : le lecteur réel est indisponible.
 */
export type AccountHistoryTransport = {
  isMember(accountId: string, channel: AccountChannelRef): Promise<boolean>;
  history: AccountHistoryReader["history"];
  joinWithInvite?: AccountJoinReader["joinWithInvite"];
};

/** Un compte qui a écrit en privé (DM de bienvenue, phase 18) depuis 7 jours converse : il ne lit pas. */
export const ACCOUNT_CONVERSING_DAYS = 7;

/**
 * Comptes réels libres : actifs et connectés (`isActive`, `ACTIVE`), sans bot fantôme,
 * et sans DM envoyé ou prévu depuis 7 jours.
 * Les comptes avec persona sont autorisés pour la lecture d'inspiration (risque de blocage accepté par le client).
 */
export async function freeReaderAccounts(prisma: AgentsPrisma, now = new Date()): Promise<string[]> {
  const accounts = await prisma.telegramUserAccount.findMany({
    where: { isActive: true, status: "ACTIVE", botId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!accounts.length) return [];
  const since = new Date(now.getTime() - ACCOUNT_CONVERSING_DAYS * 86_400_000);
  const busy = await prisma.accountDm.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) }, OR: [{ status: "PENDING" }, { createdAt: { gte: since } }] },
    select: { accountId: true },
  });
  const busyIds = new Set(busy.map((b) => b.accountId));
  return accounts.map((a) => a.id).filter((id) => !busyIds.has(id));
}

/**
 * Lecteur réel : comptes libres (`freeReaderAccounts`) qui voient le canal (vérifié par le transport). Sans transport,
 * `available` est faux et aucun compte n'est proposé (voir l'en-tête du fichier).
 */
export function prismaAccountHistoryReader(
  prisma: AgentsPrisma,
  opts: { transport?: AccountHistoryTransport | null; now?: () => Date } = {},
): AccountJoinReader & { available: boolean; unavailableReason: string | null } {
  const transport = opts.transport ?? null;
  return {
    available: transport !== null,
    unavailableReason: transport ? null : ACCOUNT_READER_UNAVAILABLE,
    async memberAccounts(channel) {
      if (!transport) return [];
      const free = await freeReaderAccounts(prisma, opts.now?.() ?? new Date());
      const out: string[] = [];
      for (const id of free) if (await transport.isMember(id, channel).catch(() => false)) out.push(id);
      return out;
    },
    async history(accountId, channel, o) {
      if (!transport) throw new Error(ACCOUNT_READER_UNAVAILABLE);
      return transport.history(accountId, channel, o);
    },
    ...(transport?.joinWithInvite ? { joinWithInvite: transport.joinWithInvite } : {}),
  };
}
