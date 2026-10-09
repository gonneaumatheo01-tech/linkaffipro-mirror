import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const alerts: Array<{ id: string; kind: string; severity: string; message: string; createdAt: Date; notifiedAt: Date | null; resolvedAt: Date | null }> = [];
  return {
    alerts,
    prisma: {
      bot: { findMany: vi.fn(async (): Promise<Array<{ username: string; isActive: boolean; lastWebhookAt: Date | null; lastError: string | null }>> => [{ username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: "500 boom" }]) },
      syncState: { findMany: vi.fn(async () => []) },
      setting: { findUnique: vi.fn(async (): Promise<{ value: unknown } | null> => null) },
      outboundMessage: { count: vi.fn(async () => 0) },
      player: { count: vi.fn(async () => 0) },
      click: { count: vi.fn(async () => 0) },
      trackingLink: { findMany: vi.fn(async () => []) },
      alert: {
        findFirst: vi.fn(async ({ where }: { where: { kind: string; resolvedAt: null } }) => alerts.find((a) => a.kind === where.kind && a.resolvedAt === null) ?? null),
        findMany: vi.fn(async (args: { where: { resolvedAt?: null; notifiedAt?: null; kind?: string; createdAt?: { gte: Date } } }) =>
          alerts.filter(
            (a) =>
              (args.where.kind === undefined ? a.resolvedAt === null : a.kind === args.where.kind && a.createdAt >= args.where.createdAt!.gte) &&
              (args.where.notifiedAt === undefined || a.notifiedAt === null),
          ),
        ),
        create: vi.fn(async ({ data }: { data: { kind: string; severity: string; message: string; notifiedAt?: Date; resolvedAt?: Date } }) => {
          const a = { id: `a${alerts.length + 1}`, ...data, createdAt: new Date(), notifiedAt: data.notifiedAt ?? null, resolvedAt: data.resolvedAt ?? null };
          alerts.push(a);
          return a;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { resolvedAt: Date } }) => {
          for (const a of alerts) if (where.id.in.includes(a.id)) a.resolvedAt = data.resolvedAt;
          return { count: where.id.in.length };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { notifiedAt?: Date; resolvedAt?: Date } }) => {
          const a = alerts.find((x) => x.id === where.id)!;
          if (data.notifiedAt) a.notifiedAt = data.notifiedAt;
          if (data.resolvedAt) a.resolvedAt = data.resolvedAt;
          return a;
        }),
      },
    },
  };
});
vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma, toJsonValue: (v: unknown) => v }));
const failures = vi.hoisted(() => ({ counts: {} as Record<string, number> }));
vi.mock("@linkaffipro/queue", () => ({
  getQueue: () => ({ getWaitingCount: async () => 0 }),
  getRedis: () => ({}),
  QUEUE_NAMES: ["stats", "telegram-send"],
  HEARTBEAT_LAST_KEY: "worker:heartbeat:last",
  countRecentFailures: async () => failures.counts,
  parseHeartbeat: (raw: string | null) => (raw ? (JSON.parse(raw) as { at: string }) : null),
}));
const notify = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@linkaffipro/telegram", () => ({ notifyAdmin: notify }));

import { reportWorkerRestart, runAlerts } from "./alerts";

describe("passage d'alertes", () => {
  beforeEach(() => {
    db.alerts.length = 0;
    failures.counts = {};
    notify.mockClear();
  });

  it("crée, notifie une seule fois, puis résout quand la condition disparaît", async () => {
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(1);
    expect(r1.notified).toBe(1);
    expect(db.alerts[0]?.kind).toBe("bot_webhook");

    // Deuxième passage : même condition → pas de doublon, pas de nouvelle notification.
    const r2 = await runAlerts(new Date("2026-10-09T12:05:00Z"));
    expect(r2.created).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);

    // La condition disparaît → résolution automatique.
    db.prisma.bot.findMany.mockResolvedValueOnce([{ username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null }]);
    const r3 = await runAlerts(new Date("2026-10-09T12:10:00Z"));
    expect(r3.resolved).toBe(1);
    expect(db.alerts[0]?.resolvedAt).not.toBeNull();
  });
});

describe("erreurs répétées et absence du worker", () => {
  beforeEach(() => {
    db.alerts.length = 0;
    failures.counts = {};
    notify.mockClear();
    db.prisma.bot.findMany.mockResolvedValue([{ username: "casino", isActive: true, lastWebhookAt: new Date(), lastError: null }]);
  });

  it("crée job_failures à partir de 10 échecs puis la résout quand la fenêtre se vide", async () => {
    failures.counts = { stats: 12 };
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(1);
    expect(db.alerts[0]?.kind).toBe("job_failures");
    failures.counts = { stats: 0 };
    const r2 = await runAlerts(new Date("2026-10-09T12:20:00Z"));
    expect(r2.resolved).toBe(1);
  });

  it("crée backup_failed depuis Setting backup.last puis la résout après un succès", async () => {
    db.prisma.setting.findUnique.mockResolvedValueOnce({ value: { at: "2026-10-09T04:00:00Z", file: "linkaffipro-2026-10-06T04-00-00.sql.gz", ok: false, error: "disque plein" } });
    const r1 = await runAlerts(new Date("2026-10-09T12:00:00Z"));
    expect(r1.created).toBe(1);
    expect(db.alerts[0]?.message).toContain("disque plein");
    db.prisma.setting.findUnique.mockResolvedValueOnce({ value: { at: "2026-10-10T04:00:00Z", file: "linkaffipro-2026-10-10T04-00-00.sql.gz", ok: true } });
    const r2 = await runAlerts(new Date("2026-10-10T12:00:00Z"));
    expect(r2.resolved).toBe(1);
  });

  it("au redémarrage : rien sans ancien battement ni sous 3 minutes, sinon une alerte résolue et une notification", async () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const redisWith = (at: Date | null) => ({ get: async () => (at ? JSON.stringify({ at: at.toISOString(), version: "x", startedAt: at.toISOString(), pid: 1 }) : null) }) as never;
    expect(await reportWorkerRestart(redisWith(null), now)).toBeNull();
    expect(await reportWorkerRestart(redisWith(new Date(now.getTime() - 60_000)), now)).toBeNull();

    const r = await reportWorkerRestart(redisWith(new Date(now.getTime() - 10 * 60_000)), now);
    expect(r).toMatchObject({ downMinutes: 10, created: true, resolved: false });
    expect(db.alerts[0]).toMatchObject({ kind: "worker_down" });
    expect(db.alerts[0]?.resolvedAt).not.toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);

    // Deuxième redémarrage dans la journée : dédoublonné, pas de nouvelle alerte.
    const r2 = await reportWorkerRestart(redisWith(new Date(now.getTime() - 10 * 60_000)), new Date(now.getTime() + 3600_000));
    expect(r2).toMatchObject({ created: false, resolved: false });
    expect(db.alerts).toHaveLength(1);
  });

  it("au redémarrage : résout l'alerte ouverte créée par le site pendant l'absence", async () => {
    const now = new Date("2026-10-09T12:00:00Z");
    await db.prisma.alert.create({ data: { kind: "worker_down", severity: "CRITICAL", message: "absent" } });
    const redis = { get: async () => JSON.stringify({ at: new Date(now.getTime() - 5 * 60_000).toISOString(), version: "x", startedAt: "x", pid: 1 }) } as never;
    const r = await reportWorkerRestart(redis, now);
    expect(r).toMatchObject({ resolved: true, created: false, downMinutes: 5 });
    expect(db.alerts[0]?.resolvedAt).toEqual(now);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
