/**
 * Demandes au service `apps/userbot`, seul détenteur des sessions des comptes réels (jamais une seconde connexion).
 * Même voie que les DM de bienvenue de la phase 18 : une demande déposée en base, relevée par la boucle du userbot,
 * traitée sur SA session, réponse écrite dans la même ligne. Aucune table : lignes `Setting` `userbot.request.<id>`
 * (supprimées par le demandeur après lecture, par le userbot après 15 minutes). Seule demande aujourd'hui : la recherche
 * de la prospection (`prospection/discover/sources/account-search.ts`).
 *
 * Disponible seulement si le userbot a signalé sa boucle depuis moins d'une minute (`userbot.mailbox.heartbeat`) : un
 * userbot ancien ou arrêté ne laisse aucune demande attendre. Copie structurelle du protocole dans
 * `apps/userbot/src/mailbox.ts` (le userbot ne dépend pas de ce paquet).
 */
import { randomUUID } from "node:crypto";
import type { AgentsPrisma } from "../types";

export const USERBOT_REQUEST_PREFIX = "userbot.request.";
export const USERBOT_HEARTBEAT_KEY = "userbot.mailbox.heartbeat";
/** Boucle du userbot vue depuis moins d'une minute : la voie est ouverte. */
export const USERBOT_HEARTBEAT_MAX_AGE_MS = 60_000;
/** Délai de réponse d'une demande. */
export const USERBOT_SHORT_TIMEOUT_MS = 90_000;
const POLL_MS = 1_000;

export class UserbotTimeout extends Error {
  constructor() {
    super("Le service des comptes réels n'a pas répondu à temps.");
    this.name = "UserbotTimeout";
  }
}

/** La boucle du userbot est-elle vivante (signal de moins d'une minute) ? */
export async function userbotMailboxAlive(prisma: AgentsPrisma, now = new Date()): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: USERBOT_HEARTBEAT_KEY } });
  const at = Date.parse(String((row?.value as { at?: unknown } | null)?.at ?? ""));
  return Number.isFinite(at) && now.getTime() - at < USERBOT_HEARTBEAT_MAX_AGE_MS;
}

/** Dépose une demande, attend la réponse (relue chaque seconde), puis efface la ligne. */
export async function askUserbot<Req extends { kind: string; accountId?: string }, Res>(
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

/** Un compte qui a écrit en privé (DM de bienvenue, phase 18) depuis 7 jours converse : il ne lit pas. */
export const ACCOUNT_CONVERSING_DAYS = 7;

/**
 * Comptes réels libres : actifs et connectés (`isActive`, `ACTIVE`), sans persona ni bot fantôme (un compte qui porte
 * une persona converse, règle de la phase 18), et sans DM envoyé ou prévu depuis 7 jours.
 */
export async function freeReaderAccounts(prisma: AgentsPrisma, now = new Date()): Promise<string[]> {
  const accounts = await prisma.telegramUserAccount.findMany({
    where: { isActive: true, status: "ACTIVE", personaId: null, botId: null },
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
