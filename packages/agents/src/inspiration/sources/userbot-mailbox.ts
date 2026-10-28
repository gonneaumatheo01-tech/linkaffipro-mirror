/**
 * Phase 27 (chantier A) — lecture par compte réel PAR le service `apps/userbot`, seul détenteur des sessions (jamais
 * une seconde connexion). Même voie que les DM de bienvenue de la phase 18 : une demande déposée en base, relevée par
 * la boucle du userbot, traitée sur SA session, réponse écrite dans la même ligne. Aucune table nouvelle : lignes
 * `Setting` `userbot.request.<id>` (supprimées par le demandeur après lecture, par le userbot après 15 minutes).
 *
 * Demandes : `is-member` (le compte voit-il le canal, sans le rejoindre), `history` (un lot de 50 au plus, avant un
 * numéro), `join-invite` (une tentative, déposée seulement après le CONFIRM du client). Le userbot répond `ok`, `error`
 * ou `floodWaitSeconds` (il n'attend jamais lui-même : le rythme de 5 s entre deux lots et les attentes FLOOD_WAIT sont
 * tenus par `readWithAccount`). Réponse absente après le délai → `rate_limited` / erreur, jamais d'autre essai ici.
 *
 * Disponible seulement si le userbot a signalé sa boucle depuis moins d'une minute (`userbot.mailbox.heartbeat`) : un
 * userbot ancien ou arrêté ne laisse aucune demande attendre 5 minutes. Copie structurelle du protocole dans
 * `apps/userbot/src/reference-history.ts` (le userbot ne dépend pas de ce paquet).
 */
import { randomUUID } from "node:crypto";
import type { AgentsPrisma } from "../../types";
import type { ReferenceMediaKind, ReferencePostInput } from "../contract";
import { prismaAccountHistoryReader, type AccountChannelRef, type AccountHistoryTransport } from "./account";

export const USERBOT_REQUEST_PREFIX = "userbot.request.";
export const USERBOT_HEARTBEAT_KEY = "userbot.mailbox.heartbeat";
/** Boucle du userbot vue depuis moins d'une minute : la voie est ouverte. */
export const USERBOT_HEARTBEAT_MAX_AGE_MS = 60_000;
/** Délai de réponse d'un lot d'historique (5 minutes, sinon `rate_limited`). */
export const USERBOT_HISTORY_TIMEOUT_MS = 5 * 60_000;
/** Délai de réponse des autres demandes. */
export const USERBOT_SHORT_TIMEOUT_MS = 90_000;
const POLL_MS = 1_000;

type WireChannel = { username: string | null; chatId: string | null };
type WirePost = { externalId: number; postedAt: string; text: string | null; mediaKind: ReferenceMediaKind; views: number | null; hasButton: boolean; linkCount: number };

export type UserbotRequest =
  | { kind: "is-member"; accountId: string; channel: WireChannel }
  | { kind: "history"; accountId: string; channel: WireChannel; limit: number; beforeId?: number }
  | { kind: "join-invite"; accountId: string; inviteLink: string };

export type UserbotResponse =
  | { ok: true; member?: boolean; posts?: WirePost[]; title?: string | null; chatId?: string | null }
  | { ok: false; error: string }
  | { ok: false; floodWaitSeconds: number };

export type UserbotRow = UserbotRequest & { status: "PENDING" | "WORKING" | "DONE"; createdAt: string; response?: UserbotResponse };

export class UserbotTimeout extends Error {
  constructor() {
    super("Le service des comptes réels n'a pas répondu à temps.");
    this.name = "UserbotTimeout";
  }
}

const wireChannel = (c: AccountChannelRef): WireChannel => ({ username: c.username, chatId: c.chatId === null ? null : c.chatId.toString() });

const fromWire = (p: WirePost): ReferencePostInput => ({ ...p, postedAt: new Date(p.postedAt) });

/** La boucle du userbot est-elle vivante (signal de moins d'une minute) ? */
export async function userbotMailboxAlive(prisma: AgentsPrisma, now = new Date()): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: USERBOT_HEARTBEAT_KEY } });
  const at = Date.parse(String((row?.value as { at?: unknown } | null)?.at ?? ""));
  return Number.isFinite(at) && now.getTime() - at < USERBOT_HEARTBEAT_MAX_AGE_MS;
}

