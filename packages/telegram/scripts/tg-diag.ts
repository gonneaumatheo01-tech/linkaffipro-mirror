// Diagnostic du dialogue admin (phase 26), LECTURE SEULE : pnpm tg:diag (dans le conteneur Railway `web`) ou
// TG_LOCAL=1 pnpm tg:diag (base locale). N'affiche jamais un jeton ni un secret.
import { Api } from "grammy";
import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { HEARTBEAT_KEY, closeQueues, getQueue, getRedis, heartbeatAgeSec, parseHeartbeat, type QueueName } from "@linkaffipro/queue";
import { adminBot } from "../src/admin-bot";
import { adminInboxWhere } from "../src/admin-chat";
import { diagLines, formatDiag, type DiagBot, type DiagQueue, type DiagSnapshot } from "../src/diag";
import { prismaTelegramDeps } from "../src/prisma-deps";
import { isGhostBotUsername } from "../src/webhook-health";

const QUEUES: QueueName[] = ["agents-orchestrator", "chat"];

async function queueState(name: QueueName): Promise<DiagQueue> {
  try {
    const q = getQueue(name);
    const counts = await q.getJobCounts("waiting", "active", "failed", "delayed", "prioritized");
    const [done] = await q.getJobs(["completed"], 0, 0, false);
    const [failed] = await q.getJobs(["failed"], 0, 0, false);
    const [oldest] = await q.getJobs(["waiting", "prioritized"], 0, 0, true);
    const ends = [done?.finishedOn, failed?.finishedOn].filter((n): n is number => typeof n === "number");
    return {
      name,
      waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      lastActivityAt: ends.length ? new Date(Math.max(...ends)) : null,
      oldestWaitingAt: oldest?.timestamp ? new Date(oldest.timestamp) : null,
    };
  } catch (err) {
    return { name, waiting: 0, active: 0, failed: 0, delayed: 0, lastActivityAt: null, error: (err as Error).message };
  }
}

async function main() {
  const now = new Date();
  const setting = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  const adminId = typeof setting?.value === "string" && /^\d+$/.test(setting.value) ? setting.value : null;
  const chosen = await adminBot();
  const rows = await prisma.bot.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, role: true, mode: true, isActive: true, tokenEncrypted: true, _count: { select: { userbotAccounts: true } } },
  });
  const bots: DiagBot[] = [];
  for (const r of rows) {
    const ghost = r._count.userbotAccounts > 0 || isGhostBotUsername(r.username);
    const b: DiagBot = { id: r.id, username: r.username, role: r.role, mode: r.mode, isActive: r.isActive, ghost };
    if (r.isActive && !ghost) {
      try {
        const api = new Api(decrypt(r.tokenEncrypted));
        b.info = await api.getWebhookInfo();
        if (r.role === "ADMIN") b.canReadAllGroupMessages = (await api.getMe()).can_read_all_group_messages ?? null;
      } catch (err) {
        b.info = null;
        b.infoError = (err as Error).message.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***");
      }
    }
    bots.push(b);
  }

  let lastAdminMessage: DiagSnapshot["lastAdminMessage"] = null;
  if (adminId) {
    const ev = await prisma.event.findFirst({
      where: adminInboxWhere(BigInt(adminId), new Date(now.getTime() - 30 * 86_400_000)),
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true, payload: true, bot: { select: { username: true } } },
    });
    if (ev) {
      const text = String((ev.payload as { message?: { text?: string; caption?: string } })?.message?.text ?? "");
      lastAdminMessage = { at: ev.occurredAt, botUsername: ev.bot?.username ?? null, textLength: text.length, isCommand: text.startsWith("/") };
    }
  }
  const since = lastAdminMessage?.at ?? new Date(0);
  const turn = await prisma.bossTurn.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, role: true, status: true, actionKey: true } });
  const auditRow = await prisma.auditLog.findFirst({
    where: { createdAt: { gte: since }, OR: [{ action: { startsWith: "agents." } }, { action: { startsWith: "boss." } }] },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, action: true },
  });
  const pending = await prisma.humanRequest.findFirst({ where: { status: "PENDING" }, orderBy: { askedAt: "asc" }, select: { key: true, kind: true, askedAt: true, telegramMessageId: true } });

  const queues: DiagQueue[] = [];
  for (const q of QUEUES) queues.push(await queueState(q));
  let hbAge: number | null = null;
  try {
    hbAge = heartbeatAgeSec(parseHeartbeat(await getRedis().get(HEARTBEAT_KEY)), now);
  } catch {
    hbAge = null;
  }

  const snapshot: DiagSnapshot = {
    now,
    adminId,
    adminBotId: chosen?.id ?? null,
    adminBotIsBoss: chosen?.isBoss ?? false,
    baseUrl: process.env.APP_BASE_URL ?? null,
    bots,
    lastAdminMessage,
    lastBossTurn: turn ? { at: turn.createdAt, role: turn.role, status: turn.status, actionKey: turn.actionKey } : null,
    lastAuditAfter: auditRow ? { at: auditRow.createdAt, action: auditRow.action } : null,
    queues,
    heartbeatAgeSec: hbAge,
    pendingRequest: pending,
    webDialogWired: typeof prismaTelegramDeps.agentsDeps === "function" && typeof prismaTelegramDeps.isAdminDialogPartner === "function",
  };
  console.log(formatDiag(diagLines(snapshot)));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