/**
 * Dépose une demande, attend la réponse (relue chaque seconde), puis efface la ligne. Générique : la phase 32 y passe
 * aussi ses demandes `prospect-search` (protocole dans `prospection/discover/sources/account-search.ts`).
 */
export async function askUserbot<Req extends { kind: string; accountId?: string } = UserbotRequest, Res = UserbotResponse>(
  prisma: AgentsPrisma,
  request: Req,
  opts: { timeoutMs: number; sleep?: (ms: number) => Promise<void>; now?: () => Date },
): Promise<Res> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => new Date());
  const key = `${USERBOT_REQUEST_PREFIX}${randomUUID()}`;
  const row = { ...request, status: "PENDING" as const, createdAt: now().toISOString() };
  await prisma.setting.create({ data: { key, value: row as never } });
  const start = now().getTime();
  try {
    for (;;) {
      const cur = await prisma.setting.findUnique({ where: { key } });
      const v = cur?.value as { status?: string; response?: Res } | undefined;
      if (v?.status === "DONE" && v.response) return v.response;
      if (now().getTime() - start >= opts.timeoutMs) throw new UserbotTimeout();
      await sleep(POLL_MS);
    }
  } finally {
    await prisma.setting.deleteMany({ where: { key } });
  }
}

/**
 * Transport vers les sessions du userbot. Indisponible (null) si sa boucle ne s'est pas signalée depuis une minute.
 * `sleep` / `now` injectables (tests : faux userbot qui répond dans la base en mémoire).
 */
export async function createUserbotHistoryTransport(
  prisma: AgentsPrisma,
  opts: { sleep?: (ms: number) => Promise<void>; now?: () => Date } = {},
): Promise<AccountHistoryTransport | null> {
  if (!(await userbotMailboxAlive(prisma, opts.now?.() ?? new Date()))) return null;
  const ask = (req: UserbotRequest, timeoutMs: number) => askUserbot(prisma, req, { timeoutMs, ...opts });
  return {
    async isMember(accountId, channel) {
      const r = await ask({ kind: "is-member", accountId, channel: wireChannel(channel) }, USERBOT_SHORT_TIMEOUT_MS);
      return r.ok === true && r.member === true;
    },
    async history(accountId, channel, o) {
      let r: UserbotResponse;
      try {
        r = await ask(
          { kind: "history", accountId, channel: wireChannel(channel), limit: Math.min(50, o.limit), ...(o.beforeId !== undefined ? { beforeId: o.beforeId } : {}) },
          USERBOT_HISTORY_TIMEOUT_MS,
        );
      } catch (err) {
        // Pas de réponse en 5 minutes : traité comme une limite de Telegram (arrêt propre avec ce qui est lu).
        if (err instanceof UserbotTimeout) return { floodWaitSeconds: Number.MAX_SAFE_INTEGER };
        throw err;
      }
      if (!r.ok) {
        if ("floodWaitSeconds" in r) return { floodWaitSeconds: r.floodWaitSeconds };
        throw new Error(r.error);
      }
      return { posts: (r.posts ?? []).map(fromWire), title: r.title ?? null, chatId: r.chatId ? BigInt(r.chatId) : null };
    },
    async joinWithInvite(accountId, inviteLink) {
      let r: UserbotResponse;
      try {
        r = await ask({ kind: "join-invite", accountId, inviteLink }, USERBOT_SHORT_TIMEOUT_MS);
      } catch (err) {
        if (err instanceof UserbotTimeout) return { ok: false, message: err.message };
        throw err;
      }
      if (!r.ok) return "floodWaitSeconds" in r ? { floodWaitSeconds: r.floodWaitSeconds } : { ok: false, message: r.error };
      return { ok: true, chatId: r.chatId ? BigInt(r.chatId) : null, title: r.title ?? null };
    },
  };
}

/**
 * Lecteur réel par défaut (worker, Kevin) : comptes libres membres du canal, lus par le userbot. Sans boucle du userbot
 * vivante : indisponible (aucun compte proposé, `joinWithInvite` absent).
 */
export async function createDefaultAccountReader(prisma: AgentsPrisma, opts: { now?: () => Date } = {}) {
  const transport = await createUserbotHistoryTransport(prisma, opts);
  return prismaAccountHistoryReader(prisma, { transport, ...(opts.now ? { now: opts.now } : {}) });
}
